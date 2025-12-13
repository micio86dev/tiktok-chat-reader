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
  if (questionsCounter >= maxQuestions) {
    quizFinished();
    return;
  }

  responses = {}; // Reset responses for the new question
  io.emit("updateAnswerCounts", {}); // Clear counts on frontend

  currentQuestion = questions[Math.floor(Math.random() * questions.length)];
  questionsCounter++;

  console.log(
    `📝 Nuova domanda ${questionsCounter}/${maxQuestions}: ${
      currentQuestion.text
    }`
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
  console.log(`Quiz finito: ${JSON.stringify(responses, null, 2)}`);

  const responseList = Object.values(responses);
  const total = responseList.length;

  // Filter correct answers
  const correctAnswers = responseList.filter(
    (r) => r.answer === currentQuestion.correct
  );

  const correctCount = correctAnswers.length;
  const percentCorrect =
    total > 0 ? ((correctCount / total) * 100).toFixed(1) : 0;

  // Create leaderboard (winners)
  // Sort by timestamp if available, otherwise just list them
  // Assuming we want to show who answered correctly first
  correctAnswers.sort((a, b) => a.timestamp - b.timestamp);

  const winners = correctAnswers.map((r) => ({
    nickname: r.nickname,
    avatar: r.avatar,
  }));

  console.log(
    `📝 Risultati Quiz: ${JSON.stringify(
      {
        total,
        correctCount,
        percentCorrect,
        winners,
      },
      null,
      2
    )}`
  );

  io.emit("questionResult", {
    total,
    correctCount,
    percentCorrect,
    winners,
  });
  io.emit("quizFinished");

  questionsCounter = 0;
  responses = {};

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

  if (questionTimer) clearInterval(questionTimer);
  // questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000); // TEMP

  live.on("chat", (data) => {
    sendChatMessage(data);
  });

  live.on("connected", (room) => {
    console.log(`✅ Connesso a ${username} (roomId: ${room.roomId})`);
    retryDelay = 5000;
    questionTimer = setInterval(() => nextQuestion(), timerDuration * 1000); // TEMP
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
