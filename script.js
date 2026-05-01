const STORAGE_KEY = "sudarshan-ai-chat-history";
const ANALYTICS_KEY = "sudarshan-ai-analytics";
const API_URL = "https://my-own-rag.vercel.app/api/chat";

const CONTACT = {
  email: "sudarshanpeddakotla@gmail.com",
  linkedin: "https://www.linkedin.com/in/sudarshan-peddakotla-6851052a7",
  github: "https://github.com/peddakotlasudarshan20",
  portfolio: "https://peddakotlasudarshan20.github.io/",
  whatsappText:
    "Hi Sudarshan, I am interested in hiring you for a web development project.",
};

const PROJECTS = {
  mindBloom: {
    keywords: ["mind bloom", "mindbloom"],
    name: "Mind Bloom",
    description:
      "A mental wellness application that helps users manage stress through an interactive UI and Firebase-backed features.",
    techStack: ["HTML", "CSS", "JavaScript", "Firebase"],
    github: "https://github.com/peddakotlasudarshan20/mind-bloom",
    live: "https://mindbloom-9b7b5.web.app/",
  },
  socialMedia: {
    keywords: ["social media", "social app"],
    name: "Social Media App",
    description:
      "A full-stack social media platform with authentication, posting, and interaction features.",
    techStack: ["React", "Node.js", "Express.js", "MongoDB", "Firebase"],
    github: "https://github.com/peddakotlasudarshan20/social-media",
    live: "https://social-app-94b55.web.app/",
  },
  summarizer: {
    keywords: ["text summarizer", "summarizer", "ai text"],
    name: "AI Text Summarizer",
    description:
      "An AI web tool that summarizes long text with API integration for faster reading and better clarity.",
    techStack: ["JavaScript", "API Integration"],
    github: "https://github.com/peddakotlasudarshan20/Text-summarizer",
    live: "",
  },
};

const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const messageArea = document.getElementById("messageArea");
const sendButton = document.getElementById("sendButton");
const modeDescription = document.getElementById("modeDescription");
const modeTabs = document.querySelectorAll(".mode-tab");
const clearChatButton = document.getElementById("clearChat");
const downloadChatButton = document.getElementById("downloadChat");
const shareChatButton = document.getElementById("shareChat");
const copyChatButton = document.getElementById("copyChat");
const voiceButton = document.getElementById("voiceButton");
const suggestionChips = document.querySelectorAll(".suggestion-chip");

let activeMode = "portfolio";
let activeSessionId = null;
let isSending = false;
let lastSendAt = 0;
let recognition = null;
let voiceTimeout = null;
let pendingRequest = null;
let sessions = loadSessions();

initHistoryRail();

function generateUUID() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadSessions() {
  const fallback = { portfolio: { sessions: [], activeSessionId: null }, general: { sessions: [], activeSessionId: null } };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.portfolio?.sessions && saved?.general?.sessions) {
      return {
        portfolio: { sessions: Array.isArray(saved.portfolio.sessions) ? saved.portfolio.sessions : [], activeSessionId: saved.portfolio.activeSessionId || null },
        general: { sessions: Array.isArray(saved.general.sessions) ? saved.general.sessions : [], activeSessionId: saved.general.activeSessionId || null },
      };
    }
    return fallback;
  } catch (error) {
    return fallback;
  }
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  renderHistoryRail();
}

function getActiveSession() {
  const modeData = sessions[activeMode];
  if (!modeData?.activeSessionId) return null;
  return modeData.sessions.find(s => s.id === modeData.activeSessionId);
}

function createNewSession(firstMessage) {
  const sessionId = generateUUID();
  const title = firstMessage.text.slice(0, 50).trim();
  const session = {
    id: sessionId,
    title: title || "New Chat",
    messages: [getWelcomeMessage(activeMode)],
    createdAt: new Date().toISOString(),
  };
  
  sessions[activeMode].sessions.push(session);
  sessions[activeMode].activeSessionId = sessionId;
  saveSessions();
  return session;
}

function addMessageToSession(message) {
  let session = getActiveSession();
  if (!session) {
    createNewSession(message);
    session = getActiveSession();
  }
  
  if (session) {
    session.messages.push(message);
    saveSessions();
  }
}

function getSmartGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function getWelcomeMessage(mode) {
  return {
    sender: "bot",
    text:
      mode === "general"
        ? `${getSmartGreeting()} General AI Mode is ready.\n• Ask a focused question\n• Or type "generate image of ..."`
        : `${getSmartGreeting()} Portfolio Mode is ready.\n• Ask about projects, skills, services, or contact links\n• Switch modes anytime without mixing chats`,
    timestamp: new Date().toISOString(),
  };
}

function renderSession() {
  const session = getActiveSession();
  messageArea.innerHTML = "";
  
  if (!session || !session.messages || session.messages.length === 0) {
    const emptyMsg = getWelcomeMessage(activeMode);
    renderMessage(emptyMsg, 0);
  } else {
    session.messages.forEach((message, index) => renderMessage(message, index));
  }
  
  scrollToBottom();
}

function convertLinksToClickable(text) {
  const urlPattern = /(https?:\/\/[^\s]+)/gi;
  const parts = [];
  let lastIndex = 0;

  text.replace(urlPattern, (match, url, offset) => {
    parts.push(text.slice(lastIndex, offset));
    parts.push(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="bot-link">${url}</a>`);
    lastIndex = offset + match.length;
  });

  parts.push(text.slice(lastIndex));
  return parts.join("");
}

function renderMessage(message, index = 0) {
  const item = document.createElement("article");
  item.className = `message ${message.sender}-message`;
  item.dataset.index = String(index);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  
  if (message.sender === "bot") {
    const formattedText = formatBotResponse(message.text);
    bubble.innerHTML = convertLinksToClickable(formattedText);
  } else {
    bubble.textContent = message.text;
  }

  if (message.imageUrl) {
    const image = document.createElement("img");
    image.className = "generated-image";
    image.src = message.imageUrl;
    image.alt = message.text || "Generated image";
    image.loading = "lazy";
    bubble.appendChild(image);
  }

  if (message.sender === "bot") {
    getProjectsByKeys(message.projectKeys || []).forEach((project) => {
      bubble.appendChild(createProjectCard(project));
    });

    if (message.showHireCard) {
      bubble.appendChild(createHireCard());
    }
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
  addMessageToSession(message);
  renderMessage(message, (getActiveSession()?.messages.length || 1) - 1);
  scrollToBottom();
}

function formatBotResponse(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "I could not generate a response.";

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines.shift() || cleaned;
  const linkLines = [];
  const bulletLines = [];

  lines.forEach((line) => {
    if (/https?:\/\//i.test(line)) {
      linkLines.push(line.replace(/^[-•*\s]+/, ""));
    } else {
      bulletLines.push(line.replace(/^[-•*\s]+/, ""));
    }
  });

  if (!bulletLines.length && first.length > 120) {
    const sentences = first.split(/(?<=[.!?])\s+/);
    const direct = sentences.shift();
    bulletLines.push(...sentences);
    return buildStructuredText(direct, bulletLines, linkLines);
  }

  return buildStructuredText(first, bulletLines, linkLines);
}

function buildStructuredText(firstLine, bullets, links) {
  const parts = [firstLine];

  if (bullets.length) {
    parts.push(bullets.map((item) => `• ${item}`).join("\n"));
  }

  if (links.length) {
    parts.push(links.map((item) => `• ${item}`).join("\n"));
  }

  return parts.join("\n\n");
}

function addTypingIndicator() {
  const item = document.createElement("article");
  item.className = "message bot-message";
  item.id = "typingIndicator";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `
    <span class="typing-label">typing...</span>
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
  suggestionChips.forEach((chip) => {
    chip.disabled = isLoading;
  });
  sendButton.textContent = isLoading ? "Sending" : "Send";
}

function setMode(mode) {
  if (isSending) return;

  activeMode = mode;
  activeSessionId = sessions[mode].activeSessionId;
  messageInput.value = "";
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

  renderSession();
  renderHistoryRail();
  messageInput.focus();
}

async function sendMessage(text) {
  const now = Date.now();
  if (isSending || now - lastSendAt < 600 || pendingRequest) return;
  lastSendAt = now;

  const quickReply = getEasterEggResponse(text);
  const projectKeys = getProjectKeysFromText(text);
  const showHireCard = shouldShowHireCard(text);

  addMessage({
    sender: "user",
    text,
    timestamp: new Date().toISOString(),
  });
  trackQuestion(text);

  addTypingIndicator();
  setLoading(true);

  try {
    if (quickReply) {
      await delay(500);
      removeTypingIndicator();
      addMessage({
        sender: "bot",
        text: quickReply,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    pendingRequest = fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, mode: activeMode }),
    });

    const response = await pendingRequest;
    pendingRequest = null;

    const data = await response.json().catch(() => ({
      error: "Invalid response from server",
    }));

    await delay(420);
    removeTypingIndicator();

    addMessage({
      sender: "bot",
      text: response.ok
        ? data.response || "I could not generate a response."
        : data.error || "Something went wrong. Please try again.",
      imageUrl: response.ok ? data.imageUrl : "",
      projectKeys,
      showHireCard,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    pendingRequest = null;
    await delay(300);
    removeTypingIndicator();
    addMessage({
      sender: "bot",
      text: getOfflineFallback(text),
      projectKeys,
      showHireCard,
      timestamp: new Date().toISOString(),
    });
  } finally {
    setLoading(false);
    messageInput.focus();
  }
}

function clearActiveChat() {
  const session = getActiveSession();
  if (session) {
    session.messages = [getWelcomeMessage(activeMode)];
    saveSessions();
    renderSession();
  }
}

function downloadActiveChat() {
  const blob = new Blob([getActiveChatText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sudarshan-${activeMode}-chat.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function shareActiveChat() {
  const shareText = encodeURIComponent(getActiveChatText() || "Sudarshan AI chat");
  window.open(`https://wa.me/?text=${shareText}`, "_blank", "noopener,noreferrer");
}

function copyActiveChat() {
  copyText(getActiveChatText());
}

async function copyText(text) {
  await navigator.clipboard?.writeText(text);
}

function getActiveChatText() {
  const session = getActiveSession();
  if (!session || !session.messages) return "";
  return session.messages
    .map((message) => `${message.sender.toUpperCase()}: ${message.text}`)
    .join("\n\n");
}

function createProjectCard(project) {
  const card = document.createElement("section");
  card.className = "project-card";
  card.innerHTML = `
    <strong>${project.name}</strong>
    <p>${project.description}</p>
    <div class="tag-row">
      ${project.techStack.map((tech) => `<span class="tech-tag">${tech}</span>`).join("")}
    </div>
    <div class="action-row">
      <a class="card-link" href="${project.github}" target="_blank" rel="noreferrer">GitHub</a>
      ${
        project.live
          ? `<a class="card-link" href="${project.live}" target="_blank" rel="noreferrer">Live</a>`
          : ""
      }
    </div>
  `;
  return card;
}

function createHireCard() {
  const card = document.createElement("section");
  card.className = "hire-card";
  card.innerHTML = `
    <strong>Want to work together?</strong>
    <p>I am open to freelance, internships, full-time roles, and client projects.</p>
    <div class="action-row">
      <a class="hire-link whatsapp" href="https://wa.me/?text=${encodeURIComponent(
        CONTACT.whatsappText,
      )}" target="_blank" rel="noreferrer">WhatsApp</a>
      <a class="hire-link email" href="mailto:${CONTACT.email}">Email</a>
      <a class="hire-link" href="${CONTACT.linkedin}" target="_blank" rel="noreferrer">LinkedIn</a>
    </div>
  `;
  return card;
}

function getProjectKeysFromText(text) {
  const lowerText = text.toLowerCase();

  if (/\b(project|projects|work|portfolio)\b/i.test(text)) {
    return Object.keys(PROJECTS);
  }

  return Object.entries(PROJECTS)
    .filter(([, project]) =>
      project.keywords.some((keyword) => lowerText.includes(keyword)),
    )
    .map(([key]) => key);
}

function getProjectsByKeys(keys) {
  if (activeMode !== "portfolio") return [];
  return [...new Set(keys)].map((key) => PROJECTS[key]).filter(Boolean);
}

function shouldShowHireCard(text) {
  return /\b(hire|hiring|freelance|client project|work with you|available|skills|services|projects?)\b/i.test(
    text,
  );
}

function getEasterEggResponse(text) {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("are you human")) {
    return "Not human, but built to represent Sudarshan clearly.\n• I answer using his portfolio data\n• I can also help in General AI Mode";
  }

  if (normalized.includes("who made you")) {
    return "Sudarshan built this assistant as a portfolio AI project.\n• Frontend: HTML, CSS, JavaScript\n• Backend: Vercel API with Groq\n• Knowledge: structured RAG data";
  }

  return "";
}

function getOfflineFallback(text) {
  if (shouldShowHireCard(text)) {
    return "Yes, Sudarshan is open to work.\n• Freelance projects\n• Internships and full-time roles\n• Frontend, full-stack, and API integration work";
  }

  if (/github/i.test(text)) {
    return `Here is Sudarshan's GitHub.\n\n• GitHub: ${CONTACT.github}`;
  }

  if (/linkedin|contact/i.test(text)) {
    return `You can contact Sudarshan here.\n\n• LinkedIn: ${CONTACT.linkedin}\n• Portfolio: ${CONTACT.portfolio}`;
  }

  if (/project/i.test(text)) {
    return "Sudarshan's main projects are ready to view.\n• Mind Bloom\n• Social Media App\n• AI Text Summarizer";
  }

  return "I am temporarily offline.\n• Your chat is saved\n• Please try again in a moment";
}

function trackQuestion(question) {
  const analytics = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]");
  analytics.push({
    question,
    mode: activeMode,
    timestamp: new Date().toISOString(),
  });
  localStorage.setItem(ANALYTICS_KEY, JSON.stringify(analytics.slice(-100)));
}

function startVoiceInput() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    messageInput.value = "Voice input is not supported in this browser.";
    return;
  }

  if (recognition) {
    recognition.stop();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceButton.classList.add("listening");
  voiceButton.textContent = "Stop";
  voiceButton.title = "Stop listening";
  messageInput.placeholder = "Listening...";

  recognition.onresult = (event) => {
    messageInput.value = event.results[0][0].transcript;
    messageInput.focus();
  };

  recognition.onerror = () => {
    messageInput.value = "Microphone permission was blocked or unavailable.";
  };

  recognition.onend = () => {
    clearTimeout(voiceTimeout);
    voiceTimeout = null;
    recognition = null;
    voiceButton.classList.remove("listening");
    voiceButton.textContent = "Mic";
    voiceButton.title = "Voice input";
    messageInput.placeholder =
      activeMode === "portfolio"
        ? "Ask about Sudarshan's projects, skills, or contact links..."
        : "Ask anything, or type: generate image of modern app UI";
  };

  recognition.start();
  voiceTimeout = setTimeout(() => {
    recognition?.stop();
  }, 9000);
}

function initHistoryRail() {
  const app = document.querySelector(".chat-app");
  if (!app || document.querySelector(".history-rail")) return;

  const rail = document.createElement("aside");
  rail.className = "history-rail";
  rail.innerHTML = `
    <div class="history-title">Older Chats</div>
    <div id="historyList" class="history-list"></div>
  `;
  app.prepend(rail);
}

function renderHistoryRail() {
  const list = document.getElementById("historyList");
  if (!list) return;

  list.innerHTML = "";
  const modeData = sessions[activeMode];
  
  if (!modeData?.sessions || modeData.sessions.length === 0) {
    return;
  }

  modeData.sessions
    .slice(-8)
    .reverse()
    .forEach((session) => {
      const button = document.createElement("button");
      button.className = "history-item";
      if (session.id === modeData.activeSessionId) {
        button.classList.add("active");
      }
      button.type = "button";
      button.textContent = session.title.slice(0, 54);
      button.title = session.title;
      button.addEventListener("click", () => {
        sessions[activeMode].activeSessionId = session.id;
        saveSessions();
        renderSession();
        renderHistoryRail();
      });
      list.appendChild(button);
    });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  sendMessage(text);
});

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

suggestionChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (isSending) return;
    const prompt = chip.dataset.prompt;
    messageInput.value = "";
    sendMessage(prompt);
  });
});

clearChatButton.addEventListener("click", clearActiveChat);
downloadChatButton.addEventListener("click", downloadActiveChat);
shareChatButton.addEventListener("click", shareActiveChat);
copyChatButton.addEventListener("click", copyActiveChat);
voiceButton.addEventListener("click", startVoiceInput);

setMode(activeMode);
