import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";

const API = "https://api.github.com";

export type PulseActor = {
  login: string;
  avatarUrl: string;
};

export type PulseIssueRef = {
  number: number;
  title: string;
  htmlUrl: string;
  state: "open" | "closed";
  isPull: boolean;
  user: PulseActor | null;
  createdAt: string;
  closedAt: string | null;
  merged: boolean;
};

export type PulseCommitRef = {
  sha: string;
  abbrevSha: string;
  headline: string;
  htmlUrl: string;
  authorLogin: string | null;
  authorAvatar: string;
  date: string;
};

export type PulseView = {
  owner: string;
  repo: string;
  sinceIso: string;
  openedPrs: PulseIssueRef[];
  closedPrs: PulseIssueRef[]; // includes merged
  mergedPrs: PulseIssueRef[];
  openedIssues: PulseIssueRef[];
  closedIssues: PulseIssueRef[];
  commits: PulseCommitRef[];
  commitAuthors: Set<string>;
};

export async function getRepoPulse(owner: string, repo: string): Promise<PulseView> {
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();

  const [openPulls, closedPulls, openIssues, closedIssues, commits] = await Promise.all([
    apiFetch(`/repos/${owner}/${repo}/pulls?state=open&sort=created&direction=desc&per_page=100`),
    apiFetch(`/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`),
    apiFetch(`/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=100&filter=all`),
    apiFetch(`/repos/${owner}/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=100&filter=all`),
    apiFetch(`/repos/${owner}/${repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`),
  ]);

  const openedPrs = (openPulls ?? []).map(parsePullRef).filter((p): p is PulseIssueRef => p !== null && p.createdAt >= sinceIso);
  const closedPrsList = (closedPulls ?? []).map(parsePullRef).filter((p): p is PulseIssueRef => p !== null && p.closedAt !== null && p.closedAt >= sinceIso);
  const mergedPrs = closedPrsList.filter((p) => p.merged);

  const openIssuesArr = (openIssues ?? []).map(parseIssueRef).filter((i): i is PulseIssueRef => i !== null && !i.isPull && i.createdAt >= sinceIso);
  const closedIssuesArr = (closedIssues ?? []).map(parseIssueRef).filter((i): i is PulseIssueRef => i !== null && !i.isPull && i.closedAt !== null && i.closedAt >= sinceIso);

  const commitsList: PulseCommitRef[] = [];
  const commitAuthors = new Set<string>();
  for (const c of commits ?? []) {
    if (!c || typeof c !== "object") continue;
    const parsed = parseCommitRef(c);
    if (parsed) {
      commitsList.push(parsed);
      if (parsed.authorLogin) commitAuthors.add(parsed.authorLogin);
    }
  }

  return {
    owner,
    repo,
    sinceIso,
    openedPrs,
    closedPrs: closedPrsList,
    mergedPrs,
    openedIssues: openIssuesArr,
    closedIssues: closedIssuesArr,
    commits: commitsList,
    commitAuthors,
  };
}

async function apiFetch(path: string): Promise<unknown[] | null> {
  const resp = await fetchApi(`${API}${path}`, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
  if (!resp.ok) {
    // 409 is an empty repository, 410 a repository with issues turned off
    if (resp.status === 409 || resp.status === 410) return [];
    throw new AdapterFailure("getRepoPulse", `${path} responded ${resp.status}`);
  }
  const data = (await resp.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

function parsePullRef(raw: unknown): PulseIssueRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = typeof r["number"] === "number" ? (r["number"] as number) : null;
  const title = typeof r["title"] === "string" ? (r["title"] as string) : null;
  if (num == null || !title) return null;
  const user = readObj(r["user"]);
  return {
    number: num,
    title,
    htmlUrl: (typeof r["html_url"] === "string" ? (r["html_url"] as string) : "") || `https://github.com/`,
    state: r["state"] === "closed" ? "closed" : "open",
    isPull: true,
    user: user ? { login: String(user["login"] ?? ""), avatarUrl: String(user["avatar_url"] ?? "") } : null,
    createdAt: typeof r["created_at"] === "string" ? (r["created_at"] as string) : "",
    closedAt: typeof r["closed_at"] === "string" ? (r["closed_at"] as string) : null,
    merged: typeof r["merged_at"] === "string" && r["merged_at"] !== null,
  };
}

function parseIssueRef(raw: unknown): PulseIssueRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = typeof r["number"] === "number" ? (r["number"] as number) : null;
  const title = typeof r["title"] === "string" ? (r["title"] as string) : null;
  if (num == null || !title) return null;
  const user = readObj(r["user"]);
  return {
    number: num,
    title,
    htmlUrl: typeof r["html_url"] === "string" ? (r["html_url"] as string) : "",
    state: r["state"] === "closed" ? "closed" : "open",
    isPull: !!r["pull_request"],
    user: user ? { login: String(user["login"] ?? ""), avatarUrl: String(user["avatar_url"] ?? "") } : null,
    createdAt: typeof r["created_at"] === "string" ? (r["created_at"] as string) : "",
    closedAt: typeof r["closed_at"] === "string" ? (r["closed_at"] as string) : null,
    merged: false,
  };
}

function parseCommitRef(raw: unknown): PulseCommitRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sha = typeof r["sha"] === "string" ? (r["sha"] as string) : null;
  if (!sha) return null;
  const commit = readObj(r["commit"]);
  const author = commit ? readObj(commit["author"]) : null;
  const ghAuthor = readObj(r["author"]);
  const message = (commit && typeof commit["message"] === "string") ? (commit["message"] as string) : "";
  return {
    sha,
    abbrevSha: sha.slice(0, 7),
    headline: message.split("\n")[0] ?? "",
    htmlUrl: typeof r["html_url"] === "string" ? (r["html_url"] as string) : "",
    authorLogin: ghAuthor && typeof ghAuthor["login"] === "string" ? (ghAuthor["login"] as string) : null,
    authorAvatar: (ghAuthor && typeof ghAuthor["avatar_url"] === "string") ? (ghAuthor["avatar_url"] as string) : "",
    date: (author && typeof author["date"] === "string") ? (author["date"] as string) : "",
  };
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
