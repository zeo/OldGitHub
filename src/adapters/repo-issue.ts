import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";
import { loadPagePayload, parseRepoPage } from "./_page";
import { escapeText } from "@/util/html";
import { parsePatch, parseUnifiedDiff, type DiffHunk } from "@/util/diff";

export type IssueState = "OPEN" | "CLOSED";
export type PullState = "OPEN" | "CLOSED" | "MERGED";

export type Actor = {
  login: string;
  avatarUrl: string;
  isAgent?: boolean;
};

export type Label = {
  name: string;
  color: string;
  description: string | null;
};

export type ReactionCount = {
  content: string;
  count: number;
};

export type Milestone = {
  title: string;
  url: string;
};

export type CommentNode = {
  kind: "comment";
  id: string;
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
  authorAssociation: string | null;
  reactions: ReactionCount[];
  isAuthor: boolean;
  reviewId?: number;
};

export type EventNode = {
  kind: "event";
  type: string;
  actor: Actor | null;
  createdAt: string;
  label?: Label;
  assignee?: Actor;
  fromState?: string;
  toState?: string;
  refTitle?: string;
  refUrl?: string;
  ref?: string;
  commitOid?: string;
  commitMessageHeadline?: string;
  reviewId?: number;
};

export type TimelineNode = CommentNode | EventNode;

export type IssueDetail = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  titleHtml: string;
  state: IssueState;
  stateReason: string | null;
  bodyHtml: string;
  author: Actor | null;
  createdAt: string;
  labels: Label[];
  assignees: Actor[];
  milestone: Milestone | null;
  reactions: ReactionCount[];
  timeline: TimelineNode[];
  totalTimelineCount: number | null;
  isLocked: boolean;
};

export type PullDetail = Omit<IssueDetail, "state"> & {
  isDraft: boolean;
  state: PullState;
  headRefName: string;
  baseRefName: string;
  headRepoOwner: string | null;
  baseSha: string;
  headSha: string;
  commitsCount: number;
  changedFiles: number | null;
  additions: number;
  deletions: number;
  merged: boolean;
  mergedAt: string | null;
  mergedBy: Actor | null;
  reviewThreads: ReviewThread[];
  // built from the page alone: labels, assignees, comments and reviews were not available
  metadataHidden?: boolean;
};

export type ReviewComment = {
  id: number;
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
};

export type ReviewThread = {
  id: number;
  reviewId: number | null;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  diffHunk: string;
  outdated: boolean;
  comments: ReviewComment[];
};

const API = "https://api.github.com";
const HTML_ACCEPT = "application/vnd.github.html+json";

export type PullFile = {
  filename: string;
  previousFilename: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  blobUrl: string;
};

export type PullCommit = {
  sha: string;
  abbrevSha: string;
  headline: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatarUrl: string;
  committerDate: string;
};

export type CheckRun = {
  id: number;
  name: string;
  appName: string | null;
  status: "queued" | "in_progress" | "completed" | "waiting" | "pending" | "requested";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | "stale" | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string;
  detailsUrl: string;
  outputTitle: string | null;
  outputSummary: string | null;
};

// a pull's diff is its base...head compare, which github.com serves itself; pull/N.diff redirects to a host without cors
export async function getPullFiles(p: PullDetail): Promise<PullFile[]> {
  const resp = p.baseSha && p.headSha
    ? await fetch(`https://github.com/${p.owner}/${p.repo}/compare/${p.baseSha}...${p.headSha}.diff`, {
      credentials: "include",
      headers: { Accept: "text/plain" },
    }).catch(() => null)
    : null;
  if (!resp?.ok) {
    const pages = await apiFetchAll(`/repos/${p.owner}/${p.repo}/pulls/${p.number}/files`);
    return pages.map((r) => parsePullFile(r)).filter((f): f is PullFile => f !== null);
  }
  return parseUnifiedDiff(await resp.text()).map((f) => ({
    filename: f.path,
    previousFilename: f.status === "renamed" ? f.oldPath : null,
    status: f.status === "deleted" ? "removed" : f.status === "binary" ? "modified" : f.status,
    additions: f.additions,
    deletions: f.deletions,
    hunks: f.hunks,
    blobUrl: `https://github.com/${p.owner}/${p.repo}/blob/${p.headSha}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
  }));
}

// replies point at the thread's first comment, so grouping by that id rebuilds each conversation
export async function getReviewThreads(owner: string, repo: string, number: number): Promise<ReviewThread[]> {
  const threads = new Map<number, ReviewThread>();
  for (const raw of await apiFetchAll(`/repos/${owner}/${repo}/pulls/${number}/comments`)) {
    const r = readObj(raw);
    const id = r && readNumber(r, "id");
    if (!r || id == null) continue;
    const comment: ReviewComment = {
      id,
      author: restActor(r["user"]),
      bodyHtml: readString(r, "body_html") ?? "",
      createdAt: readString(r, "created_at") ?? "",
    };
    const parent = threads.get(readNumber(r, "in_reply_to_id") ?? -1);
    if (parent) {
      parent.comments.push(comment);
      continue;
    }
    const line = readNumber(r, "line");
    threads.set(id, {
      id,
      reviewId: readNumber(r, "pull_request_review_id"),
      path: readString(r, "path") ?? "",
      line,
      side: readString(r, "side") === "LEFT" ? "LEFT" : "RIGHT",
      diffHunk: readString(r, "diff_hunk") ?? "",
      outdated: line == null,
      comments: [comment],
    });
  }
  return Array.from(threads.values());
}

export async function getPullCommits(owner: string, repo: string, number: number): Promise<PullCommit[]> {
  const route = readPath(await loadPagePayload(`https://github.com/${owner}/${repo}/pull/${number}/commits`).catch(() => null), ["payload", "pullRequestsCommitsRoute"]);
  if (route && route["truncated"] !== true && Array.isArray(route["commitGroups"])) {
    return readArray(route["commitGroups"]).flatMap((g) => readArray(readObj(g)?.["commits"])).flatMap((raw) => {
      const c = readObj(raw);
      const sha = c && readString(c, "oid");
      if (!c || !sha) return [];
      const author = readObj(readArray(c["authors"])[0]);
      const login = author && readString(author, "login");
      return [{
        sha,
        abbrevSha: sha.slice(0, 7),
        headline: readString(c, "shortMessage") ?? "",
        authorName: (author && readString(author, "displayName")) ?? "",
        authorLogin: login,
        authorAvatarUrl: (author && readString(author, "avatarUrl")) || (login ? `https://github.com/${login}.png?size=40` : ""),
        committerDate: readString(c, "committedDate") ?? "",
      }];
    });
  }
  const pages = await apiFetchAll(`/repos/${owner}/${repo}/pulls/${number}/commits`);
  return pages.map((r) => parsePullCommit(r)).filter((c): c is PullCommit => c !== null);
}

export async function getPullChecks(owner: string, repo: string, sha: string): Promise<CheckRun[]> {
  if (!sha) throw new AdapterFailure("getPullChecks", "head sha missing");
  const resp = await fetchApi(`${API}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
    credentials: "omit",
    headers: { Accept: HTML_ACCEPT },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getPullChecks", `check-runs responded ${resp.status}`);
  }
  const data = (await resp.json()) as { check_runs?: unknown };
  const runs = Array.isArray(data.check_runs) ? data.check_runs : [];
  return runs.map((r) => parseCheckRun(r)).filter((c): c is CheckRun => c !== null);
}

function parseCheckRun(raw: unknown): CheckRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = readNumber(r, "id");
  const name = readString(r, "name");
  if (id == null || !name) return null;
  const statusStr = readString(r, "status") ?? "queued";
  const status = (["queued", "in_progress", "completed", "waiting", "pending", "requested"] as const).find((s) => s === statusStr) ?? "queued";
  const conclusionStr = readString(r, "conclusion");
  const conclusion = (["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale"] as const).find((s) => s === conclusionStr) ?? null;
  const app = readObj(r["app"]);
  const output = readObj(r["output"]);
  return {
    id,
    name,
    appName: app ? readString(app, "name") : null,
    status,
    conclusion,
    startedAt: readString(r, "started_at"),
    completedAt: readString(r, "completed_at"),
    htmlUrl: readString(r, "html_url") ?? "",
    detailsUrl: readString(r, "details_url") ?? "",
    outputTitle: output ? readString(output, "title") : null,
    outputSummary: output ? readString(output, "summary") : null,
  };
}

function parsePullFile(raw: unknown): PullFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const filename = readString(f, "filename");
  if (!filename) return null;
  const statusStr = readString(f, "status") ?? "modified";
  const status = (["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"] as const).find((s) => s === statusStr) ?? "modified";
  return {
    filename,
    previousFilename: readString(f, "previous_filename"),
    status,
    additions: readNumber(f, "additions") ?? 0,
    deletions: readNumber(f, "deletions") ?? 0,
    hunks: parsePatch(readString(f, "patch") ?? ""),
    blobUrl: readString(f, "blob_url") ?? "",
  };
}

function parsePullCommit(raw: unknown): PullCommit | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const sha = readString(c, "sha");
  if (!sha) return null;
  const commitObj = readObj(c["commit"]);
  const message = (commitObj && readString(commitObj, "message")) ?? "";
  const authorObj = commitObj ? readObj(commitObj["author"]) : null;
  const committerObj = commitObj ? readObj(commitObj["committer"]) : null;
  const ghAuthor = readObj(c["author"]);
  const authorLogin = ghAuthor ? readString(ghAuthor, "login") : null;
  return {
    sha,
    abbrevSha: sha.slice(0, 7),
    headline: message.split("\n")[0] ?? "",
    authorName: (authorObj && readString(authorObj, "name")) ?? "",
    authorLogin,
    authorAvatarUrl: (ghAuthor && readString(ghAuthor, "avatar_url")) || (authorLogin ? `https://github.com/${authorLogin}.png?size=40` : ""),
    committerDate: (committerObj && readString(committerObj, "date")) ?? (authorObj && readString(authorObj, "date")) ?? "",
  };
}

export async function getIssue(owner: string, repo: string, number: number): Promise<IssueDetail> {
  const [issueRaw, timelineRaw] = await Promise.all([
    apiFetch(`/repos/${owner}/${repo}/issues/${number}`),
    apiFetchAll(`/repos/${owner}/${repo}/issues/${number}/timeline`),
  ]);
  if (!issueRaw || typeof issueRaw !== "object") {
    throw new AdapterFailure("getIssue", `issue ${owner}/${repo}#${number} not parseable`);
  }
  return restToIssue(owner, repo, number, issueRaw as Record<string, unknown>, timelineRaw);
}

export async function getPull(owner: string, repo: string, number: number): Promise<PullDetail> {
  const [prRaw, issueRaw, timelineRaw, reviewThreads] = await Promise.all([
    apiFetch(`/repos/${owner}/${repo}/pulls/${number}`),
    apiFetch(`/repos/${owner}/${repo}/issues/${number}`),
    apiFetchAll(`/repos/${owner}/${repo}/issues/${number}/timeline`),
    getReviewThreads(owner, repo, number),
  ]);
  if (!prRaw || typeof prRaw !== "object" || !issueRaw || typeof issueRaw !== "object") {
    throw new AdapterFailure("getPull", `pull ${owner}/${repo}#${number} not parseable`);
  }
  const base = restToIssue(owner, repo, number, issueRaw as Record<string, unknown>, timelineRaw);
  return { ...restToPull(base, prRaw as Record<string, unknown>), reviewThreads };
}

// the issue page embeds the same graphql data github's own view renders, so it needs no api quota
export async function getIssueFromPage(owner: string, repo: string, number: number): Promise<IssueDetail> {
  const payload = await loadPagePayload(`https://github.com/${owner}/${repo}/issues/${number}`);
  const issue = readPath(payload, ["payload", "issueViewerRoute", "data", "repository", "issue"]);
  if (!issue || readNumber(issue, "number") !== number) {
    throw new AdapterFailure("getIssueFromPage", `issue ${owner}/${repo}#${number} not in page payload`);
  }
  const front = readObj(issue["timelineItems"]);
  const seen = new Set<string>();
  const nodesOf = (conn: Record<string, unknown> | null): TimelineNode[] =>
    readArray(conn?.["edges"]).flatMap((e) => {
      const n = readObj(readObj(e)?.["node"]);
      const id = n && readString(n, "id");
      if (!n || !id || seen.has(id)) return [];
      seen.add(id);
      const node = pageTimelineItem(n);
      return node ? [node] : [];
    });
  const timeline = nodesOf(front);
  const tail = nodesOf(readObj(issue["backTimelineItems"]));
  const hidden = (front ? readNumber(front, "totalCount") ?? 0 : 0) - seen.size;
  if (readObj(front?.["pageInfo"])?.["hasNextPage"] === true && hidden > 0) {
    timeline.push({ kind: "event", type: "TimelineGap", actor: null, createdAt: "", toState: String(hidden) });
  }
  timeline.push(...tail);
  const title = readString(issue, "title") ?? "";

  return {
    owner,
    repo,
    number,
    title,
    titleHtml: readString(issue, "titleHTML") ?? escapeText(title),
    state: readString(issue, "state") === "CLOSED" ? "CLOSED" : "OPEN",
    stateReason: readString(issue, "stateReason"),
    bodyHtml: readString(issue, "bodyHTML") ?? "",
    author: pageActor(issue["author"]),
    createdAt: readString(issue, "createdAt") ?? "",
    labels: readArray(readObj(issue["labels"])?.["edges"]).map((e) => restLabel(readObj(e)?.["node"])).filter((l): l is Label => l !== null),
    assignees: readArray(readObj(issue["assignedActors"])?.["nodes"]).map(pageActor).filter((a): a is Actor => a !== null),
    milestone: restMilestone(issue["milestone"]),
    reactions: pageReactions(issue["reactionGroups"]),
    timeline,
    totalTimelineCount: readNumber(issue, "totalCommentsCount") ?? timeline.filter((n) => n.kind === "comment").length,
    isLocked: issue["locked"] === true,
  };
}

// the middle of a long issue's timeline is only reachable through the api
export async function fillTimelineGap(v: IssueDetail): Promise<IssueDetail> {
  if (!v.timeline.some((n) => n.kind === "event" && n.type === "TimelineGap")) return v;
  try {
    return { ...v, timeline: restTimeline(await apiFetchAll(`/repos/${v.owner}/${v.repo}/issues/${v.number}/timeline`)) };
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    return v;
  }
}

// signed in, every pull tab carries the header and the conversation tab the description; comments and reviews load separately
export async function getPullFromPage(owner: string, repo: string, number: number, tab = ""): Promise<PullDetail> {
  const payload = await loadPagePayload(`https://github.com/${owner}/${repo}/pull/${number}${tab ? `/${tab}` : ""}`);
  const pr = readPath(payload, ["payload", "pullRequestsLayoutRoute", "pullRequest"]);
  const overview = readPath(payload, ["payload", "pullRequestsOverviewIndexRoute"]);
  if (!pr || readNumber(pr, "number") !== number) {
    throw new AdapterFailure("getPullFromPage", `pull ${owner}/${repo}#${number} not in page payload`);
  }
  const author = readObj(pr["author"]);
  const login = author && readString(author, "login");
  const mergedLogin = readString(pr, "mergedBy") ?? readNestedString(pr["mergedBy"], ["login"]);
  const mergedAt = readString(pr, "mergedTime");
  const rawState = readString(pr, "state");
  const headOwner = readString(pr, "headRepositoryOwnerLogin");
  const title = readString(pr, "title") ?? "";
  const reactions = readArray(overview?.["reactionGroups"]).flatMap((g) => {
    const o = readObj(g);
    const content = readNestedString(o, ["reaction", "content"]);
    const count = o ? readNumber(o, "totalCount") ?? 0 : 0;
    return content && count > 0 ? [{ content, count }] : [];
  });

  return {
    owner,
    repo,
    number,
    title,
    titleHtml: readString(pr, "titleHtml") ?? escapeText(title),
    state: mergedAt ? "MERGED" : rawState === "CLOSED" ? "CLOSED" : "OPEN",
    stateReason: null,
    bodyHtml: (overview && readString(overview, "description")) ?? "",
    author: login ? { login, avatarUrl: readString(author, "avatarUrl") ?? `https://github.com/${login}.png?size=64`, isAgent: author["isAgent"] === true } : null,
    createdAt: readString(pr, "createdTime") ?? "",
    labels: [],
    assignees: [],
    milestone: null,
    reactions,
    timeline: [{ kind: "event", type: "TimelineGap", actor: null, createdAt: "" }],
    totalTimelineCount: null,
    isLocked: pr["locked"] === true,
    isDraft: rawState === "DRAFT",
    headRefName: readString(pr, "headBranch") ?? "",
    baseRefName: readString(pr, "baseBranch") ?? "",
    headRepoOwner: headOwner && headOwner.toLowerCase() !== owner.toLowerCase() ? headOwner : null,
    baseSha: readString(pr, "baseSha") ?? "",
    headSha: readString(pr, "headSha") ?? "",
    commitsCount: readNumber(pr, "commitsCount") ?? 0,
    changedFiles: null,
    additions: 0,
    deletions: 0,
    merged: mergedAt !== null,
    mergedAt,
    mergedBy: mergedLogin ? { login: mergedLogin, avatarUrl: readString(pr, "mergedByAvatarUrl") ?? `https://github.com/${mergedLogin}.png?size=64` } : null,
    reviewThreads: [],
    metadataHidden: true,
  };
}

function pageTimelineItem(n: Record<string, unknown>): TimelineNode | null {
  const type = readString(n, "__typename") ?? "";
  const createdAt = readString(n, "createdAt") ?? "";
  if (type === "IssueComment") {
    const reason = readString(n, "minimizedReason");
    return {
      kind: "comment",
      id: String(n["databaseId"] ?? n["id"]),
      author: pageActor(n["author"]),
      bodyHtml: n["isMinimized"] === true
        ? `<p><em>This comment was hidden${reason ? ` as ${escapeText(reason.toLowerCase().replace(/[_-]/g, " "))}` : ""}.</em></p>`
        : readString(n, "bodyHTML") ?? "",
      createdAt,
      authorAssociation: readString(n, "authorAssociation"),
      reactions: pageReactions(n["reactionGroups"]),
      isAuthor: false,
    };
  }
  const base: EventNode = { kind: "event", type, actor: pageActor(n["actor"]), createdAt };
  const label = restLabel(n["label"]);
  if (label) base.label = label;
  const assignee = pageActor(n["assignee"]);
  if (assignee) base.assignee = assignee;
  const reason = readString(n, "stateReason");
  if (type === "ClosedEvent" && reason) base.toState = reason;
  if (type === "RenamedTitleEvent") {
    base.fromState = readString(n, "previousTitle") ?? "";
    base.toState = readString(n, "currentTitle") ?? "";
  }
  const source = readObj(n["innerSource"]);
  if (source) {
    const titleHtml = readString(source, "titleHTML");
    const url = readString(source, "url");
    const num = readNumber(source, "number");
    if (titleHtml) base.refTitle = parseRepoPage(titleHtml).body.textContent ?? "";
    if (url) base.refUrl = url.replace(/^https:\/\/github\.com/, "");
    if (num != null) base.ref = `#${num}`;
  }
  return base;
}

function pageActor(raw: unknown): Actor | null {
  const a = readObj(raw);
  const login = a && readString(a, "login");
  if (!login) return null;
  return {
    login,
    avatarUrl: readString(a, "avatarUrl") ?? `https://github.com/${login}.png?size=64`,
    isAgent: a["__typename"] === "Bot",
  };
}

function pageReactions(raw: unknown): ReactionCount[] {
  return readArray(raw).flatMap((g) => {
    const o = readObj(g);
    const content = o && readString(o, "content");
    const count = readNumber(readObj(o?.["reactors"]) ?? {}, "totalCount") ?? 0;
    return content && count > 0 ? [{ content, count }] : [];
  });
}

function readPath(raw: unknown, path: string[]): Record<string, unknown> | null {
  let cur: unknown = raw;
  for (const k of path) cur = readObj(cur)?.[k];
  return readObj(cur);
}

async function apiFetch(path: string): Promise<unknown | null> {
  const resp = await fetchApi(`${API}${path}`, {
    credentials: "omit",
    headers: { Accept: HTML_ACCEPT },
  });
  if (!resp.ok) {
    throw new AdapterFailure("apiFetch", `${path} responded ${resp.status}`);
  }
  try {
    return (await resp.json()) as unknown;
  } catch (err) {
    throw new AdapterFailure("apiFetch", `${path} returned invalid JSON`, { cause: err });
  }
}

async function apiFetchAll(path: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let url = `${API}${path}?per_page=100`;
  for (let i = 0; i < 5; i++) {
    const resp = await fetchApi(url, {
      credentials: "omit",
      headers: { Accept: HTML_ACCEPT },
    });
    if (!resp.ok) {
      throw new AdapterFailure("apiFetchAll", `${path} responded ${resp.status}`);
    }
    const page = (await resp.json()) as unknown;
    if (!Array.isArray(page)) break;
    out.push(...page);
    const link = resp.headers.get("link") || "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    if (!next || !next[1]) break;
    url = next[1];
  }
  return out;
}

function restToIssue(
  owner: string,
  repo: string,
  number: number,
  issue: Record<string, unknown>,
  timeline: unknown[],
): IssueDetail {
  const title = readString(issue, "title") ?? "";
  const bodyHtml = readString(issue, "body_html") ?? "";
  const state = readString(issue, "state") === "closed" ? "CLOSED" : "OPEN";
  const stateReason = readString(issue, "state_reason");
  const createdAt = readString(issue, "created_at") ?? "";
  const author = restActor(issue["user"]);
  const labels = readArray(issue["labels"]).map(restLabel).filter((l): l is Label => l !== null);
  const assignees = readArray(issue["assignees"]).map(restActor).filter((a): a is Actor => a !== null);
  const milestone = restMilestone(issue["milestone"]);
  const reactions = restReactionSummary(issue["reactions"]);
  const nodes = restTimeline(timeline);
  const commentsTotal = readNumber(issue, "comments") ?? 0;

  return {
    owner,
    repo,
    number,
    title,
    titleHtml: escapeText(title),
    state,
    stateReason: stateReason ?? null,
    bodyHtml,
    author,
    createdAt,
    labels,
    assignees,
    milestone,
    reactions,
    timeline: nodes,
    totalTimelineCount: Math.max(commentsTotal, nodes.filter((n) => n.kind === "comment").length),
    isLocked: issue["locked"] === true,
  };
}

function restToPull(base: IssueDetail, pr: Record<string, unknown>): Omit<PullDetail, "reviewThreads"> {
  const merged = pr["merged"] === true;
  const state: PullState = merged
    ? "MERGED"
    : readString(pr, "state") === "closed"
      ? "CLOSED"
      : "OPEN";
  const isDraft = pr["draft"] === true;
  const head = readObj(pr["head"]);
  const baseObj = readObj(pr["base"]);
  const headRefName = head ? (readString(head, "ref") ?? "") : "";
  const baseRefName = baseObj ? (readString(baseObj, "ref") ?? "") : "";
  const headRepoOwner = readNestedString(pr["head"], ["repo", "owner", "login"]);
  const baseRepoOwner = readNestedString(pr["base"], ["repo", "owner", "login"]);
  const headRepoOwnerNorm = headRepoOwner && headRepoOwner !== baseRepoOwner ? headRepoOwner : null;
  const mergedBy = restActor(pr["merged_by"]);

  return {
    ...base,
    bodyHtml: base.bodyHtml || readString(pr, "body_html") || "",
    state,
    isDraft,
    headRefName,
    baseRefName,
    headRepoOwner: headRepoOwnerNorm,
    baseSha: (baseObj && readString(baseObj, "sha")) ?? "",
    headSha: (head && readString(head, "sha")) ?? "",
    commitsCount: readNumber(pr, "commits") ?? 0,
    changedFiles: readNumber(pr, "changed_files") ?? 0,
    additions: readNumber(pr, "additions") ?? 0,
    deletions: readNumber(pr, "deletions") ?? 0,
    merged,
    mergedAt: readString(pr, "merged_at"),
    mergedBy,
  };
}

function restTimeline(raw: unknown[]): TimelineNode[] {
  const out: TimelineNode[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const n = r as Record<string, unknown>;
    const ev = readString(n, "event");
    if (!ev) continue;
    const parsed = restTimelineItem(ev, n);
    if (parsed) out.push(parsed);
  }
  return out;
}

function restTimelineItem(ev: string, n: Record<string, unknown>): TimelineNode | null {
  if (ev === "commented") {
    return {
      kind: "comment",
      id: String(n["id"] ?? n["node_id"] ?? ""),
      author: restActor(n["user"]) ?? restActor(n["actor"]),
      bodyHtml: readString(n, "body_html") ?? "",
      createdAt: readString(n, "created_at") ?? "",
      authorAssociation: readString(n, "author_association"),
      reactions: restReactionSummary(n["reactions"]),
      isAuthor: false,
    };
  }

  if (ev === "reviewed") {
    const state = (readString(n, "state") ?? "").toUpperCase();
    const body = readString(n, "body_html") ?? "";
    const reviewId = readNumber(n, "id") ?? undefined;
    if (body) {
      return {
        kind: "comment",
        id: String(n["id"] ?? n["node_id"] ?? ""),
        author: restActor(n["user"]),
        bodyHtml: prefixReviewBody(state, body),
        createdAt: readString(n, "submitted_at") ?? readString(n, "created_at") ?? "",
        authorAssociation: readString(n, "author_association"),
        reactions: [],
        isAuthor: false,
        ...(reviewId != null && { reviewId }),
      };
    }
    return {
      kind: "event",
      type: "PullRequestReview",
      actor: restActor(n["user"]) ?? restActor(n["actor"]),
      createdAt: readString(n, "submitted_at") ?? readString(n, "created_at") ?? "",
      toState: state.toLowerCase(),
      ...(reviewId != null && { reviewId }),
    };
  }

  // line comments arrive through getReviewThreads instead
  if (ev === "subscribed" || ev === "unsubscribed" || ev === "mentioned" || ev === "line-commented") return null;

  const base: EventNode = {
    kind: "event",
    type: mapEventType(ev),
    actor: restActor(n["actor"]) ?? restActor(n["user"]),
    createdAt: readString(n, "created_at") ?? readString(n, "submitted_at") ?? "",
  };

  switch (ev) {
    case "labeled":
    case "unlabeled": {
      const l = restLabel(n["label"]);
      if (l) base.label = l;
      return base;
    }
    case "assigned":
    case "unassigned": {
      const a = restActor(n["assignee"]);
      if (a) base.assignee = a;
      return base;
    }
    case "milestoned":
    case "demilestoned": {
      const m = readObj(n["milestone"]);
      const t = m ? readString(m, "title") : null;
      if (t) base.toState = t;
      return base;
    }
    case "closed": {
      const sr = readString(n, "state_reason");
      if (sr) base.toState = sr;
      return base;
    }
    case "renamed": {
      const r = readObj(n["rename"]);
      if (r) {
        const from = readString(r, "from");
        const to = readString(r, "to");
        if (from) base.fromState = from;
        if (to) base.toState = to;
      }
      return base;
    }
    case "referenced": {
      const cid = readString(n, "commit_id");
      if (cid) base.commitOid = cid.slice(0, 7);
      const repoUrl = readString(n, "commit_url");
      if (repoUrl) base.refUrl = repoUrl.replace(/^https?:\/\/github\.com/, "");
      return base;
    }
    case "cross-referenced": {
      const src = readObj(n["source"]);
      if (src) {
        const issueObj = readObj(src["issue"]);
        if (issueObj) {
          const t = readString(issueObj, "title");
          const u = readString(issueObj, "html_url");
          if (t) base.refTitle = t;
          if (u) base.refUrl = u.replace(/^https?:\/\/github\.com/, "");
          const num = readNumber(issueObj, "number");
          if (num != null) base.ref = `#${num}`;
        }
      }
      return base;
    }
    case "committed": {
      const sha = readString(n, "sha");
      if (sha) base.commitOid = sha.slice(0, 7);
      const msg = readString(n, "message");
      if (msg) base.commitMessageHeadline = escapeText(msg.split("\n")[0] ?? "");
      const author = readObj(n["author"]);
      if (author && !base.actor) {
        const login = readString(author, "name");
        if (login) base.actor = { login, avatarUrl: `https://github.com/${login}.png?size=64` };
      }
      return base;
    }
    case "merged": {
      const cid = readString(n, "commit_id");
      if (cid) base.commitOid = cid.slice(0, 7);
      return base;
    }
    case "head_ref_force_pushed":
    case "base_ref_force_pushed": {
      return base;
    }
    default:
      return base;
  }
}

function mapEventType(ev: string): string {
  switch (ev) {
    case "labeled": return "LabeledEvent";
    case "unlabeled": return "UnlabeledEvent";
    case "assigned": return "AssignedEvent";
    case "unassigned": return "UnassignedEvent";
    case "milestoned": return "MilestonedEvent";
    case "demilestoned": return "DemilestonedEvent";
    case "closed": return "ClosedEvent";
    case "reopened": return "ReopenedEvent";
    case "merged": return "MergedEvent";
    case "renamed": return "RenamedTitleEvent";
    case "referenced": return "ReferencedEvent";
    case "cross-referenced": return "CrossReferencedEvent";
    case "committed": return "PullRequestCommit";
    case "head_ref_force_pushed": return "HeadRefForcePushedEvent";
    case "base_ref_force_pushed": return "BaseRefForcePushedEvent";
    case "head_ref_deleted": return "HeadRefDeletedEvent";
    case "head_ref_restored": return "HeadRefRestoredEvent";
    case "ready_for_review": return "ReadyForReviewEvent";
    case "convert_to_draft": return "ConvertToDraftEvent";
    case "review_requested": return "ReviewRequestedEvent";
    case "review_request_removed": return "ReviewRequestRemovedEvent";
    case "review_dismissed": return "ReviewDismissedEvent";
    case "locked": return "LockedEvent";
    case "unlocked": return "UnlockedEvent";
    case "pinned": return "PinnedEvent";
    case "unpinned": return "UnpinnedEvent";
    case "transferred": return "TransferredEvent";
    case "moved_columns_in_project": return "MovedColumnsInProjectEvent";
    case "added_to_project": return "AddedToProjectEvent";
    case "removed_from_project": return "RemovedFromProjectEvent";
    case "auto_merge_enabled": return "AutoMergeEnabledEvent";
    case "auto_merge_disabled": return "AutoMergeDisabledEvent";
    case "auto_rebase_enabled": return "AutoRebaseEnabledEvent";
    case "auto_squash_enabled": return "AutoSquashEnabledEvent";
    default: return ev.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("") + "Event";
  }
}

function prefixReviewBody(state: string, body: string): string {
  let label = "reviewed";
  if (state === "APPROVED") label = "approved these changes";
  else if (state === "CHANGES_REQUESTED") label = "requested changes";
  else if (state === "COMMENTED") label = "left a review comment";
  else if (state === "DISMISSED") label = "had this review dismissed";
  return `<p><em>${label}</em></p>${body}`;
}

function restActor(raw: unknown): Actor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const login = readString(a, "login");
  if (!login) return null;
  return {
    login,
    avatarUrl: readString(a, "avatar_url") ?? `https://github.com/${login}.png?size=64`,
    isAgent: /\[bot\]$/.test(login) || a["type"] === "Bot",
  };
}

function restLabel(raw: unknown): Label | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const name = readString(l, "name");
  if (!name) return null;
  return {
    name,
    color: (readString(l, "color") ?? "ccc").replace(/^#/, ""),
    description: readString(l, "description"),
  };
}

function restMilestone(raw: unknown): Milestone | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const title = readString(m, "title");
  if (!title) return null;
  return {
    title,
    url: (readString(m, "html_url") ?? readString(m, "url") ?? "").replace(/^https:\/\/github\.com/, ""),
  };
}

function restReactionSummary(raw: unknown): ReactionCount[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const map: Array<[string, string]> = [
    ["+1", "THUMBS_UP"],
    ["-1", "THUMBS_DOWN"],
    ["laugh", "LAUGH"],
    ["hooray", "HOORAY"],
    ["confused", "CONFUSED"],
    ["heart", "HEART"],
    ["rocket", "ROCKET"],
    ["eyes", "EYES"],
  ];
  const out: ReactionCount[] = [];
  for (const [key, content] of map) {
    const v = r[key];
    if (typeof v === "number" && v > 0) out.push({ content, count: v });
  }
  return out;
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
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

function readNestedString(raw: unknown, path: string[]): string | null {
  let cur: unknown = raw;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? (cur as string) : null;
}
