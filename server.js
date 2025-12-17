const express = require("express");
const http = require("http");
require("dotenv").config();
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static("public"));

const username = process.env.TIKTOK_USERNAME;
let retryDelay = 5000;
const maxRetryDelay = 60000;
let tiktokAttempts = 0;
const MAX_TIKTOK_ATTEMPTS = 3;
const receivedMsgs = new Set();
let live = null;
let questionsCounter = 0;
let questionTimer = null;
const timerDuration = 60; // Seconds
const maxQuestions = 10;

// --- QUIZ ---
let questions = [];

let currentQuestion = null;
let responses = {};
let globalScores = {};
let questionStats = []; // Array to store stats for each question
let gameState = "MENU"; // MENU, PLAYING, FINISHED
let activeGameMode = "MENU"; // MENU, QUIZ, BATTLESHIP
let currentTopic = "";

// --- BATTLESHIP DATA ---
let battleshipGrid = []; // Server side grid (0: Empty, 1: Ship, 2: Hit, 3: Miss)
let battleshipShips = [];
let battleshipHistory = new Set();
let battleshipStats = {
  totalShots: 0,
  hits: 0,
  misses: 0,
  sunkShips: 0,
  lastShooter: null,
  lastResult: null // "HIT", "MISS", "SUNK", "WIN"
};

// --- HANGMAN DATA ---
const hangmanWords = require("./hangman_words.json");
let hangmanState = {
  word: "",
  guessed: [], // Set of letters
  wrongAttempts: 0,
  maxAttempts: 6,
  maskedWord: "", // "_ _ _ _"
  status: "PLAYING" // PLAYING, WON, LOST
};

// --- CONNESSIONE CLIENT ---
io.on("connection", (socket) => {
  console.log("Nuovo client connesso");

  if (activeGameMode === "MENU") {
    socket.emit("showMenu");
  } else if (activeGameMode === "QUIZ") {
    if (gameState === "PLAYING" && currentQuestion) {
      // If playing, send current state
      socket.emit("newQuestion", {
        question: currentQuestion.text,
        options: currentQuestion.options,
        timer: timerDuration,
        counter: questionsCounter,
        topic: currentTopic,
        total: maxQuestions,
      });
    } else if (gameState === "FINISHED") {
      socket.emit("showMenu");
    }
  } else if (activeGameMode === "BATTLESHIP") {
    socket.emit("battleshipState", {
      grid: getClientGrid(),
      stats: battleshipStats,
      shipsLeft: battleshipShips.filter(s => s.hits < s.size).length
    });
  } else if (activeGameMode === "HANGMAN") {
    socket.emit("hangmanState", hangmanState);
  }

  // Start Quiz with selected topic
  // Start Quiz with selected topic
  socket.on("startQuiz", (topic) => {
    startQuiz(topic);
  });

  // Admin: Restart/Reset to Menu
  // Start Battleship
  socket.on("startBattleship", () => {
    startBattleship();
  });

  // Start Hangman
  socket.on("startHangman", () => {
    startHangman();
  });

  // Admin: Restart/Reset to Menu
  socket.on("resetQuiz", () => {
    console.log("🔄 Reset a Menu");
    // Clear auto restart timer if active
    if (autoRestartTimer) {
      clearTimeout(autoRestartTimer);
      autoRestartTimer = null;
    }

    activeGameMode = "MENU";
    gameState = "MENU";

    // Quiz Reset
    questionsCounter = 0;
    responses = {};
    globalScores = {};
    questionStats = [];
    currentQuestion = null;
    currentTopic = null;

    // Battleship Reset
    battleshipGrid = [];
    battleshipShips = [];
    battleshipHistory = new Set();
    battleshipStats = { totalShots: 0, hits: 0, misses: 0, sunkShips: 0 };

    // Hangman Reset
    hangmanState = { word: "", guessed: [], wrongAttempts: 0, maxAttempts: 6, maskedWord: "", status: "PLAYING" };

    currentTopic = null;
    if (questionTimer) clearInterval(questionTimer);

    io.emit("showMenu");
  });
});

// --- FUNZIONE CALCOLO PUNTEGGI ---
function processRound() {
  if (!currentQuestion) return;

  const responseList = Object.values(responses);
  const totalAnswers = responseList.length;

  // Normalize correct value to integer (handles "1", 1, "?1")
  const correctVal = parseInt(currentQuestion.correct.toString().replace("?", ""));

  const correctAnswers = responseList.filter(
    (r) => parseInt(r.answer) === correctVal
  ).length;

  const percentCorrect =
    totalAnswers > 0 ? ((correctAnswers / totalAnswers) * 100).toFixed(1) : 0;

  const correctIndex = correctVal - 1;
  const correctText =
    currentQuestion.options[correctIndex] || currentQuestion.correct;

  questionStats.push({
    id: currentQuestion.id,
    text: currentQuestion.text,
    correctAnswer: correctText,
    totalAnswers,
    correctCount: correctAnswers,
    percentCorrect,
  });

  Object.entries(responses).forEach(([userId, data]) => {
    if (!globalScores[userId]) {
      globalScores[userId] = {
        score: 0,
        attempts: 0,
        nickname: data.nickname,
        avatar: data.avatar,
      };
    }

    globalScores[userId].attempts++;
    globalScores[userId].nickname = data.nickname;
    globalScores[userId].avatar = data.avatar;

    if (parseInt(data.answer) === correctVal) {
      globalScores[userId].score++;
    }
  });
}

// --- FUNZIONE NUOVA DOMANDA ---
function nextQuestion() {
  // Process results of the previous question
  if (currentQuestion) {
    processRound();
  }

  if (questionsCounter >= maxQuestions) {
    quizFinished();
    return;
  }

  responses = {}; // Reset responses for the new question
  io.emit("updateAnswerCounts", {}); // Clear counts on frontend

  currentQuestion = questions[Math.floor(Math.random() * questions.length)];
  questionsCounter++;

  console.log(
    `📝 Nuova domanda ${questionsCounter}/${maxQuestions}: ${currentQuestion.text}`
  );

  io.emit("newQuestion", {
    id: currentQuestion.id,
    question: currentQuestion.text,
    options: currentQuestion.options,
    counter: questionsCounter,
    timer: timerDuration,
    topic: currentTopic,
    total: maxQuestions,
  });
}

// --- BATTLESHIP LOGIC ---

function startBattleship() {
  console.log("🚀 Avvio Battaglia Navale");
  activeGameMode = "BATTLESHIP";

  // Init Grid 10x10
  battleshipGrid = Array(10).fill().map(() => Array(10).fill(0));
  battleshipHistory = new Set();
  battleshipStats = { totalShots: 0, hits: 0, misses: 0, sunkShips: 0, lastShooter: null, lastResult: null };

  // Place Ships
  // Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2)
  const shipsToPlace = [
    { name: "Carrier", size: 5 },
    { name: "Battleship", size: 4 },
    { name: "Cruiser", size: 3 },
    { name: "Submarine", size: 3 },
    { name: "Destroyer", size: 2 }
  ];

  battleshipShips = [];

  shipsToPlace.forEach(ship => {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const row = Math.floor(Math.random() * 10);
      const col = Math.floor(Math.random() * 10);

      if (canPlaceShip(row, col, ship.size, horizontal)) {
        placeShip(row, col, ship.size, horizontal, ship.name);
        placed = true;
      }
    }
  });

  io.emit("battleshipState", {
    grid: getClientGrid(),
    stats: battleshipStats,
    shipsLeft: battleshipShips.filter(s => s.hits < s.size).length
  });
}

function canPlaceShip(row, col, size, horizontal) {
  if (horizontal) {
    if (col + size > 10) return false;
    for (let i = 0; i < size; i++) {
      if (battleshipGrid[row][col + i] !== 0) return false;
    }
  } else {
    if (row + size > 10) return false;
    for (let i = 0; i < size; i++) {
      if (battleshipGrid[row + i][col] !== 0) return false;
    }
  }
  return true;
}

function placeShip(row, col, size, horizontal, name) {
  const shipObj = { name, size, hits: 0, coords: [] };
  if (horizontal) {
    for (let i = 0; i < size; i++) {
      battleshipGrid[row][col + i] = 1; // 1 = Ship
      shipObj.coords.push({ r: row, c: col + i });
    }
  } else {
    for (let i = 0; i < size; i++) {
      battleshipGrid[row + i][col] = 1;
      shipObj.coords.push({ r: row + i, c: col });
    }
  }
  battleshipShips.push(shipObj);
}

function getClientGrid() {
  // Returns grid where 0 and 1 are 0 (hidden), 2 is Hit, 3 is Miss
  return battleshipGrid.map(row => row.map(cell => (cell === 1 ? 0 : cell)));
}

function handleBattleshipMessage(data) {
  let msg = data.comment.trim().toUpperCase();
  const match = msg.match(/^([A-J])([1-9]|10)$/);

  if (activeGameMode !== "BATTLESHIP" || !match) return;

  const colChar = match[1]; // A-J
  const rowNum = parseInt(match[2]); // 1-10

  const col = colChar.charCodeAt(0) - 65;
  const row = rowNum - 1;

  if (battleshipHistory.has(msg)) return;

  battleshipHistory.add(msg);
  battleshipStats.totalShots++;
  battleshipStats.lastShooter = data.nickname;

  const cell = battleshipGrid[row][col];

  if (cell === 0) {
    // Miss
    battleshipGrid[row][col] = 3;
    battleshipStats.lastResult = "MISS";
    io.emit("battleshipUpdate", {
      row, col, status: 3,
      shooter: data.nickname,
      result: "MISS",
      stats: battleshipStats,
      shipsLeft: battleshipShips.filter(s => s.hits < s.size).length
    });
  } else if (cell === 1) {
    // Hit
    battleshipGrid[row][col] = 2;

    // Find which ship
    let sunk = false;
    let shipName = "";

    for (let ship of battleshipShips) {
      const hitCoord = ship.coords.find(c => c.r === row && c.c === col);
      if (hitCoord) {
        ship.hits++;
        shipName = ship.name;
        if (ship.hits >= ship.size) {
          sunk = true;
          battleshipStats.sunkShips++;
        }
        break;
      }
    }

    if (sunk) {
      battleshipStats.lastResult = `SUNK ${shipName}`;
      io.emit("battleshipUpdate", {
        row, col, status: 2,
        shooter: data.nickname,
        result: "SUNK",
        shipName: shipName,
        stats: battleshipStats,
        shipsLeft: battleshipShips.filter(s => s.hits < s.size).length
      });

      if (battleshipStats.sunkShips >= battleshipShips.length) {
        // Game Over
        io.emit("battleshipGameOver", {
          stats: battleshipStats
        });
        activeGameMode = "FINISHED";
        // Show menu after delay
        setTimeout(() => {
          io.emit("showMenu");
          activeGameMode = "MENU";
        }, 10000);
      }

    } else {
      battleshipStats.lastResult = "HIT";
      io.emit("battleshipUpdate", {
        row, col, status: 2,
        shooter: data.nickname,
        result: "HIT",
        stats: battleshipStats,
        shipsLeft: battleshipShips.filter(s => s.hits < s.size).length
      });
    }
  }
}


let autoRestartTimer = null;

function startQuiz(topic) {
  console.log(`🚀 Avvio Quiz: ${topic}`);
  currentTopic = topic;
  activeGameMode = "QUIZ";
  try {
    questions = require(`./quiz/questions_${topic}.json`);
    if (autoRestartTimer) {
      clearTimeout(autoRestartTimer);
      autoRestartTimer = null;
    }

    gameState = "PLAYING";
    questionsCounter = 0;
    responses = {};
    globalScores = {};
    questionStats = [];
    currentQuestion = null;

    nextQuestion();

    if (questionTimer) clearInterval(questionTimer);
    questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000);
  } catch (e) {
    questions = require(`./quiz/questions.json`);
    console.error("Errore caricamento domande:", e);
  }
}

function quizFinished() {
  console.log(`Quiz finito. Calcolo classifica finale...`);

  // Calculate stats from globalScores
  const participants = Object.values(globalScores);
  const totalParticipants = participants.length;
  const totalCorrect = participants.reduce((sum, p) => sum + p.score, 0);
  const totalAttempts = participants.reduce((sum, p) => sum + p.attempts, 0);
  const percentCorrect =
    totalAttempts > 0 ? ((totalCorrect / totalAttempts) * 100).toFixed(1) : 0;

  // Create leaderboard (sort by score descending)
  const winners = participants
    .sort((a, b) => b.score - a.score)
    .map((p) => ({
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score, // Adding score just in case frontend wants it later
    }));

  console.log(
    `📝 Classifica Finale: ${JSON.stringify(
      {
        totalParticipants,
        totalAttempts,
        totalCorrect,
        percentCorrect,
        topWinners: winners.slice(0, 3),
      },
      null,
      2
    )}`
  );

  io.emit("questionResult", {
    total: totalAttempts,
    correctCount: totalCorrect,
    percentCorrect: percentCorrect,
    winners: winners,
    questionStats: questionStats,
  });
  io.emit("quizFinished");

  // Reset Game State
  currentQuestion = null;
  currentTopic = null;
  gameState = "FINISHED";

  if (questionTimer) clearInterval(questionTimer);

  // Auto Restart Logic -> Go to Menu
  io.emit("autoRestartCountdown", { seconds: 60 });

  autoRestartTimer = setTimeout(() => {
    // Return to menu
    io.emit("showMenu");
    activeGameMode = "MENU";
  }, 60 * 1000);
}

// --- HANGMAN LOGIC ---

function startHangman() {
  console.log("🚀 Avvio Impiccato");
  activeGameMode = "HANGMAN";

  const randomWord = hangmanWords[Math.floor(Math.random() * hangmanWords.length)];

  hangmanState = {
    word: randomWord,
    guessed: [],
    wrongAttempts: 0,
    maxAttempts: 7, // Head, Body, L-Arm, R-Arm, L-Leg, R-Leg, Dead
    maskedWord: Array(randomWord.length).fill("_").join(" "),
    status: "PLAYING",
    lastGuesser: null
  };

  io.emit("hangmanState", hangmanState);
}

function handleHangmanMessage(data) {
  if (activeGameMode !== "HANGMAN" || hangmanState.status !== "PLAYING") return;

  let msg = data.comment.trim().toUpperCase();

  // Check if it's a single letter
  if (!/^[A-Z]$/.test(msg)) return;

  // Check if already guessed
  if (hangmanState.guessed.includes(msg)) return;

  hangmanState.guessed.push(msg);
  hangmanState.lastGuesser = data.nickname;

  if (hangmanState.word.includes(msg)) {
    // Correct guess
    // Reveal letter
    const wordArray = hangmanState.word.split("");
    const maskedArray = hangmanState.maskedWord.split(" ");

    // maskedWord is space separated string, but let's rebuild it properly
    let newMasked = "";
    let completed = true;

    for (let char of wordArray) {
      if (hangmanState.guessed.includes(char)) {
        newMasked += char + " ";
      } else {
        newMasked += "_ ";
        completed = false;
      }
    }
    hangmanState.maskedWord = newMasked.trim();

    if (completed) {
      hangmanState.status = "WON";
      io.emit("hangmanGameOver", { status: "WON", word: hangmanState.word, winner: data.nickname });
      // Auto restart new word after 3 seconds
      setTimeout(() => {
        startHangman();
      }, 3000);
    }

  } else {
    // Wrong guess
    hangmanState.wrongAttempts++;
    if (hangmanState.wrongAttempts >= hangmanState.maxAttempts) {
      hangmanState.status = "LOST";
      io.emit("hangmanGameOver", { status: "LOST", word: hangmanState.word });
      // Auto restart new word after 3 seconds
      setTimeout(() => {
        startHangman();
      }, 3000);
    }
  }

  io.emit("hangmanState", hangmanState);
}

function sendChatMessage(data) {
  if (receivedMsgs.has(data.msgId)) return;
  receivedMsgs.add(data.msgId);

  if (data.method === "WebcastChatMessage") {
    if (activeGameMode === "QUIZ") {
      let answer = data.comment.trim();

      // Normalize user answer: remove '?' prefix if present
      answer = answer.replace(/^\?/, "");

      // Check if it's a valid number format
      if (/^\d+$/.test(answer) && !responses[data.uniqueId]) {
        const answerInt = parseInt(answer, 10);

        // Check if currentQuestion exists and the answer is within valid options range
        if (currentQuestion && currentQuestion.options && answerInt > 0 && answerInt <= currentQuestion.options.length) {
          responses[data.uniqueId] = {
            answer: answerInt, // Store as integer
            nickname: data.nickname,
            avatar: data.profilePictureUrl,
            timestamp: Date.now(),
          };

          // Calculate and emit answer counts
          const counts = {};
          Object.values(responses).forEach((r) => {
            counts[r.answer] = (counts[r.answer] || 0) + 1;
          });
          io.emit("updateAnswerCounts", counts); // Keys will be "1", "2", etc.
        }
      }
    } else if (activeGameMode === "BATTLESHIP") {
      handleBattleshipMessage(data);
    } else if (activeGameMode === "HANGMAN") {
      handleHangmanMessage(data);
    }

    io.emit("tiktokMessage", {
      type: "chat",
      userId: data.userId,
      avatar: data.profilePictureUrl,
      nickname: data.nickname,
      text: data.comment,
    });
  } else if (data.method === "WebcastGift" || data.giftImage) {
    io.emit("tiktokMessage", {
      type: "gift",
      userId: data.userId,
      avatar: data.profilePictureUrl,
      nickname: data.nickname,
      gift: data.gift || data.giftImage,
    });
  }
}

// --- CONNESSIONE LIVE TIKTOK ---
function connectLive() {
  if (tiktokAttempts >= MAX_TIKTOK_ATTEMPTS) {
    console.log(`❌ Rinuncio alla connessione TikTok dopo ${MAX_TIKTOK_ATTEMPTS} tentativi.`);
    return;
  }

  tiktokAttempts++;
  live = new WebcastPushConnection(username);
  console.log(
    `🔗 Tentativo di connessione a ${username} (${tiktokAttempts}/${MAX_TIKTOK_ATTEMPTS})...`
  );

  // Decomment to simulate
  // if (questionTimer) clearInterval(questionTimer);
  // questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000); // TEMP

  live.on("chat", (data) => {
    sendChatMessage(data);
  });

  live.on("connected", (room) => {
    console.log(`✅ Connesso a ${username} (roomId: ${room.roomId})`);
    retryDelay = 5000;
    tiktokAttempts = 0; // Reset attempts on success
  });

  const scheduleRetry = () => {
    if (tiktokAttempts < MAX_TIKTOK_ATTEMPTS) {
      console.log(`❌ Ritento in ${retryDelay / 1000}s...`);
      setTimeout(connectLive, retryDelay);
      retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
    } else {
      console.log(
        `❌ Numero massimo di tentativi (${MAX_TIKTOK_ATTEMPTS}) raggiunto. Stop TikTok.`
      );
    }
  };

  live.on("disconnected", () => {
    console.log(`❌ Disconnesso.`);
    scheduleRetry();
  });

  live.on("error", (e) => {
    console.error(`‼️ Errore ${JSON.stringify(e)}`);
    scheduleRetry();
  });

  live.connect().catch((e) => {
    console.error("❌ Errore connessione iniziale", JSON.stringify(e));
    scheduleRetry();
  });
}

// --- CONNESSIONE YOUTUBE ---
const { connectYouTube } = require("./youtube");

function handleYouTubeMessage(msg) {
  const data = {
    method: "WebcastChatMessage",
    msgId: msg.id,
    userId: msg.authorDetails.channelId,
    uniqueId: msg.authorDetails.channelId,
    nickname: msg.authorDetails.displayName,
    profilePictureUrl: msg.authorDetails.profileImageUrl,
    comment: msg.snippet.displayMessage,
  };
  sendChatMessage(data);
}

connectLive();
connectYouTube(handleYouTubeMessage);

server.listen(3000, () =>
  console.log("🌐 Server in ascolto su http://localhost:3000")
);
