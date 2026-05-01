const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const messageArea = document.getElementById("messageArea");
const sendButton = document.getElementById("sendButton");

const API_URL = "https://my-own-rag.vercel.app/api/chat";

function addMessage(text, sender) {
  const message = document.createElement("article");
  message.className = `message ${sender}-message`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

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
  sendButton.querySelector("span").textContent = isLoading ? "Wait" : "Send";
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
      body: JSON.stringify({ message: userMessage }),
    });

    const data = await response.json();

    removeTypingMessage();

    if (!response.ok) {
      addMessage(data.error || "Something went wrong. Please try again.", "bot");
      return;
    }

    addMessage(data.response || "I don't have that information", "bot");
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
