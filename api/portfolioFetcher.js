import fs from "fs/promises";
import { load } from "cheerio";

const PORTFOLIO_URL = "https://peddakotlasudarshan20.github.io/";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let cachedPortfolio;
let cachedAt = 0;
let pendingFetch;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

function unique(values) {
  const seen = new Set();

  return values
    .map(normalizeText)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function resolveUrl(value) {
  try {
    return new URL(value, PORTFOLIO_URL).toString();
  } catch {
    return "";
  }
}

function extractSectionText($, selector) {
  const clone = $(selector).first().clone();
  clone.find("script, style, canvas, svg, img, video, iframe, button, form").remove();
  return normalizeText(clone.text());
}

function extractName($) {
  const heroName = unique(
    $(".hero-name .hn-line")
      .map((_, element) => $(element).text())
      .get(),
  ).join(" ");

  return normalizeText(heroName || $("h1").first().text() || $("title").text().split("-")[0]);
}

function extractRole($) {
  return normalizeText(
    $(".hero-subtitle").first().text() ||
      $(".hc-role").first().text() ||
      $('meta[name="description"]').attr("content"),
  );
}

function extractAbout($) {
  const aboutLines = unique(
    $("#about .about-text-block p")
      .map((_, element) => $(element).text())
      .get(),
  );

  return aboutLines.join("\n");
}

function extractSkills($) {
  const groups = {};

  $("#skills .sk-group").each((_, groupElement) => {
    const group = normalizeText($(groupElement).find(".sk-group-label").first().text());
    const values = unique(
      $(groupElement)
        .find(".skill-item span, .skill-item img")
        .map((__, element) => $(element).text() || $(element).attr("alt"))
        .get(),
    );

    if (group && values.length) {
      groups[group] = values;
    }
  });

  if (Object.keys(groups).length === 0) {
    groups.skills = unique(
      $("#skills")
        .find("li, span, p")
        .map((_, element) => $(element).text())
        .get(),
    );
  }

  return groups;
}

function extractProjectLinks($, projectElement) {
  const links = {};

  $(projectElement)
    .find("a[href]")
    .each((_, linkElement) => {
      const href = resolveUrl($(linkElement).attr("href"));
      const label = normalizeText($(linkElement).text()).toLowerCase();

      if (!href || href.endsWith("/#")) {
        return;
      }

      if (label.includes("github") || href.includes("github.com")) {
        links.github = href;
        return;
      }

      if (label.includes("live") || label.includes("demo")) {
        links.live = href;
      }
    });

  return links;
}

function extractProjects($) {
  return $("#projects .proj-item")
    .map((_, projectElement) => {
      const title = normalizeText($(projectElement).find("h3").first().text());
      const description = normalizeText($(projectElement).find("p").first().text());
      const techStack = unique(
        $(projectElement)
          .find(".pi-stack span")
          .map((__, stackElement) => $(stackElement).text())
          .get(),
      );

      if (!title || !description) {
        return null;
      }

      return {
        title,
        description,
        techStack,
        links: extractProjectLinks($, projectElement),
      };
    })
    .get()
    .filter(Boolean);
}

function extractLinks($) {
  const links = {};

  $("a[href]").each((_, linkElement) => {
    const href = resolveUrl($(linkElement).attr("href"));
    const label = normalizeText($(linkElement).text()).toLowerCase();

    if (!href) {
      return;
    }

    if (href.startsWith("mailto:")) {
      links.email = href.replace(/^mailto:/i, "").split("?")[0];
    } else if (href.includes("github.com")) {
      links.github = href;
    } else if (href.includes("linkedin.com")) {
      links.linkedin = href;
    } else if (href === PORTFOLIO_URL || label.includes("portfolio")) {
      links.portfolio = href;
    } else if (href.toLowerCase().includes("resume")) {
      links.resume = href;
    }
  });

  links.portfolio ||= PORTFOLIO_URL;
  return links;
}

function parsePortfolioHtml(html) {
  const $ = load(html);
  $("script, style, noscript, canvas, svg").remove();

  const portfolio = {
    name: extractName($),
    role: extractRole($),
    about: extractAbout($) || extractSectionText($, "#about"),
    skills: extractSkills($),
    projects: extractProjects($),
    links: extractLinks($),
  };

  if (!portfolio.name || !portfolio.about || portfolio.projects.length === 0) {
    throw new Error("Portfolio HTML did not contain enough usable content");
  }

  return {
    ...portfolio,
    source: "live-portfolio",
    sourceUrl: PORTFOLIO_URL,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeFallbackPortfolio(portfolio) {
  return {
    name: normalizeText(portfolio.name),
    role: normalizeText(portfolio.role),
    about: normalizeText(portfolio.about),
    skills: portfolio.skills || {},
    projects: (portfolio.projects || []).map((project) => ({
      title: project.name || project.title,
      description: project.description,
      techStack: project.tech_stack || project.techStack || [],
      links: {
        github: project.github,
        live: project.live,
      },
    })),
    links: portfolio.links || {},
    source: "portfolio.json",
    sourceUrl: "",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchLivePortfolio() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(PORTFOLIO_URL, {
      signal: controller.signal,
      headers: {
        accept: "text/html",
        "user-agent": "SudarshanPortfolioRAG/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Portfolio fetch failed with ${response.status}`);
    }

    return parsePortfolioHtml(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function loadFallbackPortfolio(fallbackPath) {
  const rawPortfolio = await fs.readFile(fallbackPath, "utf8");
  return normalizeFallbackPortfolio(JSON.parse(rawPortfolio));
}

async function refreshPortfolio(fallbackPath) {
  try {
    return await fetchLivePortfolio();
  } catch (error) {
    console.warn("Live portfolio fetch failed; using portfolio.json fallback:", error.message);
    return loadFallbackPortfolio(fallbackPath);
  }
}

export async function getPortfolioData(fallbackPath, options = {}) {
  const ttlMs = Number(options.ttlMs || process.env.PORTFOLIO_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);
  const now = Date.now();

  if (cachedPortfolio && now - cachedAt < ttlMs) {
    return cachedPortfolio;
  }

  if (!pendingFetch) {
    pendingFetch = refreshPortfolio(fallbackPath)
      .then((portfolio) => {
        cachedPortfolio = portfolio;
        cachedAt = Date.now();
        return cachedPortfolio;
      })
      .finally(() => {
        pendingFetch = null;
      });
  }

  if (cachedPortfolio) {
    pendingFetch.catch(() => {});
    return cachedPortfolio;
  }

  return pendingFetch;
}

export { PORTFOLIO_URL };
