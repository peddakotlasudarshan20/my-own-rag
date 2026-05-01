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
Answer ONLY using this portfolio data:
${portfolioData}

If the answer is not in the data, say "I don't have that information".

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
