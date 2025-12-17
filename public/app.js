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
        const menuStep = ref('GAME_SELECT'); // GAME_SELECT, TOPIC_SELECT
        const activeGameMode = ref('MENU'); // MENU, QUIZ, BATTLESHIP

        // Battleship State
        const battleshipGrid = ref([]);
        const battleshipStats = ref(null);

        // Hangman State
        const hangmanState = ref(null);

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
                menuStep.value = 'GAME_SELECT'; // Default to game select
                stats.value = null;
                isQuizActive.value = false;
                currentQuestion.value = null;
                options.value = [];
                timer.value = "00:00";
                currentTopic.value = '';
                questionCounter.value = '';
                activeGameMode.value = 'MENU';
                battleshipGrid.value = [];
                battleshipStats.value = null;
                hangmanState.value = null;
            });

            // New Question
            socket.on("newQuestion", (q) => {
                clearRestartCountdown();
                showMenu.value = false; // Ensure menu is hidden
                console.log("New Question:", q);
                activeGameMode.value = 'QUIZ';
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

            // Battleship Events
            socket.on("battleshipState", (state) => {
                console.log("Battleship State:", state);
                activeGameMode.value = 'BATTLESHIP';
                showMenu.value = false;
                battleshipGrid.value = state.grid;
                battleshipStats.value = state.stats;
            });

            socket.on("battleshipUpdate", (update) => {
                // update.row, update.col, update.status
                if (battleshipGrid.value[update.row]) {
                    battleshipGrid.value[update.row][update.col] = update.status;
                }
                battleshipStats.value = update.stats;
            });

            socket.on("battleshipGameOver", (data) => {
                battleshipStats.value = data.stats;
                // maybe show a modal?
            });

            // Hangman Events
            socket.on("hangmanState", (state) => {
                console.log("Hangman State:", state);
                activeGameMode.value = 'HANGMAN';
                showMenu.value = false;
                hangmanState.value = state;
            });

            socket.on("hangmanGameOver", (data) => {
                // data.status, data.word
                if (hangmanState.value) {
                    hangmanState.value.status = data.status;
                    hangmanState.value.word = data.word;
                    // Additional info if needed
                }
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

        const selectGame = (game) => {
            if (game === 'QUIZ') {
                menuStep.value = 'TOPIC_SELECT';
            } else if (game === 'BATTLESHIP') {
                clearRestartCountdown();
                showMenu.value = false;
                socket.emit("startBattleship");
            } else if (game === 'HANGMAN') {
                clearRestartCountdown();
                showMenu.value = false;
                socket.emit("startHangman");
            }
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
            topicSelection,

            // Battleship exports
            menuStep,
            activeGameMode,
            battleshipGrid,
            battleshipStats,
            selectGame,

            // Hangman exports
            hangmanState
        };
    }
}).mount('#app');
