import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";
import { loadPagePayload } from "./_page";
import { readArray, readNumber, readObj, readString } from "./_json";
import { escapeText } from "@/util/html";
import { parseUnifiedDiff, type DiffHunk } from "@/util/diff";
import {
  pageActor,
  pageReactions,
  pageReviewThreads,
  pageTimelineItem,
  parseCheckRun,
  parsePullCommit,
  parsePullFile,
  readNestedString,
  readPath,
  restActor,
  restLabel,
  restMilestone,
  restTimeline,
  restToIssue,
  restToPull,
} from "./_repo-issue-parse";

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
  // the page held only some threads, the api has the rest
  threadsMissing?: boolean;
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
      outdated: line == null && readString(r, "subject_type") !== "file",
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
    ...pageReviewThreads(readPath(payload, ["payload", "pullRequestsChangesRoute"])),
    metadataHidden: true,
  };
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
  const firstUrl = `${API}${path}?per_page=100`;
  const firstResp = await fetchApi(firstUrl, {
    credentials: "omit",
    headers: { Accept: HTML_ACCEPT },
  });
  if (!firstResp.ok) {
    throw new AdapterFailure("apiFetchAll", `${path} responded ${firstResp.status}`);
  }
  const firstPage = (await firstResp.json()) as unknown;
  if (!Array.isArray(firstPage)) return [];
  const out: unknown[] = [...firstPage];
  const link = firstResp.headers.get("link") || "";
  const lastMatch = /<([^>]+)>;\s*rel="last"/.exec(link);
  const lastPage = lastMatch?.[1] ? Number(new URL(lastMatch[1]).searchParams.get("page") ?? 1) : 0;
  if (lastPage >= 2) {
    const cap = Math.min(lastPage, 5);
    const rest = await Promise.all(
      Array.from({ length: cap - 1 }, (_, i) => {
        const u = new URL(firstUrl);
        u.searchParams.set("page", String(i + 2));
        return fetchApi(u.href, { credentials: "omit", headers: { Accept: HTML_ACCEPT } }).then(async (r) => {
          if (!r.ok) throw new AdapterFailure("apiFetchAll", `${path} responded ${r.status}`);
          const data = (await r.json()) as unknown;
          return Array.isArray(data) ? data : [];
        });
      }),
    );
    for (const page of rest) out.push(...page);
    return out;
  }

  let url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
  for (let i = 1; i < 5 && url; i++) {
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
    url = /<([^>]+)>;\s*rel="next"/.exec(resp.headers.get("link") || "")?.[1] ?? null;
  }
  return out;
}
