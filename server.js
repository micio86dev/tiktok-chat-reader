const express = require("express");
const http = require("http");
require('dotenv').config();
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
const timerDuration = 10; // Seconds
const maxQuestions = 3;

// --- QUIZ MULTIPLE DOMANDE ---
const questions = require("./questions.json");

let currentQuestion = null;
let responses = {};

// --- CONNESSIONE CLIENT ---
io.on("connection", (socket) => {
  console.log("Nuovo client connesso");

  // invia subito la domanda corrente e il timer rimanente
  if (currentQuestion) {
    socket.emit("newQuestion", {
      question: currentQuestion.text,
      options: currentQuestion.options,
      timer: timerDuration,
      counter: questionsCounter,
    });
  }
});

// --- FUNZIONE NUOVA DOMANDA ---
function nextQuestion() {
  currentQuestion = questions[Math.floor(Math.random() * questions.length)];
  responses = {};
  console.log(`📝 Nuova domanda: ${currentQuestion.text}`);

  if (questionsCounter >= maxQuestions) {
    quizFinished();
    return;
  }
  questionsCounter++;

  io.emit("newQuestion", {
    id: currentQuestion.id,
    question: currentQuestion.text,
    options: currentQuestion.options,
    counter: questionsCounter,
    timer: timerDuration,
  });

  simulateChat();
}

function quizFinished() {
  console.log("Quiz finito", JSON.stringify(responses, null, 2));
  const total = Object.keys(responses).length;
  const correctCount = Object.values(responses).filter(
    (r) => r === currentQuestion.correct
  ).length;
  const percentCorrect =
    total > 0 ? ((correctCount / total) * 100).toFixed(1) : 0;

  io.emit("questionResult", {
    total,
    correctCount,
    percentCorrect,
  });
  io.emit("quizFinished");
  questionsCounter = 0;

  if (questionTimer) clearInterval(questionTimer);
}

function sendChatMessage(data) {
  if (!currentQuestion) return;
  if (receivedMsgs.has(data.msgId)) return;
  receivedMsgs.add(data.msgId);

  if (data.method === "WebcastChatMessage") {
    const answer = data.comment.trim();
    if (/^\?\d+$/.test(answer) && !responses[data.uniqueId]) {
      responses[data.uniqueId] = answer;
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

  if (questionTimer) clearInterval(questionTimer);
  questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000); // TEMP

  live.on("chat", (data) => {
    sendChatMessage(data);
  });

  live.on("connected", (room) => {
    console.log(`✅ Connesso a ${username} (roomId: ${room.roomId})`);
    retryDelay = 5000;
    // setInterval(() => nextQuestion(), timerDuration * 1000); // TODO
  });

  live.on("disconnected", () => {
    console.log(`❌ Disconnesso. Ritento in ${retryDelay / 1000}s`);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.on("error", () => {
    console.error("‼️ Errore");
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.connect().catch(() => {
    console.error("❌ Errore connessione iniziale");
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
