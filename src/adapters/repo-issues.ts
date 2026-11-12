import { AdapterFailure } from "./index";
import { fetchApi, isApiRateLimited } from "./rate-limit";
import { escapeText } from "@/util/html";

export type IssueState = "OPEN" | "CLOSED";

export type IssueLabel = {
  name: string;
  color: string;
};

export type IssueActor = {
  login: string;
  avatarUrl: string;
};

export type IssueRow = {
  number: number;
  titleHtml: string;
  state: IssueState;
  stateReason: string | null;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
  comments: number;
  author: IssueActor | null;
  labels: IssueLabel[];
  assignees: IssueActor[];
  milestone: { title: string; url: string } | null;
  isPullRequest: boolean;
  isDraft: boolean;
  merged: boolean;
};

export type IssueListView = {
  owner: string;
  repo: string;
  query: string;
  rawQuery: string;
  totalCount: number;
  openCount: number | null;
  closedCount: number | null;
  rows: IssueRow[];
  pageInfo: {
    hasNext: boolean;
    hasPrevious: boolean;
    page: number;
  };
};

const API = "https://api.github.com";

export async function getIssueList(
  owner: string,
  repo: string,
  rawQuery: string,
  kind: "issues" | "pulls",
): Promise<IssueListView> {
  const params = new URLSearchParams(rawQuery);
  const qStr = params.get("q") || "";
  const wantsClosed = /\bis:closed\b/i.test(qStr) || params.get("state") === "closed";
  const wantsAll = /\bis:all\b/i.test(qStr) || params.get("state") === "all";
  const state: "open" | "closed" | "all" = wantsAll ? "all" : (wantsClosed ? "closed" : "open");
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const labels = extractLabels(qStr) ?? params.get("labels") ?? undefined;
  const author = extractKey(qStr, "author") ?? undefined;
  const assignee = extractKey(qStr, "assignee") ?? params.get("assignee") ?? undefined;
  const milestone = extractKey(qStr, "milestone") ?? params.get("milestone") ?? undefined;
  const sortClause = extractSort(qStr);
  const sort = sortClause.sort ?? "updated";
  const direction = sortClause.direction ?? "desc";

  // REST /repos/.../issues returns issues AND pull-requests; for "issues" mode we
  // filter PRs out client-side, but on PR-heavy repos this leaves an almost-empty
  // page. Default to the search API for issues so the filter happens server-side.
  const needsSearch =
    kind === "issues" ||
    (kind === "pulls" && !!author) ||
    /\b(involves|mentions|review|review-requested|reviewed-by|commenter|head|base):/i.test(qStr);

  if (isApiRateLimited()) {
    return scrapeIssueList(owner, repo, rawQuery, kind, qStr, state, page);
  }

  let rows: IssueRow[];
  let hasNext: boolean;
  let hasPrev: boolean;
  let listTotal: number | null = null;

  // counts follow the active filters like github's own tabs; a search list already carries its own state's total
  const countOf = (s: "open" | "closed") => searchTotal(buildSearchQuery(owner, repo, kind, s, qStr));
  const pendingOpen = needsSearch && state === "open" ? null : countOf("open");
  const pendingClosed = needsSearch && state !== "closed" ? null : countOf("closed");

  if (needsSearch) {
    const searchQ = buildSearchQuery(owner, repo, kind, state, qStr);
    const searchUrl = `${API}/search/issues?q=${encodeURIComponent(searchQ)}&per_page=30&page=${page}&sort=${sort}&order=${direction}`;
    const resp = await fetchApi(searchUrl, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      // 401/403/404 — auth required (often private repo)
      // 422 — search API rejects the query (private repo without token, etc.)
      // 429 — rate-limited
      return scrapeIssueList(owner, repo, rawQuery, kind, qStr, state, page);
    }
    const data = (await resp.json()) as { items?: unknown[]; total_count?: unknown };
    if (typeof data.total_count === "number") listTotal = data.total_count;
    rows = [];
    for (const raw of data.items ?? []) {
      const parsed = parseRow(raw, kind);
      if (parsed) rows.push(parsed);
    }
    const linkHeader = resp.headers.get("link") || "";
    hasNext = /<[^>]+>;\s*rel="next"/i.test(linkHeader);
    hasPrev = /<[^>]+>;\s*rel="prev"/i.test(linkHeader);
  } else {
    // needsSearch implies kind === "issues" OR has special filters, so reaching
    // this branch means kind === "pulls" without an author filter
    const apiUrl = new URL(`${API}/repos/${owner}/${repo}/pulls`);
    apiUrl.searchParams.set("state", state);
    apiUrl.searchParams.set("per_page", "30");
    apiUrl.searchParams.set("page", String(page));
    apiUrl.searchParams.set("sort", sort);
    apiUrl.searchParams.set("direction", direction);
    if (labels) apiUrl.searchParams.set("labels", labels);
    if (assignee) apiUrl.searchParams.set("assignee", assignee);
    if (milestone) apiUrl.searchParams.set("milestone", milestone);

    const resp = await fetchApi(apiUrl.toString(), {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) {
      // any non-ok — fall back to the cookie-authed HTML scrape
      return scrapeIssueList(owner, repo, rawQuery, kind, qStr, state, page);
    }
    const data = (await resp.json()) as unknown[];
    rows = [];
    for (const raw of data) {
      const parsed = parseRow(raw, kind);
      if (parsed) rows.push(parsed);
    }
    const linkHeader = resp.headers.get("link") || "";
    hasNext = /<[^>]+>;\s*rel="next"/i.test(linkHeader);
    hasPrev = /<[^>]+>;\s*rel="prev"/i.test(linkHeader);
  }

  const open = pendingOpen ? await pendingOpen : listTotal;
  const closed = pendingClosed ? await pendingClosed : state === "all" ? (open === null || listTotal === null ? null : listTotal - open) : listTotal;
  const counts = { open, closed };

  const totalCount = state === "closed"
    ? (counts.closed ?? rows.length)
    : state === "open"
      ? (counts.open ?? rows.length)
      : ((counts.open ?? 0) + (counts.closed ?? 0)) || rows.length;

  return {
    owner,
    repo,
    rawQuery,
    query: qStr,
    totalCount,
    openCount: counts.open,
    closedCount: counts.closed,
    rows,
    pageInfo: { hasNext, hasPrevious: hasPrev, page },
  };
}

async function scrapeIssueList(
  owner: string,
  repo: string,
  rawQuery: string,
  kind: "issues" | "pulls",
  qStr: string,
  state: "open" | "closed" | "all",
  page: number,
): Promise<IssueListView> {
  const path = kind === "pulls" ? "pulls" : "issues";
  const url = `https://github.com/${owner}/${repo}/${path}${rawQuery ? "?" + rawQuery : ""}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) {
    throw new AdapterFailure("getIssueList", `scrape ${url} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows: IssueRow[] = [];
  for (const li of Array.from(doc.querySelectorAll<HTMLElement>("li.js-issue-row, div.js-issue-row, [data-listview-component='items-list'] li"))) {
    const parsed = parseScrapedRow(li, kind);
    if (parsed) rows.push(parsed);
  }
  const openTab = doc.querySelector<HTMLElement>("a[href*='is%3Aopen'], a[href*='is:open']");
  const closedTab = doc.querySelector<HTMLElement>("a[href*='is%3Aclosed'], a[href*='is:closed']");
  const openCount = openTab ? parseNumber(openTab.textContent || "") : null;
  const closedCount = closedTab ? parseNumber(closedTab.textContent || "") : null;
  if (rows.length === 0 && !openTab && !closedTab) {
    throw new AdapterFailure("getIssueList", `${url} markup not recognized`);
  }
  const total = state === "closed"
    ? (closedCount ?? rows.length)
    : state === "open"
      ? (openCount ?? rows.length)
      : ((openCount ?? 0) + (closedCount ?? 0)) || rows.length;
  return {
    owner,
    repo,
    rawQuery,
    query: qStr,
    totalCount: total,
    openCount,
    closedCount,
    rows,
    pageInfo: { hasNext: rows.length === 25, hasPrevious: page > 1, page },
  };
}

function parseScrapedRow(el: HTMLElement, kind: "issues" | "pulls"): IssueRow | null {
  const idMatch = /issue_(\d+)/.exec(el.id || "");
  const titleA = el.querySelector<HTMLAnchorElement>("a.Link--primary, a[href*='/issues/'], a[href*='/pull/']");
  if (!titleA) return null;
  const href = titleA.getAttribute("href") || "";
  const nm = /\/(?:issues|pull)\/(\d+)/.exec(href);
  const number = idMatch ? parseInt(idMatch[1]!, 10) : (nm ? parseInt(nm[1]!, 10) : 0);
  if (!number) return null;
  const stateLabel = el.querySelector<HTMLElement>("[aria-label*='Open' i], [aria-label*='Closed' i], [aria-label*='Merged' i], [aria-label*='Draft' i]")?.getAttribute("aria-label") || "";
  const isMerged = /merged/i.test(stateLabel);
  const isClosed = /closed/i.test(stateLabel);
  const state: IssueState = isClosed || isMerged ? "CLOSED" : "OPEN";
  const userLink = el.querySelector<HTMLAnchorElement>("a.opened-by, a[data-hovercard-type='user']");
  const login = userLink?.textContent?.trim() || null;
  const labels: IssueLabel[] = [];
  for (const lbl of Array.from(el.querySelectorAll<HTMLElement>("a.IssueLabel, a[data-name]"))) {
    const name = lbl.getAttribute("data-name") || lbl.textContent?.trim() || "";
    if (!name) continue;
    const style = lbl.getAttribute("style") || "";
    const rgb = /--label-r:\s*(\d+)[^;]*;\s*--label-g:\s*(\d+)[^;]*;\s*--label-b:\s*(\d+)/.exec(style);
    let color = "cccccc";
    if (rgb) color = [rgb[1], rgb[2], rgb[3]].map((n) => parseInt(n!, 10).toString(16).padStart(2, "0")).join("");
    labels.push({ name, color });
  }
  const time = el.querySelector("relative-time")?.getAttribute("datetime") || "";
  const commentLink = el.querySelector<HTMLAnchorElement>("a[href*='#issuecomment'], .ItemActionBar__count");
  const comments = commentLink ? parseInt((commentLink.textContent || "").trim().replace(/\D/g, ""), 10) || 0 : 0;
  return {
    number,
    titleHtml: titleA.innerHTML.trim(),
    state,
    stateReason: isMerged ? "MERGED" : isClosed ? "COMPLETED" : null,
    createdAt: time,
    closedAt: null,
    updatedAt: time,
    comments,
    author: login ? { login, avatarUrl: `https://github.com/${login}.png?size=40` } : null,
    labels,
    assignees: [],
    milestone: null,
    isPullRequest: kind === "pulls" || /\/pull\//.test(href),
    isDraft: /draft/i.test(stateLabel),
    merged: isMerged,
  };
}

function parseNumber(s: string): number | null {
  const m = /([\d,]+)/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1]!.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

async function searchTotal(q: string): Promise<number | null> {
  try {
    const resp = await fetchApi(`${API}/search/issues?q=${encodeURIComponent(q)}&per_page=1`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as { total_count?: unknown };
    return typeof j.total_count === "number" ? j.total_count : null;
  } catch {
    return null;
  }
}

function parseRow(raw: unknown, kind: "issues" | "pulls"): IssueRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const number = typeof r["number"] === "number" ? (r["number"] as number) : 0;
  if (!number) return null;
  const title = typeof r["title"] === "string" ? (r["title"] as string) : "";
  const stateRaw = typeof r["state"] === "string" ? (r["state"] as string) : "open";
  const state: IssueState = stateRaw === "closed" ? "CLOSED" : "OPEN";
  const stateReason = typeof r["state_reason"] === "string" ? (r["state_reason"] as string) : null;

  const isPullRequest = kind === "pulls" || !!r["pull_request"];
  let merged = false;
  let isDraft = r["draft"] === true;
  if (typeof r["merged_at"] === "string" && r["merged_at"]) {
    merged = true;
  } else if (r["pull_request"] && typeof r["pull_request"] === "object") {
    const pr = r["pull_request"] as Record<string, unknown>;
    if (typeof pr["merged_at"] === "string" && pr["merged_at"]) merged = true;
  }

  const userRaw = r["user"];
  let author: IssueActor | null = null;
  if (userRaw && typeof userRaw === "object") {
    const u = userRaw as Record<string, unknown>;
    const login = typeof u["login"] === "string" ? (u["login"] as string) : null;
    if (login) {
      author = {
        login,
        avatarUrl: typeof u["avatar_url"] === "string" ? (u["avatar_url"] as string) : `https://github.com/${login}.png?size=40`,
      };
    }
  }

  const labelsRaw = r["labels"];
  const labels: IssueLabel[] = [];
  if (Array.isArray(labelsRaw)) {
    for (const l of labelsRaw) {
      if (!l || typeof l !== "object") continue;
      const lr = l as Record<string, unknown>;
      const name = typeof lr["name"] === "string" ? (lr["name"] as string) : null;
      const color = typeof lr["color"] === "string" ? (lr["color"] as string) : "cccccc";
      if (name) labels.push({ name, color });
    }
  }

  const assigneesRaw = r["assignees"];
  const assignees: IssueActor[] = [];
  if (Array.isArray(assigneesRaw)) {
    for (const a of assigneesRaw) {
      if (!a || typeof a !== "object") continue;
      const ar = a as Record<string, unknown>;
      const login = typeof ar["login"] === "string" ? (ar["login"] as string) : null;
      if (login) {
        assignees.push({
          login,
          avatarUrl: typeof ar["avatar_url"] === "string" ? (ar["avatar_url"] as string) : `https://github.com/${login}.png?size=40`,
        });
      }
    }
  }

  let milestone: { title: string; url: string } | null = null;
  const ms = r["milestone"];
  if (ms && typeof ms === "object") {
    const m = ms as Record<string, unknown>;
    const t = typeof m["title"] === "string" ? (m["title"] as string) : null;
    if (t) {
      const htmlUrl = typeof m["html_url"] === "string" ? (m["html_url"] as string) : "";
      milestone = { title: t, url: htmlUrl.replace(/^https:\/\/github\.com/, "") };
    }
  }

  return {
    number,
    titleHtml: escapeText(title),
    state,
    stateReason,
    createdAt: typeof r["created_at"] === "string" ? (r["created_at"] as string) : "",
    closedAt: typeof r["closed_at"] === "string" ? (r["closed_at"] as string) : null,
    updatedAt: typeof r["updated_at"] === "string" ? (r["updated_at"] as string) : "",
    comments: typeof r["comments"] === "number" ? (r["comments"] as number) : 0,
    author,
    labels,
    assignees,
    milestone,
    isPullRequest,
    isDraft,
    merged,
  };
}

function buildSearchQuery(owner: string, repo: string, kind: "issues" | "pulls", state: "open" | "closed" | "all", qStr: string): string {
  const parts: string[] = [`repo:${owner}/${repo}`, kind === "pulls" ? "type:pr" : "type:issue"];
  if (state !== "all") parts.push(`is:${state}`);
  const cleaned = qStr
    .replace(/\bis:(open|closed|all)\b/gi, "")
    .replace(/\btype:(issue|pr)\b/gi, "")
    .replace(/\brepo:[^\s]+/gi, "")
    .replace(/\bsort:[\w-]+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) parts.push(cleaned);
  return parts.join(" ");
}

function extractLabels(q: string): string | null {
  const matches = Array.from(q.matchAll(/\blabel:("([^"]+)"|([^\s"]+))/gi));
  if (matches.length === 0) return null;
  return matches.map((m) => m[2] || m[3] || "").filter(Boolean).join(",");
}

function extractKey(q: string, key: string): string | null {
  const m = new RegExp(`\\b${key}:("([^"]+)"|([^\\s"]+))`, "i").exec(q);
  if (!m) return null;
  return m[2] || m[3] || null;
}

function extractSort(q: string): { sort: "created" | "updated" | "comments" | null; direction: "asc" | "desc" | null } {
  const m = /\bsort:([\w-]+)\b/i.exec(q);
  if (!m || !m[1]) return { sort: null, direction: null };
  const v = m[1].toLowerCase();
  if (v.startsWith("created")) return { sort: "created", direction: v.endsWith("asc") ? "asc" : "desc" };
  if (v.startsWith("updated")) return { sort: "updated", direction: v.endsWith("asc") ? "asc" : "desc" };
  if (v.startsWith("comments")) return { sort: "comments", direction: v.endsWith("asc") ? "asc" : "desc" };
  return { sort: null, direction: null };
}
