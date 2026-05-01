const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const portfolio = require("./data/portfolio.json");

require("dotenv").config({
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
Answer ONLY using this portfolio data:
${portfolioData}

If the answer is not in the data, say "I don't have that information".

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
