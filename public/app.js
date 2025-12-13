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

        // Socket Events
        onMounted(() => {
            // New Question
            socket.on("newQuestion", (q) => {
                console.log("New Question:", q);
                currentQuestion.value = q.question;
                options.value = q.options;
                stats.value = null; // Reset stats
                isQuizActive.value = true;
                startTimer(q.timer);
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

        const resetQuiz = () => {
            if (confirm("Sei sicuro di voler avviare un nuovo quiz?")) {
                socket.emit("resetQuiz");
            }
        };

        return {
            currentQuestion,
            options,
            timer,

            stats,
            answerCounts,
            messages,
            isQuizActive,
            chatContainer,
            resetQuiz
        };
    }
}).mount('#app');
