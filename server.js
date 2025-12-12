const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const username = "7amanzx";
let retryDelay = 5000;
const maxRetryDelay = 60000;
const receivedMsgs = new Set();

// --- QUIZ MULTIPLE DOMANDE ---
const questions = require("./questions.json");

let currentQuestion = null;
let responses = {};
let questionTimer = null;

// --- CONNESSIONE CLIENT ---
io.on("connection", (socket) => {
  console.log("Nuovo client connesso");

  // invia subito la domanda corrente e il timer rimanente
  if (currentQuestion) {
    socket.emit("newQuestion", {
      question: currentQuestion.text,
      options: currentQuestion.options,
      timer: Math.floor(
        (questionTimer._idleStart + questionTimer._idleTimeout - Date.now()) /
          1000
      ),
    });
  }
});

// --- FUNZIONE NUOVA DOMANDA ---
function nextQuestion() {
  currentQuestion = questions[Math.floor(Math.random() * questions.length)];
  responses = {};
  console.log(`📝 Nuova domanda: ${currentQuestion.text}`);

  io.emit("newQuestion", {
    question: currentQuestion.text,
    options: currentQuestion.options,
    timer: 60,
  });

  // timer 1 minuto
  questionTimer = setTimeout(() => {
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

    nextQuestion();
  }, 60_000);
}

// --- CONNESSIONE LIVE TIKTOK ---
function connectLive() {
  console.log(`🔗 Tentativo di connessione a ${username}...`);
  const live = new WebcastPushConnection(username);

  live.on("chat", (data) => {
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
        user: data.uniqueId,
        text: data.comment,
      });
    } else if (data.method === "WebcastGift" || data.giftImage) {
      io.emit("tiktokMessage", {
        type: "gift",
        user: data.uniqueId,
        gift: data.gift || data.giftImage,
      });
    }
  });

  live.on("connected", (room) => {
    console.log(`✅ Connesso a ${username} (roomId: ${room.roomId})`);
    retryDelay = 5000;
  });

  live.on("disconnected", () => {
    console.log(`❌ Disconnesso. Ritento in ${retryDelay / 1000}s`);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.on("error", (err) => {
    console.error("‼️ Errore:", err.message || err);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });

  live.connect().catch((err) => {
    console.error("❌ Errore connessione iniziale:", err.message);
    setTimeout(connectLive, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  });
}

connectLive();

// --- AVVIA PRIMA DOMANDA SUBITO ---
nextQuestion();

server.listen(3000, () =>
  console.log("🌐 Server in ascolto su http://localhost:3000")
);
