const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const messageArea = document.getElementById("messageArea");
const sendButton = document.getElementById("sendButton");
const modeLabel = document.getElementById("modeLabel");
const modeButtons = document.querySelectorAll(".mode-button");

const API_URL = "https://my-own-rag.vercel.app/api/chat";
let currentMode = "portfolio";

function addMessage(text, sender, imageUrl = "") {
  const message = document.createElement("article");
  message.className = `message ${sender}-message`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "generated-image";
    image.src = imageUrl;
    image.alt = text || "Generated image";
    image.loading = "lazy";
    bubble.appendChild(image);
  }

  message.appendChild(bubble);
  messageArea.appendChild(message);
  scrollToLatestMessage();

  return message;
}

function addTypingMessage() {
  const message = document.createElement("article");
  message.className = "message bot-message";
  message.id = "typingMessage";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = `
    <span class="typing" aria-label="Bot is typing">
      <span></span>
      <span></span>
      <span></span>
    </span>
  `;

  message.appendChild(bubble);
  messageArea.appendChild(message);
  scrollToLatestMessage();
}

function removeTypingMessage() {
  const typingMessage = document.getElementById("typingMessage");

  if (typingMessage) {
    typingMessage.remove();
  }
}

function scrollToLatestMessage() {
  messageArea.scrollTop = messageArea.scrollHeight;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  modeButtons.forEach((button) => {
    button.disabled = isLoading;
  });
  sendButton.querySelector("span").textContent = isLoading ? "Wait" : "Send";
}

function setMode(mode) {
  currentMode = mode;
  modeLabel.textContent =
    mode === "portfolio" ? "Portfolio assistant" : "General AI assistant";
  messageInput.placeholder =
    mode === "portfolio"
      ? "Ask about projects, skills, education..."
      : "Ask a general question or generate image of...";

  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

async function sendMessage(userMessage) {
  addMessage(userMessage, "user");
  addTypingMessage();
  setLoading(true);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: userMessage, mode: currentMode }),
    });

    const data = await response.json().catch(() => ({
      error: "Invalid response from server",
    }));

    removeTypingMessage();

    if (!response.ok) {
      addMessage(data.error || "Something went wrong. Please try again.", "bot");
      return;
    }

    addMessage(
      data.response || "I don't have that information",
      "bot",
      data.imageUrl,
    );
  } catch (error) {
    removeTypingMessage();
    addMessage("Could not connect to the deployed API. Please try again.", "bot");
  } finally {
    setLoading(false);
    messageInput.focus();
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const userMessage = messageInput.value.trim();

  if (!userMessage) {
    return;
  }

  messageInput.value = "";
  sendMessage(userMessage);
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
    messageInput.focus();
  });
});

setMode(currentMode);
