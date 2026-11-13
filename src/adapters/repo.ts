import { AdapterFailure } from "./index";
import { fetchApi, isApiRateLimited } from "./rate-limit";
import { extractEmbeddedPayload, fetchRepoPage, parseRepoPage } from "./_page";

export type RepoSummary = {
  owner: string;
  repo: string;
  nwo: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  parentNwo: string | null;
  description: string;
  homepage: string | null;
  defaultBranch: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  topics: string[];
  primaryLanguage: string | null;
  license: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  hasProjects: boolean;
  hasDiscussions: boolean;
};

const summaryCache = new Map<string, { value: RepoSummary; expires: number }>();
const TTL_MS = 60_000;

export async function getRepoSummary(owner: string, repo: string): Promise<RepoSummary> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const now = Date.now();
  const cached = summaryCache.get(key);
  if (cached && cached.expires > now) return cached.value;

  if (isApiRateLimited()) {
    const scraped = await scrapeRepoSummary(owner, repo).catch(() => null);
    if (scraped) {
      summaryCache.set(key, { value: scraped, expires: now + TTL_MS });
      return scraped;
    }
    throw new AdapterFailure("getRepoSummary", "API rate-limited; skipping");
  }

  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    // Private repos return 404 to anonymous API calls, but the page itself
    // renders fine when the user has a cookie. Fall back to scraping the
    // page so we can still show description, topics, and feature flags.
    const scraped = await scrapeRepoSummary(owner, repo).catch(() => null);
    if (scraped) {
      summaryCache.set(key, { value: scraped, expires: now + TTL_MS });
      return scraped;
    }
    throw new AdapterFailure("getRepoSummary", `responded ${resp.status}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;

  const fullName = typeof data["full_name"] === "string" ? (data["full_name"] as string) : `${owner}/${repo}`;
  const parent = data["parent"] && typeof data["parent"] === "object" ? (data["parent"] as Record<string, unknown>) : null;
  const license = data["license"] && typeof data["license"] === "object" ? (data["license"] as Record<string, unknown>) : null;

  const summary: RepoSummary = {
    owner,
    repo,
    nwo: fullName,
    isPrivate: data["private"] === true,
    isFork: data["fork"] === true,
    isArchived: data["archived"] === true,
    parentNwo: parent ? (typeof parent["full_name"] === "string" ? (parent["full_name"] as string) : null) : null,
    description: typeof data["description"] === "string" ? (data["description"] as string) : "",
    homepage: typeof data["homepage"] === "string" && (data["homepage"] as string).trim() ? (data["homepage"] as string) : null,
    defaultBranch: typeof data["default_branch"] === "string" ? (data["default_branch"] as string) : "main",
    stars: typeof data["stargazers_count"] === "number" ? (data["stargazers_count"] as number) : null,
    forks: typeof data["forks_count"] === "number" ? (data["forks_count"] as number) : null,
    watchers: typeof data["subscribers_count"] === "number" ? (data["subscribers_count"] as number) : (typeof data["watchers_count"] === "number" ? (data["watchers_count"] as number) : null),
    topics: Array.isArray(data["topics"]) ? (data["topics"] as unknown[]).filter((t): t is string => typeof t === "string") : [],
    primaryLanguage: typeof data["language"] === "string" ? (data["language"] as string) : null,
    license: license ? (typeof license["spdx_id"] === "string" ? (license["spdx_id"] as string) : (typeof license["name"] === "string" ? (license["name"] as string) : null)) : null,
    hasIssues: data["has_issues"] !== false,
    hasWiki: data["has_wiki"] !== false,
    hasProjects: data["has_projects"] !== false,
    hasDiscussions: data["has_discussions"] === true,
  };

  summaryCache.set(key, { value: summary, expires: now + TTL_MS });
  return summary;
}

// the repo home's sidebar data; other repo pages and an empty repo have none
function readAbout(doc: Document): Record<string, unknown> {
  try {
    const about = (extractEmbeddedPayload(doc) as { payload?: { codeViewRepoRoute?: { overview?: { sidebarAboutData?: unknown } } } })
      .payload?.codeViewRepoRoute?.overview?.sidebarAboutData;
    return about && typeof about === "object" ? (about as Record<string, unknown>) : {};
  } catch (err) {
    if (err instanceof AdapterFailure) return {};
    throw err;
  }
}

async function scrapeRepoSummary(owner: string, repo: string): Promise<RepoSummary> {
  const html = await fetchRepoPage(owner, repo);
  const doc = parseRepoPage(html);

  const titleMeta = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || "";
  const descMeta = doc.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content?.trim() || "";

  // Walk every anchor with an href in the same repo namespace; modern GitHub
  // doesn't put the tabs under a single stable container class anymore.
  const prefix = `/${owner}/${repo}`;
  let hasIssues = false;
  let hasWiki = false;
  let hasProjects = false;
  let hasDiscussions = false;
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    if (!href.startsWith(prefix)) continue;
    const rest = href.slice(prefix.length);
    if (/^\/issues(\?|$|\/)/.test(rest)) hasIssues = true;
    else if (/^\/wiki(\?|$|\/)/.test(rest)) hasWiki = true;
    else if (/^\/projects(\?|$|\/)/.test(rest)) hasProjects = true;
    else if (/^\/discussions(\?|$|\/)/.test(rest)) hasDiscussions = true;
  }

  // Topics are rendered as <a class="topic-tag"> or under a topics list.
  const topicEls = doc.querySelectorAll<HTMLElement>('a[data-octo-click="topic_click"], a.topic-tag, a[href^="/topics/"]');
  const topics: string[] = [];
  const seenTopic = new Set<string>();
  for (const t of Array.from(topicEls)) {
    const name = (t.textContent || "").trim();
    if (name && !seenTopic.has(name) && /^[a-z0-9-]+$/.test(name)) {
      seenTopic.add(name);
      topics.push(name);
    }
  }

  // Strip the trailing " - owner/repo" or "Contribute to …" that GitHub appends.
  const description = descMeta
    .replace(/\s*Contribute to [^.]+\s+development by creating an account on GitHub\.?\s*$/i, "")
    .replace(/\s*[-–—]\s*[\w.-]+\/[\w.-]+\s*$/i, "")
    .replace(/^[\w.-]+\/[\w.-]+\s*:\s*/i, "")
    .trim();

  const about = readAbout(doc);
  const flags = (about["repo"] ?? {}) as Record<string, unknown>;
  const count = (k: string): number | null => (typeof about[k] === "number" ? (about[k] as number) : null);
  const aboutTopics = Array.isArray(about["topics"])
    ? (about["topics"] as unknown[]).map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>)["name"] : null)).filter((n): n is string => typeof n === "string")
    : [];
  // every page carries a hidden lock octicon in the command palette, so an icon can't tell visibility
  const isPrivate = typeof flags["isPrivate"] === "boolean"
    ? flags["isPrivate"]
    : doc.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_public"]')?.content === "false";
  const isFork = flags["isFork"] === true || !!doc.querySelector('.octicon-repo-forked + span, [data-pjax-replace] [aria-label*="forked"]')
    || /^Forks /.test(titleMeta);
  // Archived repos render a "This repository has been archived" banner with a
  // specific aria-label, or a small .Label--inactive next to the title.
  const isArchived = flags["isArchived"] === true ||
    /This repository has been archived/i.test(doc.body.textContent || "") ||
    !!doc.querySelector('[aria-label*="archived" i]');
  const branch = doc.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_default_branch"]')?.content
    || doc.querySelector<HTMLElement>('[data-test-selector="branch-name"]')?.textContent?.trim()
    || "main";

  return {
    owner,
    repo,
    nwo: `${owner}/${repo}`,
    isPrivate,
    isFork,
    isArchived,
    parentNwo: null,
    description: typeof about["description"] === "string" ? about["description"] : description,
    homepage: typeof about["website"] === "string" && about["website"].trim() ? about["website"] : null,
    defaultBranch: branch,
    stars: count("stargazerCount"),
    forks: count("forksCount"),
    watchers: count("watcherCount"),
    topics: aboutTopics.length ? aboutTopics : topics,
    primaryLanguage: null,
    license: null,
    hasIssues,
    hasWiki,
    hasProjects,
    hasDiscussions,
  };
}

export type RepoLanguage = { name: string; bytes: number; percent: number };
export type RepoSidebar = { languages: RepoLanguage[]; contributorCount: number | null };

// json endpoints github's own repo home reads: cookie-authed, so they cover private repos and spend no api quota
export async function getRepoPageJson(owner: string, repo: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`https://github.com/${owner}/${repo}/${path}`, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch (err) {
    if (err instanceof TypeError || err instanceof SyntaxError) return null;
    throw err;
  }
}

export async function getRepoSidebar(owner: string, repo: string): Promise<RepoSidebar | null> {
  const j = await getRepoPageJson(owner, repo, "_sidebar");
  if (!j) return null;
  const langs = (j["languages"] as { languages?: unknown } | null)?.languages;
  const count = (j["contributors"] as { contributorCount?: unknown } | null)?.contributorCount;
  const languages = (Array.isArray(langs) ? langs : []).flatMap((l: { name?: unknown; percentage?: unknown }) =>
    typeof l?.name === "string" && typeof l.percentage === "number" ? [{ name: l.name, bytes: Math.round(l.percentage * 100), percent: l.percentage }] : []);
  return { languages, contributorCount: typeof count === "number" ? count : null };
}

export async function getRepoLanguages(owner: string, repo: string): Promise<RepoLanguage[]> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/languages`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) return [];
  const entries = Object.entries((await resp.json()) as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number");
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (total === 0) return [];
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([name, bytes]) => ({ name, bytes, percent: (bytes / total) * 100 }));
}

export { formatCount } from "@/util/format";
