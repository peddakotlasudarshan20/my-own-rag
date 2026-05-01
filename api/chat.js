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
You are a portfolio assistant for Sudarshan.

Use the provided data as the primary source.
If the exact answer is not available:
- infer logically based on skills, projects, education, availability, and experience
- give realistic and professional answers
- do NOT hallucinate fake companies, achievements, certifications, clients, salaries, contact details, or experience
- if a question asks for information that cannot be inferred safely, say "I don't have that information"

Keep answers natural, concise, confident, and helpful. Prefer 2-4 short sentences unless the user asks for details.
For common intent questions, answer directly:
- client projects: say yes and mention availability plus relevant services
- work type: summarize services and project experience
- experience: mention industrial training, hands-on projects, and full-stack exposure without overstating seniority
- contact: share GitHub, LinkedIn, and portfolio links

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
