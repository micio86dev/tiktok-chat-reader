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
    });
  } else if (gameState === "FINISHED") {
    // Maybe emit last results? For now do nothing or show menu
    socket.emit("showMenu");
  }

  // Start Quiz with selected topic
  socket.on("startQuiz", (topic) => {
    console.log(`🚀 Avvio Quiz: ${topic}`);
    try {
      if (topic === "js") questions = require("./questions_js.json");
      else if (topic === "python")
        questions = require("./questions_python.json");
      else if (topic === "php") questions = require("./questions_php.json");
      else if (topic === "java") questions = require("./questions_java.json");
      else if (topic === "html") questions = require("./questions_html.json");
      else if (topic === "css") questions = require("./questions_css.json");
      else questions = require("./questions.json"); // Fallback

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
  });

  // Admin: Restart/Reset to Menu
  socket.on("resetQuiz", () => {
    console.log("🔄 Reset a Menu");
    gameState = "MENU";
    questionsCounter = 0;
    responses = {};
    globalScores = {};
    questionStats = [];
    currentQuestion = null;
    if (questionTimer) clearInterval(questionTimer);

    io.emit("showMenu");
  });
});

// --- FUNZIONE CALCOLO PUNTEGGI ---
function processRound() {
  if (!currentQuestion) return;

  const responseList = Object.values(responses);
  const totalAnswers = responseList.length;
  const correctAnswers = responseList.filter(
    (r) => r.answer === currentQuestion.correct
  ).length;

  const percentCorrect =
    totalAnswers > 0 ? ((correctAnswers / totalAnswers) * 100).toFixed(1) : 0;

  // Derive correct text from options (e.g. "?1" -> index 0)
  const correctIndex = parseInt(currentQuestion.correct.replace("?", "")) - 1;
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

    if (data.answer === currentQuestion.correct) {
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
  });

  // simulateChat();
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
  // questionsCounter = 0; // Removed, now handled by reset
  // responses = {};
  // globalScores = {};
  // questionStats = [];
  currentQuestion = null;
  gameState = "FINISHED";

  if (questionTimer) clearInterval(questionTimer);
}

function sendChatMessage(data) {
  if (!currentQuestion) return;
  if (receivedMsgs.has(data.msgId)) return;
  receivedMsgs.add(data.msgId);

  if (data.method === "WebcastChatMessage") {
    const answer = data.comment.trim();
    // Only accept answer if user hasn't answered yet
    if (/^\?\d+$/.test(answer) && !responses[data.uniqueId]) {
      responses[data.uniqueId] = {
        answer: answer,
        nickname: data.nickname,
        avatar: data.profilePictureUrl,
        timestamp: Date.now(),
      };

      // Calculate and emit answer counts
      const counts = {};
      Object.values(responses).forEach((r) => {
        counts[r.answer] = (counts[r.answer] || 0) + 1;
      });
      io.emit("updateAnswerCounts", counts);
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
  live = new WebcastPushConnection(username);
  console.log(`🔗 Tentativo di connessione a ${username}...`);

  // Decomment to simulate
  // if (questionTimer) clearInterval(questionTimer);
  // questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000); // TEMP

  live.on("chat", (data) => {
    sendChatMessage(data);
  });

  live.on("connected", (room) => {
    console.log(`✅ Connesso a ${username} (roomId: ${room.roomId})`);
    retryDelay = 5000;
    /*if (questionTimer) clearInterval(questionTimer);
    questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000);*/
  });

  live.on("disconnected", () => {
    console.log(`❌ Disconnesso. Ritento in ${retryDelay / 1000}s`);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.on("error", (e) => {
    console.error(`‼️ Errore ${JSON.stringify(e)}`);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.connect().catch((e) => {
    console.error("❌ Errore connessione iniziale", JSON.stringify(e));
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
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

connectLive();

server.listen(3000, () =>
  console.log("🌐 Server in ascolto su http://localhost:3000")
);
