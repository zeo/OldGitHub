import { AdapterFailure } from "./index";
import { loadPagePayload } from "./_page";
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

export async function getIssueList(
  owner: string,
  repo: string,
  rawQuery: string,
  kind: "issues" | "pulls",
): Promise<IssueListView> {
  const params = new URLSearchParams(rawQuery);
  const qStr = withParamFilters(params.get("q") || "", params);
  const wantsClosed = /\b(?:is|state):closed\b/i.test(qStr) || params.get("state") === "closed";
  const wantsAll = /\bis:all\b/i.test(qStr) || params.get("state") === "all";
  const state: "open" | "closed" | "all" = wantsAll ? "all" : (wantsClosed ? "closed" : "open");
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const load = (s: "open" | "closed" | "all", p: number) => loadPagePayload(listUrl(owner, repo, kind, pageQuery(kind, s, qStr), p));

  let rows: IssueRow[];
  let open: number | null;
  let closed: number | null;
  let currentPage: number;
  let totalPages: number;
  // the payloads leave out zero values, so a missing count on a found route means 0
  if (kind === "pulls") {
    const route = readObj(readObj(readObj(await load(state, page))?.["payload"])?.["repoPullsDashboardContentRoute"]);
    if (!route) throw new AdapterFailure("getIssueList", "pull request list not found on the page");
    rows = readArray(route["results"]).map(parsePullItem).filter((r): r is IssueRow => r !== null);
    open = readNumber(route, "openCount") ?? 0;
    closed = readNumber(route, "closedCount") ?? 0;
    currentPage = readNumber(route, "currentPage") ?? page;
    totalPages = readNumber(route, "totalPages") ?? page;
  } else {
    // the issues page only counts its own state, so the other tab's count takes a second page
    const other: "open" | "closed" = state === "open" ? "closed" : "open";
    const [list, otherCount] = await Promise.all([
      issuesRoute(await load(state, page)),
      load(other, 1).then((p) => readNumber(readObj(issuesRoute(p)["pageInfo"]) ?? {}, "totalCount") ?? 0, () => null),
    ]);
    const info = readObj(list["pageInfo"]) ?? {};
    const total = readNumber(info, "totalCount") ?? 0;
    rows = readArray(list["results"]).map((r) => parseIssueItem(readObj(r)?.["issue"])).filter((r): r is IssueRow => r !== null);
    open = state === "open" ? total : otherCount;
    closed = state === "closed" ? total : state === "open" ? otherCount : otherCount === null ? null : total - otherCount;
    currentPage = readNumber(info, "currentPage") ?? page;
    totalPages = readNumber(info, "totalPages") ?? page;
  }

  const totalCount = state === "closed"
    ? (closed ?? rows.length)
    : state === "open"
      ? (open ?? rows.length)
      : ((open ?? 0) + (closed ?? 0)) || rows.length;

  return {
    owner,
    repo,
    rawQuery,
    query: qStr,
    totalCount,
    openCount: open,
    closedCount: closed,
    rows,
    pageInfo: { hasNext: currentPage < totalPages, hasPrevious: currentPage > 1, page: currentPage },
  };
}

function listUrl(owner: string, repo: string, kind: "issues" | "pulls", q: string, page: number): string {
  const u = new URL(`https://github.com/${owner}/${repo}/${kind}`);
  u.searchParams.set("q", q);
  if (page > 1) u.searchParams.set("page", String(page));
  return u.href;
}

function issuesRoute(payload: unknown): Record<string, unknown> {
  const route = readObj(readObj(readObj(payload)?.["payload"])?.["issuesIndexContentRoute"]);
  if (!route) throw new AdapterFailure("getIssueList", "issue list not found on the page");
  return route;
}

// github's list pages take the same qualifiers as search, minus the repo they already scope to
function pageQuery(kind: "issues" | "pulls", state: "open" | "closed" | "all", qStr: string): string {
  const cleaned = qStr
    .replace(/\b(?:is|state):(?:open|closed|all)\b/gi, "")
    .replace(/\b(?:is|type):(?:issue|pr)\b/gi, "")
    .replace(/\brepo:\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return [kind === "pulls" ? "is:pr" : "is:issue", state === "all" ? "" : `is:${state}`, cleaned].filter(Boolean).join(" ");
}

function parseIssueItem(raw: unknown): IssueRow | null {
  const r = readObj(raw);
  const number = r ? readNumber(r, "number") : null;
  if (!r || !number) return null;
  const author = readObj(r["author"]);
  const login = author ? readString(author, "login") : null;
  return {
    number,
    titleHtml: readString(readObj(r["titleHtml"]) ?? {}, "value") ?? escapeText(readString(r, "title") ?? ""),
    state: /CLOSED$/.test(readString(r, "state") ?? "") ? "CLOSED" : "OPEN",
    stateReason: readString(r, "stateReason")?.replace(/^REPO_ISSUE_STATE_REASON_/, "") ?? null,
    createdAt: readString(r, "createdAt") ?? "",
    closedAt: readString(r, "closedAt"),
    updatedAt: readString(r, "updatedAt") ?? "",
    comments: readNumber(r, "commentCount") ?? 0,
    author: login ? { login, avatarUrl: (author && readString(author, "avatarUrl")) ?? `https://github.com/${login}.png?size=40` } : null,
    labels: parseLabels(r["labels"]),
    assignees: [],
    milestone: null,
    isPullRequest: false,
    isDraft: false,
    merged: false,
  };
}

function parsePullItem(raw: unknown): IssueRow | null {
  const r = readObj(raw);
  const number = r ? readNumber(r, "number") : null;
  if (!r || !number) return null;
  const login = readString(readObj(r["author"]) ?? {}, "displayLogin");
  const state = readString(r, "state") ?? "";
  const merged = /MERGED$/.test(state);
  return {
    number,
    titleHtml: readString(readObj(r["titleHtml"]) ?? {}, "value") ?? escapeText(readString(r, "title") ?? ""),
    state: merged || /CLOSED$/.test(state) ? "CLOSED" : "OPEN",
    stateReason: merged ? "MERGED" : null,
    createdAt: readString(r, "createdAt") ?? "",
    closedAt: readString(r, "closedAt"),
    updatedAt: readString(r, "updatedAt") ?? "",
    comments: readNumber(r, "commentCount") ?? 0,
    author: login ? { login, avatarUrl: `https://github.com/${login}.png?size=40` } : null,
    labels: parseLabels(r["labels"]),
    assignees: [],
    milestone: null,
    isPullRequest: true,
    isDraft: /DRAFT$/.test(readString(r, "displayState") ?? ""),
    merged,
  };
}

function parseLabels(raw: unknown): IssueLabel[] {
  return readArray(raw).flatMap((l) => {
    const o = readObj(l);
    const name = o ? readString(o, "name") : null;
    return o && name ? [{ name, color: readString(o, "color") ?? "cccccc" }] : [];
  });
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}
function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}

// older links carry ?labels=, ?assignee= and ?milestone=; search only reads q
function withParamFilters(q: string, params: URLSearchParams): string {
  const extra = extractLabels(q) ? [] : (params.get("labels") ?? "").split(",").filter(Boolean).map((l) => `label:"${l}"`);
  for (const key of ["assignee", "milestone"]) {
    const value = params.get(key);
    if (value && !extractKey(q, key)) extra.push(`${key}:"${value}"`);
  }
  return [q, ...extra].filter(Boolean).join(" ");
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
