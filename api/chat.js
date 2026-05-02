import { runGeneralChat, runPortfolioRag } from "./ragChain.js";

const IMAGE_TRIGGER = /^generate\s+(an\s+|a\s+)?image\s+of\s+/i;

function getImagePrompt(message) {
  return message.replace(IMAGE_TRIGGER, "").trim();
}

function sendAiResponse(res, statusCode, reply, extra = {}) {
  return res.status(statusCode).json({
    response: reply,
    reply,
    ...extra,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { message, mode = "portfolio" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const imagePrompt = getImagePrompt(message);

    if (IMAGE_TRIGGER.test(message) && imagePrompt) {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        imagePrompt,
      )}?width=1024&height=1024&nologo=true&private=true&seed=${Date.now()}`;

      return sendAiResponse(
        res,
        200,
        `Generated image: ${imagePrompt}`,
        { imageUrl },
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Groq API key is missing" });
    }

    const selectedMode = mode === "general" ? "general" : "portfolio";
    const reply =
      selectedMode === "general"
        ? await runGeneralChat(message)
        : await runPortfolioRag(message);

    return sendAiResponse(res, 200, reply || "I don't have that information");
  } catch (error) {
    const statusCode = error.status || error.response?.status || 500;
    const errorMessage =
      error.response?.data?.error?.message ||
      error.message ||
      "Something went wrong";

    console.error("LangChain RAG error:", {
      statusCode,
      message: errorMessage,
    });

    return res.status(statusCode).json({ error: errorMessage });
  }
}
