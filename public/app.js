const { createApp, ref, onMounted, nextTick } = Vue;

createApp({
    setup() {
        const socket = io();

        // State
        const currentQuestion = ref(null);
        const options = ref([]);
        const timer = ref("00:00");

        const stats = ref(null);
        const answerCounts = ref({});
        const messages = ref([]);
        const isQuizActive = ref(false);
        const chatContainer = ref(null);

        // Timer Logic
        let countdownInterval = null;

        const startTimer = (seconds) => {
            clearInterval(countdownInterval);
            updateTimerDisplay(seconds);

            countdownInterval = setInterval(() => {
                seconds--;
                if (seconds < 0) {
                    clearInterval(countdownInterval);
                    timer.value = "00:00";
                    return;
                }
                updateTimerDisplay(seconds);
            }, 1000);
        };

        const updateTimerDisplay = (seconds) => {
            const m = Math.floor(seconds / 60).toString().padStart(2, "0");
            const s = (seconds % 60).toString().padStart(2, "0");
            timer.value = `${m}:${s}`;
        };

        const showMenu = ref(false);

        // Auto Restart Countdown
        const restartCountdown = ref(null);
        let restartInterval = null;

        const clearRestartCountdown = () => {
            if (restartInterval) clearInterval(restartInterval);
            restartCountdown.value = null;
        };

        const currentTopic = ref('');
        const questionCounter = ref('');

        // Socket Events
        onMounted(() => {
            // Show Menu
            socket.on("showMenu", () => {
                clearRestartCountdown();
                showMenu.value = true;
                stats.value = null;
                isQuizActive.value = false;
                currentQuestion.value = null;
                options.value = [];
                timer.value = "00:00";
                currentTopic.value = '';
                questionCounter.value = '';
            });

            // New Question
            socket.on("newQuestion", (q) => {
                clearRestartCountdown();
                showMenu.value = false; // Ensure menu is hidden
                console.log("New Question:", q);
                currentQuestion.value = q.question;
                options.value = q.options;
                stats.value = null; // Reset stats
                topicSelection.value.active = false; // Close animation
                isQuizActive.value = true;
                startTimer(q.timer);

                // Set topic and counter
                if (q.topic) currentTopic.value = q.topic.toUpperCase();
                if (q.counter && q.total) questionCounter.value = `${q.counter}/${q.total}`;
                else if (q.counter) questionCounter.value = `${q.counter}`;
            });

            // Question Result
            socket.on("questionResult", (res) => {
                console.log("Results:", res);
                stats.value = res;
                isQuizActive.value = false;
                clearInterval(countdownInterval);
            });
        });

        // Update Answer Counts
        socket.on("updateAnswerCounts", (counts) => {
            answerCounts.value = counts;
        });

        // Chat Messages
        socket.on("tiktokMessage", (msg) => {
            messages.value.push(msg);
            if (messages.value.length > 50) {
                messages.value.shift(); // Keep only last 50 messages
            }
            scrollToBottom();
        });

        // Quiz Finished
        socket.on("quizFinished", () => {
            currentQuestion.value = "Quiz Terminato!";
            options.value = [];
            timer.value = "00:00";
            isQuizActive.value = false;
        });


        const scrollToBottom = async () => {
            await nextTick();
            if (chatContainer.value) {
                chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
            }
        };

        // Topic Selection Animation state
        const topicSelection = ref({
            active: false,
            current: ''
        });

        socket.on("startTopicSelection", (data) => {
            clearRestartCountdown();
            showMenu.value = false;
            stats.value = null; // Hide results
            topicSelection.value.active = true;

            const topics = ["JS", "PYTHON", "PHP", "JAVA", "HTML", "CSS", "CPP", "CSHARP", "DOTNET", "C", "REACT", "VUE", "NODE", "GO", "RUST", "ANGULAR"];
            let interval = setInterval(() => {
                topicSelection.value.current = topics[Math.floor(Math.random() * topics.length)];
            }, 100);

            // Stop slightly before the server starts the quiz
            setTimeout(() => {
                clearInterval(interval);
                topicSelection.value.current = data.target.toUpperCase();
            }, data.duration - 500);
        });

        socket.on("autoRestartCountdown", (data) => {
            let seconds = data.seconds;
            restartCountdown.value = seconds;

            clearInterval(restartInterval);
            restartInterval = setInterval(() => {
                seconds--;
                restartCountdown.value = seconds;
                if (seconds <= 0) {
                    clearInterval(restartInterval);
                    restartCountdown.value = null;
                }
            }, 1000);
        });

        const resetQuiz = () => {
            if (confirm("Sei sicuro di voler avviare un nuovo quiz?")) {
                clearRestartCountdown();
                socket.emit("resetQuiz");
            }
        };

        const startQuiz = (topic) => {
            clearRestartCountdown();
            showMenu.value = false;
            socket.emit("startQuiz", topic);
        };

        return {
            currentQuestion,
            options,
            timer,
            currentTopic,
            questionCounter,

            stats,
            answerCounts,
            messages,
            isQuizActive,
            chatContainer,
            resetQuiz,

            showMenu,
            startQuiz,
            restartCountdown,
            topicSelection
        };
    }
}).mount('#app');
