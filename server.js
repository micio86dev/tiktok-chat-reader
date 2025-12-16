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

// --- QUIZ MULTIPLE DOMANDE ---
// --- QUIZ MULTIPLE DOMANDE ---
let questions = [];

let currentQuestion = null;
let responses = {};
let globalScores = {};
let questionStats = []; // Array to store stats for each question
let gameState = "MENU"; // MENU, PLAYING, FINISHED
let currentTopic = "";

// --- CONNESSIONE CLIENT ---
io.on("connection", (socket) => {
  console.log("Nuovo client connesso");

  if (gameState === "MENU") {
    socket.emit("showMenu");
  } else if (gameState === "PLAYING" && currentQuestion) {
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
    // Maybe emit last results? For now do nothing or show menu
    socket.emit("showMenu");
  }

  // Start Quiz with selected topic
  // Start Quiz with selected topic
  socket.on("startQuiz", (topic) => {
    startQuiz(topic);
  });

  // Admin: Restart/Reset to Menu
  // Admin: Restart/Reset to Menu
  socket.on("resetQuiz", () => {
    console.log("🔄 Reset a Menu");
    // Clear auto restart timer if active
    if (autoRestartTimer) {
      clearTimeout(autoRestartTimer);
      autoRestartTimer = null;
    }

    gameState = "MENU";
    questionsCounter = 0;
    responses = {};
    globalScores = {};
    questionStats = [];
    currentQuestion = null;
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

  // simulateChat();
}



let autoRestartTimer = null;

function startQuiz(topic) {
  console.log(`🚀 Avvio Quiz: ${topic}`);
  currentTopic = topic;
  try {
    if (topic === "js") questions = require("./questions_js.json");
    else if (topic === "python")
      questions = require("./questions_python.json");
    else if (topic === "php") questions = require("./questions_php.json");
    else if (topic === "java") questions = require("./questions_java.json");
    else if (topic === "html") questions = require("./questions_html.json");
    else if (topic === "css") questions = require("./questions_css.json");
    else if (topic === "cpp") questions = require("./questions_cpp.json");
    else if (topic === "csharp") questions = require("./questions_csharp.json");
    let questionsFile;
    switch (topic) {
      case "js":
        questionsFile = require("./questions_js.json");
        break;
      case "python":
        questionsFile = require("./questions_python.json");
        break;
      case "php":
        questionsFile = require("./questions_php.json");
        break;
      case "java":
        questionsFile = require("./questions_java.json");
        break;
      case "html":
        questionsFile = require("./questions_html.json");
        break;
      case "css":
        questionsFile = require("./questions_css.json");
        break;
      case "cpp":
        questionsFile = require("./questions_cpp.json");
        break;
      case "csharp":
        questionsFile = require("./questions_csharp.json");
        break;
      case "dotnet":
        questionsFile = require("./questions_dotnet.json");
        break;
      case "c":
        questionsFile = require("./questions_c.json");
        break;
      case "react":
        questionsFile = require("./questions_react.json");
        break;
      case "vue":
        questionsFile = require("./questions_vue.json");
        break;
      case "node":
        questionsFile = require("./questions_node.json");
        break;
      case "go":
        questionsFile = require("./questions_go.json");
        break;
      case "rust":
        questionsFile = require("./questions_rust.json");
        break;
      case "angular":
        questionsFile = require("./questions_angular.json");
        break;
      default:
        questionsFile = require("./questions.json"); // Fallback
    }
    questions = questionsFile;

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

  // Auto Restart Logic
  const restartDelay = 60;
  io.emit("autoRestartCountdown", { seconds: restartDelay });

  autoRestartTimer = setTimeout(() => {
    const topics = [
      "js",
      "python",
      "php",
      "java",
      "html",
      "css",
      "cpp",
      "csharp",
      "dotnet",
      "c",
      "react",
      "vue",
      "node",
      "go",
      "rust",
      "angular"
    ];
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];

    // Notify clients to start animation
    const animationDuration = 4000;
    io.emit("startTopicSelection", { target: randomTopic, duration: animationDuration });

    // Wait for animation then start
    setTimeout(() => {
      startQuiz(randomTopic);
    }, animationDuration);

  }, restartDelay * 1000);
}

function sendChatMessage(data) {
  if (!currentQuestion) return;
  if (receivedMsgs.has(data.msgId)) return;
  receivedMsgs.add(data.msgId);

  if (data.method === "WebcastChatMessage") {
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
    /*if (questionTimer) clearInterval(questionTimer);
    questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000);*/
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

function simulateChat() {
  const exampleMsg = require("./exampleMsg.json");
  const totalAnswers = 10;

  for (let i = 0; i < totalAnswers; i++) {
    setTimeout(() => {
      const random = Math.floor(Math.random() * 1000);
      const testMsg = exampleMsg;
      testMsg.comment = `?${Math.floor(Math.random() * 4) + 1}`;
      testMsg.userId = `user${random}`;
      testMsg.msgId = `msg${random}`;
      testMsg.nickname = `User${random}`;
      testMsg.uniqueId = `user${random}`;

      sendChatMessage(testMsg);
    }, i * 1000);
  }
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
