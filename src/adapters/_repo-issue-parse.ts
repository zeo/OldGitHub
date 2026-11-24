import { parseRepoPage } from "./_page";
import { readArray, readNumber, readObj, readString } from "./_json";
import { escapeText, relativizeGithubUrl } from "@/util/html";
import { parsePatch } from "@/util/diff";
import type {
  Actor,
  CheckRun,
  EventNode,
  IssueDetail,
  Label,
  Milestone,
  PullCommit,
  PullDetail,
  PullFile,
  PullState,
  ReactionCount,
  ReviewComment,
  ReviewThread,
  TimelineNode,
} from "./repo-issue";

export function parseCheckRun(raw: unknown): CheckRun | null {
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

export function parsePullFile(raw: unknown): PullFile | null {
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

export function parsePullCommit(raw: unknown): PullCommit | null {
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
    authorAvatarUrl: (ghAuthor && readString(ghAuthor, "avatar_url")) || (authorLogin ? `https://github.com/${loginUrlPart(authorLogin)}.png?size=40` : ""),
    committerDate: (committerObj && readString(committerObj, "date")) ?? (authorObj && readString(authorObj, "date")) ?? "",
  };
}

function loginUrlPart(login: string): string {
  return encodeURIComponent(login);
}

export function pageTimelineItem(n: Record<string, unknown>): TimelineNode | null {
  const type = readString(n, "__typename") ?? "";
  const createdAt = readString(n, "createdAt") ?? "";
  if (type === "IssueComment") {
    const reason = readString(n, "minimizedReason");
    return {
      kind: "comment",
      id: String(n["databaseId"] ?? n["id"]),
      author: pageActor(n["author"]),
      bodyHtml: n["isMinimized"] === true ? hiddenBody(reason) : readString(n, "bodyHTML") ?? "",
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
    if (url) base.refUrl = relativizeGithubUrl(url);
    if (num != null) base.ref = `#${num}`;
  }
  return base;
}

function hiddenBody(reason: string | null): string {
  return `<p><em>This comment was hidden${reason ? ` as ${escapeText(reason.toLowerCase().replace(/[_-]/g, " "))}` : ""}.</em></p>`;
}

// the files page keys each file's threads by side and line (R130, L12) or FILE; it has no place for outdated threads and cuts long ones short
export function pageReviewThreads(route: Record<string, unknown> | null): Pick<PullDetail, "reviewThreads" | "threadsMissing"> {
  const markers = readObj(route?.["markers"]);
  const byId = readObj(markers?.["threads"]) ?? {};
  const reviewThreads: ReviewThread[] = [];
  let threadsMissing = readObj(markers?.["threadsPageInfo"])?.["hasNextPage"] !== false;
  for (const raw of readArray(route?.["diffSummaries"])) {
    const summary = readObj(raw);
    const path = summary && readString(summary, "path");
    for (const [key, marker] of Object.entries(readObj(summary?.["markersMap"]) ?? {})) {
      const at = /^([LR])(\d+)$/.exec(key);
      for (const ref of readArray(readObj(marker)?.["threads"])) {
        const t = readObj(byId[String(readObj(ref)?.["id"])]);
        const comments = readArray(readObj(t?.["commentsData"])?.["comments"]).flatMap(pageReviewComment);
        if (!path || !t || !comments[0] || (!at && key !== "FILE")) {
          threadsMissing = true;
          continue;
        }
        if (t["reviewCommentsLimitExceeded"] === true) threadsMissing = true;
        reviewThreads.push({
          id: comments[0].id,
          reviewId: readNumber(t, "pullRequestReviewId"),
          path,
          line: at ? Number(at[2]) : null,
          side: at?.[1] === "L" ? "LEFT" : "RIGHT",
          diffHunk: "",
          outdated: false,
          comments,
        });
      }
    }
  }
  return { reviewThreads, threadsMissing: threadsMissing || reviewThreads.length < Object.keys(byId).length };
}

function pageReviewComment(raw: unknown): ReviewComment[] {
  const c = readObj(raw);
  const id = c && readNumber(c, "databaseId");
  if (!c || id == null) return [];
  return [{
    id,
    author: pageActor(c["author"]),
    bodyHtml: c["isHidden"] === true ? hiddenBody(readString(c, "minimizedReason")) : readString(c, "bodyHTML") ?? "",
    createdAt: readString(c, "createdAt") ?? "",
  }];
}

export function pageActor(raw: unknown): Actor | null {
  const a = readObj(raw);
  const login = a && readString(a, "login");
  if (!login) return null;
  return {
    login,
    avatarUrl: readString(a, "avatarUrl") ?? `https://github.com/${login}.png?size=64`,
    isAgent: a["__typename"] === "Bot",
  };
}

export function pageReactions(raw: unknown): ReactionCount[] {
  return readArray(raw).flatMap((g) => {
    const o = readObj(g);
    const content = o && readString(o, "content");
    const count = readNumber(readObj(o?.["reactors"]) ?? {}, "totalCount") ?? 0;
    return content && count > 0 ? [{ content, count }] : [];
  });
}

export function readPath(raw: unknown, path: string[]): Record<string, unknown> | null {
  let cur: unknown = raw;
  for (const k of path) cur = readObj(cur)?.[k];
  return readObj(cur);
}

export function restToIssue(
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

export function restToPull(base: IssueDetail, pr: Record<string, unknown>): Omit<PullDetail, "reviewThreads"> {
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

export function restTimeline(raw: unknown[]): TimelineNode[] {
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
      if (repoUrl) {
        const m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]+)$/i.exec(repoUrl);
        base.refUrl = m ? `/${m[1]}/commit/${m[2]}` : relativizeGithubUrl(repoUrl);
      }
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
          if (u) base.refUrl = relativizeGithubUrl(u);
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
    case "base_ref_force_pushed":
      return base;
    default:
      return base;
  }
}

const EVENT_TYPE_MAP: Record<string, string> = {
  labeled: "LabeledEvent",
  unlabeled: "UnlabeledEvent",
  assigned: "AssignedEvent",
  unassigned: "UnassignedEvent",
  milestoned: "MilestonedEvent",
  demilestoned: "DemilestonedEvent",
  closed: "ClosedEvent",
  reopened: "ReopenedEvent",
  merged: "MergedEvent",
  renamed: "RenamedTitleEvent",
  referenced: "ReferencedEvent",
  "cross-referenced": "CrossReferencedEvent",
  committed: "PullRequestCommit",
  head_ref_force_pushed: "HeadRefForcePushedEvent",
  base_ref_force_pushed: "BaseRefForcePushedEvent",
  head_ref_deleted: "HeadRefDeletedEvent",
  head_ref_restored: "HeadRefRestoredEvent",
  ready_for_review: "ReadyForReviewEvent",
  convert_to_draft: "ConvertToDraftEvent",
  review_requested: "ReviewRequestedEvent",
  review_request_removed: "ReviewRequestRemovedEvent",
  review_dismissed: "ReviewDismissedEvent",
  locked: "LockedEvent",
  unlocked: "UnlockedEvent",
  pinned: "PinnedEvent",
  unpinned: "UnpinnedEvent",
  transferred: "TransferredEvent",
  moved_columns_in_project: "MovedColumnsInProjectEvent",
  added_to_project: "AddedToProjectEvent",
  removed_from_project: "RemovedFromProjectEvent",
  auto_merge_enabled: "AutoMergeEnabledEvent",
  auto_merge_disabled: "AutoMergeDisabledEvent",
  auto_rebase_enabled: "AutoRebaseEnabledEvent",
  auto_squash_enabled: "AutoSquashEnabledEvent",
};

function mapEventType(ev: string): string {
  return EVENT_TYPE_MAP[ev] ?? ev.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("") + "Event";
}

function prefixReviewBody(state: string, body: string): string {
  let label = "reviewed";
  if (state === "APPROVED") label = "approved these changes";
  else if (state === "CHANGES_REQUESTED") label = "requested changes";
  else if (state === "COMMENTED") label = "left a review comment";
  else if (state === "DISMISSED") label = "had this review dismissed";
  return `<p><em>${label}</em></p>${body}`;
}

export function restActor(raw: unknown): Actor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const login = readString(a, "login");
  if (!login) return null;
  return {
    login,
    avatarUrl: readString(a, "avatar_url") ?? `https://github.com/${login}.png?size=64`,
    isAgent: login.endsWith("[bot]") || a["type"] === "Bot",
  };
}

export function restLabel(raw: unknown): Label | null {
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

export function restMilestone(raw: unknown): Milestone | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const title = readString(m, "title");
  if (!title) return null;
  return {
    title,
    url: relativizeGithubUrl(readString(m, "html_url") ?? readString(m, "url") ?? ""),
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

export function readNestedString(raw: unknown, path: string[]): string | null {
  let cur: unknown = raw;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? (cur as string) : null;
}
