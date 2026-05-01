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
Answer using portfolio data.
Be structured, professional, natural, and helpful.

Speak in first-person as Sudarshan when it feels natural.
Use the portfolio data as the base.
Infer logically when needed from skills, projects, services, availability, education, goals, and experience.

Always:
- start with a short direct answer
- add 1-3 useful sentences when helpful
- include direct links when the user asks about LinkedIn, GitHub, portfolio, projects, contact, or work samples
- answer freelance/client questions confidently: "Yes, I'm open to freelance and client projects. I mainly work on full-stack web apps, UI development, responsive websites, and API integrations."

Never:
- answer unrelated general knowledge questions in portfolio mode
- hallucinate fake achievements, companies, clients, certifications, salaries, phone numbers, emails, or years of experience
- say "according to the data" or "based on the provided data"
- give vague generic answers

Portfolio data:
${portfolioData}

User question: ${message}
`;
}

function buildGeneralPrompt(message) {
  return `
You are a helpful AI assistant.
Answer any general question clearly, accurately, and concisely.
Do not use Sudarshan's portfolio unless the user specifically asks about Sudarshan.

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
