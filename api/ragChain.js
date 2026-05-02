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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const portfolioPath = path.join(rootDir, "data", "portfolio.json");

const GROQ_MODEL = "llama-3.1-8b-instant";
const HUGGINGFACE_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const TOP_K_CONTEXT_CHUNKS = 3;
const CANDIDATE_CONTEXT_CHUNKS = 15;
const MAX_ACCEPTED_DISTANCE = 1.45;
const LOCAL_EMBEDDING_DIMENSIONS = 384;
const NO_CONTEXT_REPLY = "I don't have that information based on available data.";
const SAFE_ERROR_REPLY = "Something went wrong. Please try again.";
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

let embeddingsInstance;
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
      activeFaissIndexPath = path.join(rootDir, "data", "faiss-index-hf-api");
    } else {
      embeddingsInstance = new LocalFallbackEmbeddings();
      activeFaissIndexPath = path.join(rootDir, "data", "faiss-index-hf");
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

function createDocument(pageContent, metadata) {
  return new Document({
    pageContent: pageContent
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
    metadata: {
      source: "portfolio.json",
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

async function loadData() {
  const rawPortfolio = await fs.readFile(portfolioPath, "utf8");
  return JSON.parse(rawPortfolio);
}

function buildSkillDocuments(skills = {}) {
  const skillGroups = Object.entries(skills);

  return skillGroups.map(([group, values]) =>
    createDocument(
      [
        `Skills section: ${group}`,
        `${group} skills: ${toList(values)}.`,
      ].join("\n"),
      { type: "skills", section: group },
    ),
  );
}

function buildProjectDocuments(projects = []) {
  return projects.map((project) =>
    createDocument(
      [
        `Project: ${project.name}`,
        `Type: ${project.type}`,
        `Description: ${project.description}`,
        `Tech stack: ${toList(project.tech_stack)}`,
        `Impact: ${project.impact}`,
        project.github ? `GitHub: ${project.github}` : "",
        project.live ? `Live: ${project.live}` : "",
      ].join("\n"),
      { type: "project", project: project.name },
    ),
  );
}

function buildPortfolioDocuments(portfolio) {
  return [
    createDocument(
      [
        `About Sudarshan`,
        `Name: ${portfolio.name}`,
        `Role: ${portfolio.role}`,
        `About: ${portfolio.about}`,
        `Personality: ${toList(portfolio.personality)}`,
        `Strengths: ${toList(portfolio.strengths)}`,
      ].join("\n"),
      { type: "about", section: "profile" },
    ),
    createDocument(
      [
        `Education`,
        `Qualification: ${portfolio.education?.qualification}`,
        `College: ${portfolio.education?.college}`,
        `Status: ${portfolio.education?.status}`,
        `Focus: ${toList(portfolio.education?.focus)}`,
      ].join("\n"),
      { type: "education", section: "education" },
    ),
    ...buildSkillDocuments(portfolio.skills),
    ...buildProjectDocuments(portfolio.projects),
    createDocument(
      [
        `Experience`,
        `Type: ${portfolio.experience?.type}`,
        `Company: ${portfolio.experience?.company}`,
        `Location: ${portfolio.experience?.location}`,
        `Role: ${portfolio.experience?.role}`,
        `Duration: ${portfolio.experience?.duration}`,
        `Tools used: ${toList(portfolio.experience?.tools_used)}`,
        `Responsibilities: ${toList(portfolio.experience?.responsibilities)}`,
        `Description: ${portfolio.experience?.description}`,
      ].join("\n"),
      { type: "experience", section: "experience" },
    ),
    createDocument(
      [
        `Availability and services`,
        `Availability status: ${portfolio.availability?.status}`,
        `Roles: ${toList(portfolio.availability?.roles)}`,
        `Client projects: ${portfolio.availability?.client_projects}`,
        `Services: ${toList(portfolio.services)}`,
        `Goals: short term - ${portfolio.goals?.short_term}; long term - ${portfolio.goals?.long_term}`,
      ].join("\n"),
      { type: "availability", section: "availability" },
    ),
    createDocument(
      [
        `Links`,
        `GitHub: ${portfolio.links?.github}`,
        `LinkedIn: ${portfolio.links?.linkedin}`,
        `Portfolio: ${portfolio.links?.portfolio}`,
      ].join("\n"),
      { type: "links", section: "links" },
    ),
    createDocument(
      [
        `Achievements and certifications`,
        `Achievements: ${toList(portfolio.achievements)}`,
        `Certifications: ${toList(
          portfolio.certifications?.map(
            (certification) =>
              `${certification.name} - ${certification.status}. ${certification.description}`,
          ),
        )}`,
      ].join("\n"),
      { type: "achievements", section: "achievements" },
    ),
  ];
}

async function hasPersistedIndex() {
  try {
    await fs.access(path.join(activeFaissIndexPath, "faiss.index"));
    await fs.access(path.join(activeFaissIndexPath, "docstore.json"));
    return true;
  } catch {
    return false;
  }
}

async function buildVectorStore() {
  const embeddings = createEmbeddings();

  if (await hasPersistedIndex()) {
    try {
      return await FaissStore.load(activeFaissIndexPath, embeddings);
    } catch (error) {
      console.error("FAISS load failed:", error);
    }
  }

  try {
    const portfolio = await loadData();
    const documents = buildPortfolioDocuments(portfolio);
    const vectorStore = await FaissStore.fromDocuments(documents, embeddings);

    try {
      await fs.mkdir(activeFaissIndexPath, { recursive: true });
      await vectorStore.save(activeFaissIndexPath);
    } catch (error) {
      console.warn("FAISS persistence skipped:", error.message);
    }

    return vectorStore;
  } catch (error) {
    console.error("FAISS build failed:", error);
    throw new Error("Vector store initialization failed");
  }
}

async function getRetriever() {
  if (!vectorStorePromise) {
    vectorStorePromise = buildVectorStore();
  }

  return vectorStorePromise;
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
