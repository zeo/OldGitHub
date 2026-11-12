import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";
import { escapeText } from "@/util/html";

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
  totalTimelineCount: number;
  isLocked: boolean;
};

export type PullDetail = Omit<IssueDetail, "state"> & {
  isDraft: boolean;
  state: PullState;
  headRefName: string;
  baseRefName: string;
  headRepoOwner: string | null;
  commitsCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  merged: boolean;
  mergedAt: string | null;
  mergedBy: Actor | null;
  reviewThreads: ReviewThread[];
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
  changes: number;
  patch: string | null;
  blobUrl: string;
  rawUrl: string;
  sha: string;
};

export type PullCommit = {
  sha: string;
  abbrevSha: string;
  message: string;
  headline: string;
  body: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatarUrl: string;
  authorDate: string;
  committerDate: string;
  commentCount: number;
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

export async function getPullFiles(owner: string, repo: string, number: number): Promise<PullFile[]> {
  const pages = await apiFetchAll(`/repos/${owner}/${repo}/pulls/${number}/files`);
  return pages.map((r) => parsePullFile(r)).filter((f): f is PullFile => f !== null);
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
  const pages = await apiFetchAll(`/repos/${owner}/${repo}/pulls/${number}/commits`);
  return pages.map((r) => parsePullCommit(r)).filter((c): c is PullCommit => c !== null);
}

export async function getPullChecks(owner: string, repo: string, number: number): Promise<CheckRun[]> {
  const prRaw = await apiFetch(`/repos/${owner}/${repo}/pulls/${number}`);
  if (!prRaw || typeof prRaw !== "object") {
    throw new AdapterFailure("getPullChecks", "pull request not found");
  }
  const head = readObj((prRaw as Record<string, unknown>)["head"]);
  const sha = head ? readString(head, "sha") : null;
  if (!sha) {
    throw new AdapterFailure("getPullChecks", "head sha missing");
  }
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
    changes: readNumber(f, "changes") ?? 0,
    patch: readString(f, "patch"),
    blobUrl: readString(f, "blob_url") ?? "",
    rawUrl: readString(f, "raw_url") ?? "",
    sha: readString(f, "sha") ?? "",
  };
}

function parsePullCommit(raw: unknown): PullCommit | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const sha = readString(c, "sha");
  if (!sha) return null;
  const commitObj = readObj(c["commit"]);
  const message = (commitObj && readString(commitObj, "message")) ?? "";
  const lines = message.split("\n");
  const headline = lines[0] ?? "";
  const body = lines.slice(1).join("\n").trim();
  const authorObj = commitObj ? readObj(commitObj["author"]) : null;
  const authorName = (authorObj && readString(authorObj, "name")) ?? "";
  const authorDate = (authorObj && readString(authorObj, "date")) ?? "";
  const committerObj = commitObj ? readObj(commitObj["committer"]) : null;
  const committerDate = (committerObj && readString(committerObj, "date")) ?? authorDate;
  const ghAuthor = readObj(c["author"]);
  const authorLogin = ghAuthor ? readString(ghAuthor, "login") : null;
  const authorAvatarUrl = (ghAuthor && readString(ghAuthor, "avatar_url")) || (authorLogin ? `https://github.com/${authorLogin}.png?size=40` : "");
  const commentCount = (commitObj && readNumber(commitObj, "comment_count")) ?? 0;
  return {
    sha,
    abbrevSha: sha.slice(0, 7),
    message,
    headline,
    body,
    authorName,
    authorLogin,
    authorAvatarUrl,
    authorDate,
    committerDate,
    commentCount,
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
    url: (readString(m, "html_url") ?? "").replace(/^https:\/\/github\.com/, ""),
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
