import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ChatGroq } from "@langchain/groq";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { FaissStore } from "@langchain/community/vectorstores/faiss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const portfolioPath = path.join(rootDir, "data", "portfolio.json");
const localFaissPath = path.join(rootDir, "data", "faiss-index-local");
const openAiFaissPath = path.join(rootDir, "data", "faiss-index-openai");

const GROQ_MODEL = "llama-3.1-8b-instant";
const TOP_K_CONTEXT_CHUNKS = 5;
const LOCAL_EMBEDDING_DIMENSIONS = 384;

let vectorStorePromise;

class LocalHashEmbeddings extends Embeddings {
  constructor() {
    super({});
  }

  async embedDocuments(texts) {
    return texts.map((text) => this.embedText(text));
  }

  async embedQuery(text) {
    return this.embedText(text);
  }

  embedText(text) {
    const vector = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
    const tokens = tokenize(expandQueryTerms(text));

    for (const token of tokens) {
      const hash = crypto.createHash("sha256").update(token).digest();
      const index = hash.readUInt32BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
      const sign = hash[4] % 2 === 0 ? 1 : -1;
      vector[index] += sign;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
  }
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function expandQueryTerms(text) {
  const normalizedText = String(text).toLowerCase();
  const expansions = [];

  const intentMap = [
    [["job", "hire", "hiring", "available", "freelance", "client"], "availability roles services opportunities"],
    [["contact", "reach", "email", "linkedin", "github"], "links linkedin github portfolio"],
    [["project", "work", "built", "apps"], "projects github live tech stack impact"],
    [["skill", "technology", "tech", "stack"], "skills languages frontend backend database tools concepts"],
    [["education", "college", "study", "diploma"], "education qualification college focus"],
    [["experience", "training", "company"], "experience industrial training company responsibilities"],
  ];

  for (const [terms, expansion] of intentMap) {
    if (terms.some((term) => normalizedText.includes(term))) {
      expansions.push(expansion);
    }
  }

  return [text, ...expansions].join(" ");
}

function humanizeKey(key) {
  return key.replace(/_/g, " ");
}

function stringifyValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "object" ? stringifyValue(item) : String(item)))
      .join(", ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${humanizeKey(key)}: ${stringifyValue(item)}`)
      .join("\n");
  }

  return String(value);
}

function buildPortfolioSections(portfolio) {
  const documents = [
    new Document({
      pageContent: `Profile\nName: ${portfolio.name}\nRole: ${portfolio.role}\nAbout: ${portfolio.about}`,
      metadata: { source: "portfolio.json", section: "profile" },
    }),
  ];

  for (const [key, value] of Object.entries(portfolio)) {
    if (["name", "role", "about", "projects"].includes(key)) {
      continue;
    }

    documents.push(
      new Document({
        pageContent: `${humanizeKey(key)}\n${stringifyValue(value)}`,
        metadata: { source: "portfolio.json", section: key },
      }),
    );
  }

  for (const project of portfolio.projects || []) {
    documents.push(
      new Document({
        pageContent: `Project: ${project.name}\n${stringifyValue(project)}`,
        metadata: {
          source: "portfolio.json",
          section: "projects",
          project: project.name,
        },
      }),
    );
  }

  return documents;
}

async function loadPortfolioDocuments() {
  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, "utf8"));
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 650,
    chunkOverlap: 80,
  });

  return splitter.splitDocuments(buildPortfolioSections(portfolio));
}

function createEmbeddings() {
  if (process.env.OPENAI_API_KEY) {
    return {
      embeddings: new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
        model: "text-embedding-3-small",
      }),
      indexPath: openAiFaissPath,
    };
  }

  return {
    embeddings: new LocalHashEmbeddings(),
    indexPath: localFaissPath,
  };
}

async function createVectorStore() {
  const { embeddings, indexPath } = createEmbeddings();

  if (fs.existsSync(path.join(indexPath, "faiss.index"))) {
    return FaissStore.load(indexPath, embeddings);
  }

  const documents = await loadPortfolioDocuments();
  const vectorStore = await FaissStore.fromDocuments(documents, embeddings);

  try {
    fs.mkdirSync(indexPath, { recursive: true });
    await vectorStore.save(indexPath);
  } catch (error) {
    console.warn("Unable to persist FAISS index:", error.message);
  }

  return vectorStore;
}

async function getVectorStore() {
  if (!vectorStorePromise) {
    vectorStorePromise = createVectorStore();
  }

  return vectorStorePromise;
}

async function retrieveRelevantContext(question) {
  const vectorStore = await getVectorStore();
  const documents = await vectorStore.similaritySearch(
    expandQueryTerms(question),
    TOP_K_CONTEXT_CHUNKS,
  );

  return documents
    .map((document, index) => `Context chunk ${index + 1}:\n${document.pageContent}`)
    .join("\n\n");
}

function createGroqModel() {
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: GROQ_MODEL,
    temperature: 0.1,
  });
}

const portfolioPrompt = PromptTemplate.fromTemplate(`
You are Sudarshan's AI assistant.

Use ONLY the provided context to answer.
If the answer is not in the context, say exactly:
"I don't have that information based on available data."

Be clear, structured, and concise.
Do not hallucinate, guess, or add facts that are not supported by the context.
Do not mention that chunks, retrieval, embeddings, FAISS, or JSON were used.
When the context includes links requested by the user, include those exact links.
For lists, use short bullets.

Context:
{context}

User question:
{question}
`);

const generalPrompt = PromptTemplate.fromTemplate(`
You are a helpful AI assistant.
Answer only what the user asks.
Be clear, accurate, concise, and direct.
Do not inject Sudarshan's portfolio data.

User question:
{question}
`);

export async function runPortfolioRag(message) {
  const model = createGroqModel();
  const chain = RunnableSequence.from([
    {
      question: new RunnableLambda({ func: (input) => input.question }),
      context: new RunnableLambda({
        func: async (input) => retrieveRelevantContext(input.question),
      }),
    },
    portfolioPrompt,
    model,
    new StringOutputParser(),
  ]);

  return chain.invoke({ question: message });
}

export async function runGeneralChat(message) {
  const model = createGroqModel();
  const chain = RunnableSequence.from([
    generalPrompt,
    model,
    new StringOutputParser(),
  ]);

  return chain.invoke({ question: message });
}
