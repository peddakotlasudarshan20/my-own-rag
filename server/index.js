import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portfolioPath = path.join(__dirname, "..", "data", "portfolio.json");
const portfolio = JSON.parse(fs.readFileSync(portfolioPath, "utf8"));

dotenv.config({
  path: path.join(__dirname, ".env"),
  quiet: true,
});

const app = express();
const PORT = process.env.PORT || 5000;
const GROQ_MODEL = "llama-3.1-8b-instant";
const portfolioData = JSON.stringify(portfolio, null, 2);

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server running");
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
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

User question: ${userMessage}
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
      response.data.choices?.[0]?.message?.content || "I don't have that information";

    res.json({ response: aiResponse });
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const errorMessage =
      error.response?.data?.error?.message || "Something went wrong";

    res.status(statusCode).json({ error: errorMessage });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
