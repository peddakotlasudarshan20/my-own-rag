import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ChatGroq } from "@langchain/groq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { getPortfolioData } from "./portfolioFetcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const portfolioPath = path.join(rootDir, "data", "portfolio.json");

const GROQ_MODEL = "llama-3.1-8b-instant";
const HUGGINGFACE_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const TOP_K_CONTEXT_CHUNKS = 7;
const CANDIDATE_CONTEXT_CHUNKS = 10;
const MAX_ACCEPTED_DISTANCE = 2;
const LOCAL_EMBEDDING_DIMENSIONS = 384;
const VECTOR_STORE_REFRESH_MS = 15 * 60 * 1000;
const NO_CONTEXT_REPLY = "I don't have that information based on available data.";
const SAFE_ERROR_REPLY = "Something went wrong. Please try again.";
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

let embeddingsInstance;
let vectorStoreState;
let vectorStorePromise;
let activeFaissIndexPath;

class LocalFallbackEmbeddings extends Embeddings {
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
    const tokens = String(text)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9+#.]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1);

    for (const token of tokens) {
      const hash = crypto.createHash("sha256").update(token).digest();
      const index = hash.readUInt32BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
      vector[index] += hash[4] % 2 === 0 ? 1 : -1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
  }
}

function createEmbeddings() {
  if (!embeddingsInstance) {
    const apiKey =
      process.env.HUGGINGFACEHUB_API_KEY ||
      process.env.HUGGINGFACE_API_KEY ||
      process.env.HF_TOKEN;

    if (apiKey) {
      embeddingsInstance = new HuggingFaceInferenceEmbeddings({
        apiKey,
        model: HUGGINGFACE_MODEL,
      });
      activeFaissIndexPath = path.join(rootDir, "data", "faiss-index-live-hf-api");
    } else {
      embeddingsInstance = new LocalFallbackEmbeddings();
      activeFaissIndexPath = path.join(rootDir, "data", "faiss-index-live-hf");
    }
  }

  return embeddingsInstance;
}

function toList(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function enrichQuery(question) {
  const normalizedQuestion = String(question).toLowerCase();
  const expansions = [];
  const intentExpansions = [
    {
      terms: ["project", "projects", "built", "work", "app", "application", "github", "live"],
      text: "Sudarshan portfolio projects project work built application tech stack github live demo impact",
    },
    {
      terms: ["skill", "skills", "technology", "technologies", "stack", "language", "frontend", "backend"],
      text: "Sudarshan skills languages frontend backend database tools concepts technologies tech stack",
    },
    {
      terms: ["experience", "training", "company", "internship", "role"],
      text: "Sudarshan experience industrial training company role responsibilities tools used",
    },
    {
      terms: ["education", "college", "diploma", "study", "qualification"],
      text: "Sudarshan education qualification diploma college focus status",
    },
    {
      terms: ["available", "availability", "hire", "freelance", "client", "service", "services"],
      text: "Sudarshan availability roles freelance client projects services opportunities",
    },
    {
      terms: ["link", "links", "contact", "linkedin", "github", "portfolio"],
      text: "Sudarshan links contact github linkedin portfolio",
    },
  ];

  for (const { terms, text } of intentExpansions) {
    if (terms.some((term) => normalizedQuestion.includes(term))) {
      expansions.push(text);
    }
  }

  return [question, ...expansions].join("\n");
}

function getQuestionIntent(question) {
  const normalizedQuestion = String(question).toLowerCase();
  const intentMatchers = [
    { type: "project", terms: ["project", "projects", "built", "work", "app", "application", "github", "live"] },
    { type: "skills", terms: ["skill", "skills", "technology", "technologies", "stack", "language", "frontend", "backend"] },
    { type: "experience", terms: ["experience", "training", "company", "internship", "role"] },
    { type: "education", terms: ["education", "college", "diploma", "study", "qualification"] },
    { type: "availability", terms: ["available", "availability", "hire", "freelance", "client", "service", "services"] },
    { type: "links", terms: ["link", "links", "contact", "linkedin", "github", "portfolio"] },
  ];

  return intentMatchers.find(({ terms }) =>
    terms.some((term) => normalizedQuestion.includes(term)),
  )?.type;
}

function createDocument(pageContent, metadata, source = "live-portfolio") {
  return new Document({
    pageContent: pageContent
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
    metadata: {
      source,
      ...metadata,
    },
  });
}

function formatDebugChunk(document, score, index) {
  return {
    index: index + 1,
    score,
    metadata: document.metadata,
    content: document.pageContent,
  };
}

function logRetrieval(question, chunks) {
  if (!IS_DEVELOPMENT) {
    return;
  }

  console.log(
    "RAG retrieval:",
    JSON.stringify(
      {
        question,
        chunks: chunks.map(({ document, score }, index) =>
          formatDebugChunk(document, score, index),
        ),
      },
      null,
      2,
    ),
  );
}

function buildSkillDocuments(skills = {}, source = "live-portfolio") {
  const skillGroups = Object.entries(skills);

  if (skillGroups.length === 0) {
    return [];
  }

  return [
    createDocument(
      [
        "Skills",
        ...skillGroups.map(([group, values]) => `${group}: ${toList(values)}.`),
      ].join("\n"),
      { type: "skills", section: "skills" },
      source,
    ),
  ];
}

function projectTitle(project) {
  return project.title || project.name || "Untitled project";
}

function projectTechStack(project) {
  return project.techStack || project.tech_stack || [];
}

function projectLink(project, key) {
  return project.links?.[key] || project[key] || "";
}

function buildLinksDocument(links = {}, source = "live-portfolio") {
  const linkEntries = Object.entries(links)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  if (linkEntries.length === 0) {
    return [];
  }

  return [
    createDocument(
      ["Links", ...linkEntries].join("\n"),
      { type: "links", section: "links" },
      source,
    ),
  ];
}

function buildAboutDocument(portfolio) {
  return createDocument(
    [
      "About Sudarshan",
      `Name: ${portfolio.name}`,
      `Role: ${portfolio.role}`,
      `About: ${portfolio.about}`,
    ].join("\n"),
    { type: "about", section: "profile" },
    portfolio.source,
  );
}

function buildProjectDocuments(projects = [], source = "live-portfolio") {
  return projects.map((project) =>
    createDocument(
      [
        `Project: ${projectTitle(project)}`,
        `Description: ${project.description}`,
        `Tech stack: ${toList(projectTechStack(project))}`,
        projectLink(project, "github") ? `GitHub: ${projectLink(project, "github")}` : "",
        projectLink(project, "live") ? `Live: ${projectLink(project, "live")}` : "",
      ].join("\n"),
      { type: "project", project: projectTitle(project) },
      source,
    ),
  );
}

function buildPortfolioDocuments(portfolio) {
  return [
    buildAboutDocument(portfolio),
    ...buildSkillDocuments(portfolio.skills, portfolio.source),
    ...buildProjectDocuments(portfolio.projects, portfolio.source),
    ...buildLinksDocument(portfolio.links, portfolio.source),
  ];
}

async function buildVectorStore() {
  const embeddings = createEmbeddings();

  try {
    const portfolio = await getPortfolioData(portfolioPath, {
      ttlMs: VECTOR_STORE_REFRESH_MS,
    });
    const documents = buildPortfolioDocuments(portfolio);
    const vectorStore = await FaissStore.fromDocuments(documents, embeddings);

    try {
      await fs.mkdir(activeFaissIndexPath, { recursive: true });
      await vectorStore.save(activeFaissIndexPath);
    } catch (error) {
      console.warn("FAISS persistence skipped:", error.message);
    }

    return {
      vectorStore,
      builtAt: Date.now(),
      source: portfolio.source,
      fetchedAt: portfolio.fetchedAt,
    };
  } catch (error) {
    console.error("FAISS build failed:", error);
    throw new Error("Vector store initialization failed");
  }
}

async function getRetriever() {
  const now = Date.now();

  if (vectorStoreState && now - vectorStoreState.builtAt < VECTOR_STORE_REFRESH_MS) {
    return vectorStoreState.vectorStore;
  }

  if (!vectorStorePromise) {
    vectorStorePromise = buildVectorStore()
      .then((state) => {
        vectorStoreState = state;
        return vectorStoreState;
      })
      .finally(() => {
        vectorStorePromise = null;
      });
  }

  if (vectorStoreState) {
    vectorStorePromise.catch((error) => {
      console.error("Background vector refresh failed:", error);
    });
    return vectorStoreState.vectorStore;
  }

  return (await vectorStorePromise).vectorStore;
}

async function retrieveContext(question) {
  try {
    const vectorStore = await getRetriever();
    const intent = getQuestionIntent(question);
    const results = await vectorStore.similaritySearchWithScore(
      enrichQuery(question),
      CANDIDATE_CONTEXT_CHUNKS,
    );

    const scoredResults = results
      .filter(([, score]) => Number.isFinite(score) && score <= MAX_ACCEPTED_DISTANCE)
      .sort((left, right) => left[1] - right[1]);

    const relevantResults = scoredResults
      .filter(([document]) => !intent || document.metadata?.type === intent);

    const fallbackResults = scoredResults;

    const selectedResults = (relevantResults.length > 0 ? relevantResults : fallbackResults)
      .slice(0, TOP_K_CONTEXT_CHUNKS)
      .map(([document, score]) => ({ document, score }));

    if (selectedResults.length === 0) {
      logRetrieval(question, []);
      return {
        context: "",
        chunks: [],
      };
    }

    logRetrieval(question, selectedResults);

    return {
      context: selectedResults
      .map(({ document }, index) => {
        const label = document.metadata?.type || "context";
        return `Context ${index + 1} (${label}):\n${document.pageContent}`;
      })
      .join("\n\n"),
      chunks: selectedResults.map(({ document, score }, index) =>
        formatDebugChunk(document, score, index),
      ),
    };
  } catch (error) {
    console.error("Retrieval failed:", error);
    throw new Error("Retrieval failed");
  }
}

function createGroqModel() {
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: GROQ_MODEL,
    temperature: 0,
  });
}

const portfolioPrompt = PromptTemplate.fromTemplate(`
You are Sudarshan's AI assistant.

Use ONLY the provided context to answer.
If the answer is not in the context, say:
"I don't have that information based on available data."

Be clear, structured, and concise.
Use bullet points when appropriate.
Do not guess, infer unsupported facts, or answer from general knowledge.
Do not mention internal context, retrieval, embeddings, FAISS, or files.
Use only exact links present in the context.

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

export async function runPortfolioRag(message, options = {}) {
  try {
    const retrieval = await retrieveContext(message);
    const context = retrieval.context;

    if (!context) {
      if (options.debug) {
        return {
          reply: NO_CONTEXT_REPLY,
          debug: {
            retrievedContext: "",
            retrievedChunks: [],
            finalAnswer: NO_CONTEXT_REPLY,
          },
        };
      }

      return NO_CONTEXT_REPLY;
    }

    const chain = RunnableSequence.from([
      {
        question: new RunnableLambda({ func: (input) => input.question }),
        context: new RunnableLambda({ func: (input) => input.context }),
      },
      portfolioPrompt,
      createGroqModel(),
      new StringOutputParser(),
    ]);

    const answer = await chain.invoke({ question: message, context });

    if (options.debug) {
      return {
        reply: answer,
        debug: {
          retrievedContext: context,
          retrievedChunks: retrieval.chunks,
          finalAnswer: answer,
        },
      };
    }

    return answer;
  } catch (error) {
    console.error("RAG failed:", error);
    return SAFE_ERROR_REPLY;
  }
}

export async function runGeneralChat(message) {
  try {
    const chain = RunnableSequence.from([
      generalPrompt,
      createGroqModel(),
      new StringOutputParser(),
    ]);

    return await chain.invoke({ question: message });
  } catch (error) {
    console.error("General chat failed:", error);
    return SAFE_ERROR_REPLY;
  }
}
