const STORAGE_KEY = "sudarshan-ai-chat-history";
const API_URL = "https://my-own-rag.vercel.app/api/chat";

const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const messageArea = document.getElementById("messageArea");
const sendButton = document.getElementById("sendButton");
const modeDescription = document.getElementById("modeDescription");
const modeTabs = document.querySelectorAll(".mode-tab");
const clearChatButton = document.getElementById("clearChat");
const downloadChatButton = document.getElementById("downloadChat");
const shareChatButton = document.getElementById("shareChat");

let activeMode = "portfolio";
let isSending = false;
let histories = loadHistories();

function loadHistories() {
  const fallback = { portfolio: [], general: [] };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      portfolio: Array.isArray(saved?.portfolio) ? saved.portfolio : [],
      general: Array.isArray(saved?.general) ? saved.general : [],
    };
  } catch (error) {
    return fallback;
  }
}

function saveHistories() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
}

function getWelcomeMessage(mode) {
  if (mode === "general") {
    return {
      sender: "bot",
      text: "General AI Mode is ready. Ask a focused question, or type “generate image of ...”.",
      timestamp: new Date().toISOString(),
    };
  }

  return {
    sender: "bot",
    text: "Portfolio Mode is ready. Ask about my projects, skills, experience, services, or contact links.",
    timestamp: new Date().toISOString(),
  };
}

function ensureHistory(mode) {
  if (histories[mode].length === 0) {
    histories[mode].push(getWelcomeMessage(mode));
    saveHistories();
  }
}

function renderHistory() {
  ensureHistory(activeMode);
  messageArea.innerHTML = "";

  histories[activeMode].forEach((message) => {
    renderMessage(message);
  });

  scrollToBottom();
}

function renderMessage(message) {
  const item = document.createElement("article");
  item.className = `message ${message.sender}-message`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.text;

  if (message.imageUrl) {
    const image = document.createElement("img");
    image.className = "generated-image";
    image.src = message.imageUrl;
    image.alt = message.text || "Generated image";
    image.loading = "lazy";
    bubble.appendChild(image);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span>${formatTime(message.timestamp)}</span>`;

  if (message.sender === "bot") {
    const copyButton = document.createElement("button");
    copyButton.className = "copy-message";
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => copyText(message.text));
    meta.appendChild(copyButton);
  }

  item.appendChild(bubble);
  item.appendChild(meta);
  messageArea.appendChild(item);
}

function addMessage(message) {
  histories[activeMode].push(message);
  saveHistories();
  renderMessage(message);
  scrollToBottom();
}

function addTypingIndicator() {
  const item = document.createElement("article");
  item.className = "message bot-message";
  item.id = "typingIndicator";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `
    <span class="typing" aria-label="Assistant is typing">
      <span></span><span></span><span></span>
    </span>
  `;

  item.appendChild(bubble);
  messageArea.appendChild(item);
  scrollToBottom();
}

function removeTypingIndicator() {
  document.getElementById("typingIndicator")?.remove();
}

function setLoading(isLoading) {
  isSending = isLoading;
  sendButton.disabled = isLoading;
  messageInput.disabled = isLoading;
  modeTabs.forEach((tab) => {
    tab.disabled = isLoading;
  });
  sendButton.textContent = isLoading ? "Sending" : "Send";
}

function setMode(mode) {
  activeMode = mode;
  modeDescription.textContent =
    mode === "portfolio"
      ? "Personal portfolio assistant"
      : "General AI assistant";
  messageInput.placeholder =
    mode === "portfolio"
      ? "Ask about Sudarshan's projects, skills, or contact links..."
      : "Ask anything, or type: generate image of modern app UI";

  modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === mode;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  renderHistory();
  messageInput.focus();
}

async function sendMessage(text) {
  if (isSending) {
    return;
  }

  addMessage({
    sender: "user",
    text,
    timestamp: new Date().toISOString(),
  });

  addTypingIndicator();
  setLoading(true);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, mode: activeMode }),
    });

    const data = await response.json().catch(() => ({
      error: "Invalid response from server",
    }));

    removeTypingIndicator();

    addMessage({
      sender: "bot",
      text: response.ok
        ? data.response || "I could not generate a response."
        : data.error || "Something went wrong. Please try again.",
      imageUrl: response.ok ? data.imageUrl : "",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    removeTypingIndicator();
    addMessage({
      sender: "bot",
      text: "I could not connect to the API. Please try again in a moment.",
      timestamp: new Date().toISOString(),
    });
  } finally {
    setLoading(false);
    messageInput.focus();
  }
}

function clearActiveChat() {
  histories[activeMode] = [getWelcomeMessage(activeMode)];
  saveHistories();
  renderHistory();
}

function downloadActiveChat() {
  const data = {
    mode: activeMode,
    exportedAt: new Date().toISOString(),
    messages: histories[activeMode],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sudarshan-${activeMode}-chat.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function shareActiveChat() {
  const text = histories[activeMode]
    .map((message) => `${message.sender.toUpperCase()}: ${message.text}`)
    .join("\n\n");
  const shareText = encodeURIComponent(text || "Sudarshan AI chat");
  window.open(`https://wa.me/?text=${shareText}`, "_blank", "noopener,noreferrer");
}

function copyText(text) {
  navigator.clipboard?.writeText(text);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  messageInput.value = "";
  sendMessage(text);
});

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

clearChatButton.addEventListener("click", clearActiveChat);
downloadChatButton.addEventListener("click", downloadActiveChat);
shareChatButton.addEventListener("click", shareActiveChat);

setMode(activeMode);
