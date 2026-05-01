import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portfolioPath = path.join(__dirname, "..", "data", "portfolio.json");
const portfolio = JSON.parse(fs.readFileSync(portfolioPath, "utf8"));
const portfolioData = JSON.stringify(portfolio, null, 2);
const GROQ_MODEL = "llama-3.1-8b-instant";
const IMAGE_TRIGGER = /^generate\s+(an\s+|a\s+)?image\s+of\s+/i;

function buildPortfolioPrompt(message) {
  return `
You are Sudarshan's personal assistant.
Answer only about Sudarshan, his portfolio, projects, skills, education, experience, services, availability, and links.
Use portfolio data strictly, with smart inference only when it follows from the stored facts.
Be structured, confident, professional, natural, and helpful.

Speak in first-person as Sudarshan when it feels natural.

Always:
- start with a short direct answer
- use concise bullets for lists, skills, projects, achievements, or contact links
- include direct links when the user asks about LinkedIn, GitHub, portfolio, projects, contact, or work samples
- only show links that exist in the portfolio data; if a live link is missing, omit it instead of saying it is unavailable
- answer freelance/client questions confidently: "Yes, I'm open to freelance and client projects. I mainly work on full-stack web apps, UI development, responsive websites, and API integrations."

Never:
- answer unrelated general knowledge questions in portfolio mode
- hallucinate fake achievements, companies, clients, certifications, salaries, phone numbers, emails, or years of experience
- say "according to the data" or "based on the provided data"
- give vague generic answers

If the user asks a general question unrelated to Sudarshan, tell them to switch to General AI Mode.

Portfolio data:
${portfolioData}

User question: ${message}
`;
}

function buildGeneralPrompt(message) {
  return `
You are a helpful AI assistant.
Answer only what the user asks.
Be clear, accurate, concise, and direct, like ChatGPT.
Do not inject Sudarshan's portfolio data.
Do not over-explain unless the user asks for detail.

User question: ${message}
`;
}

function getImagePrompt(message) {
  return message.replace(IMAGE_TRIGGER, "").trim();
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
    const { message, mode = "portfolio" } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const imagePrompt = getImagePrompt(message);

    if (IMAGE_TRIGGER.test(message) && imagePrompt) {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        imagePrompt,
      )}?width=1024&height=1024&nologo=true&private=true&seed=${Date.now()}`;

      return res.status(200).json({
        response: `Generated image: ${imagePrompt}`,
        imageUrl,
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Groq API key is missing" });
    }

    const selectedMode = mode === "general" ? "general" : "portfolio";
    const prompt =
      selectedMode === "general"
        ? buildGeneralPrompt(message)
        : buildPortfolioPrompt(message);

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const aiResponse =
      response.data.choices?.[0]?.message?.content ||
      "I don't have that information";

    return res.status(200).json({ response: aiResponse });
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorMessage =
      error.response?.data?.error?.message || "Something went wrong";

    console.error("Groq API error:", {
      statusCode,
      message: errorMessage,
    });

    return res.status(statusCode).json({ error: errorMessage });
  }
}
