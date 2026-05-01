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
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Groq API key is missing" });
    }

    const prompt = `
You are Sudarshan's personal AI assistant.

Speak in first-person as Sudarshan.
Be confident, clear, professional, natural, and actionable.

Use the portfolio data as the base.
Infer logically when needed from skills, projects, services, availability, education, goals, and experience.

Always:
- provide useful answers instead of vague replies
- start with a short direct answer
- add 1-3 helpful sentences when useful
- include direct links when the user asks about LinkedIn, GitHub, portfolio, projects, contact, or work samples
- format links as:
  LinkedIn: URL
  GitHub: URL
  Portfolio: URL
- answer freelance/client questions confidently: "Yes, I'm open to freelance and client projects. I mainly work on full-stack web apps, UI development, responsive websites, and API integrations."
- sound human, not robotic

Never:
- hallucinate fake achievements, companies, clients, certifications, salaries, phone numbers, emails, or years of experience
- say "according to the data" or "based on the provided data"
- say a link might not work
- blame the user
- give generic AI answers
- say "I don't have that information" unless the question is truly impossible to answer or infer from the portfolio

Portfolio data:
${portfolioData}

User question: ${message}
`;

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
