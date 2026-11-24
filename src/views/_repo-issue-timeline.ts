import { octicon } from "@/icons";
import type {
  Actor,
  IssueDetail,
  Label,
  PullDetail,
  ReactionCount,
  ReviewThread,
  TimelineNode,
} from "@/adapters/repo-issue";
import { isApiRateLimited } from "@/adapters/rate-limit";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { renderDiffLines } from "./_diff-table";
import { parsePatch } from "@/util/diff";
import { escapeAttr, escapeText, labelTextColor, safeAttrHref, safeHexColor, sanitizeHtml } from "@/util/html";

export function renderReviewThread(t: ReviewThread, pullPath: string, withContext: boolean): string {
  const context = withContext ? parsePatch(t.diffHunk).at(-1)?.lines.slice(-4) ?? [] : [];
  return `
    <div class="oldgh-review-thread">
      ${withContext ? `
        <div class="oldgh-review-thread__file">
          ${octicon("file", { size: 14 })}<span>${escapeText(t.path)}</span>
          ${t.outdated ? `<span class="oldgh-review-thread__outdated">Outdated</span>` : ""}
        </div>
        ${context.length ? renderDiffLines(context) : ""}` : ""}
      ${t.comments.map((c) => {
        const login = c.author?.login || "ghost";
        return `
          <div class="oldgh-review-thread__comment" id="discussion_r${c.id}">
            <img src="${escapeAttr(c.author?.avatarUrl || `https://github.com/${login}.png?size=40`)}" alt="" width="20" height="20" />
            <div class="oldgh-review-thread__main">
              <div class="oldgh-review-thread__head"><a href="/${escapeAttr(login)}">${escapeText(login)}</a> ${relativeTimeLink(c.createdAt)}</div>
              <div class="markdown-body">${sanitizeHtml(c.bodyHtml)}</div>
            </div>
          </div>`;
      }).join("")}
      <div class="oldgh-review-thread__reply"><a href="${escapeAttr(`${pullPath}#discussion_r${t.id}`)}" data-oldgh-show-native>Reply on GitHub</a></div>
    </div>
  `;
}

export function renderTimelineGroup(v: IssueDetail | PullDetail): string {
  const opener = renderOpenerComment(v);
  const threads = "reviewThreads" in v ? v.reviewThreads : [];
  const pullPath = `/${v.owner}/${v.repo}/pull/${v.number}`;
  const threadsByReview = new Map<number, ReviewThread[]>();
  const orphanThreads: ReviewThread[] = [];
  for (const t of threads) {
    if (t.reviewId == null) {
      orphanThreads.push(t);
      continue;
    }
    const list = threadsByReview.get(t.reviewId) ?? [];
    list.push(t);
    threadsByReview.set(t.reviewId, list);
  }
  const shown = new Set<number>();
  const threadsFor = (node: TimelineNode): string => {
    if (node.reviewId == null || shown.has(node.reviewId)) return "";
    const mine = threadsByReview.get(node.reviewId);
    if (!mine?.length) return "";
    shown.add(node.reviewId);
    return `<div class="oldgh-review-threads">${mine.map((t) => renderReviewThread(t, pullPath, true)).join("")}</div>`;
  };
  const items = v.timeline.map((node) => renderTimelineItem(node) + threadsFor(node)).join("");
  // threads whose parent review fell outside the fetched timeline still belong on the page
  const rest = [...orphanThreads];
  for (const [reviewId, list] of threadsByReview) {
    if (!shown.has(reviewId)) rest.push(...list);
  }
  const tail = rest.length ? `<div class="oldgh-review-threads">${rest.map((t) => renderReviewThread(t, pullPath, true)).join("")}</div>` : "";
  return `<div class="oldgh-issue__timeline">${opener}${items}${tail}</div>`;
}

function renderOpenerComment(v: IssueDetail | PullDetail): string {
  return renderCommentBlock({
    author: v.author,
    bodyHtml: v.bodyHtml,
    createdAt: v.createdAt,
    reactions: v.reactions,
    isOpener: true,
  });
}

function renderTimelineItem(node: TimelineNode): string {
  if (node.kind === "comment") {
    return renderCommentBlock({
      author: node.author,
      bodyHtml: node.bodyHtml,
      createdAt: node.createdAt,
      reactions: node.reactions,
      authorAssociation: node.authorAssociation,
      isOpener: false,
      commentId: node.id,
    });
  }
  return renderEvent(node);
}

type CommentInputs = {
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
  reactions: ReactionCount[];
  authorAssociation?: string | null;
  isOpener: boolean;
  commentId?: string;
};

function renderCommentBlock(c: CommentInputs): string {
  const login = c.author?.login || "ghost";
  const avatar = c.author?.avatarUrl || `https://github.com/${login}.png?size=64`;
  const association = c.authorAssociation && c.authorAssociation !== "NONE" && c.authorAssociation !== "MEMBER"
    ? `<span class="oldgh-issue__association">${escapeText(formatAssociation(c.authorAssociation))}</span>`
    : "";
  const anchor = c.commentId && /^\d+$/.test(c.commentId) ? ` id="issuecomment-${c.commentId}"` : "";
  return `
    <article${anchor} class="oldgh-issue__comment ${c.isOpener ? "oldgh-issue__comment--opener" : ""}">
      <a class="oldgh-issue__avatar" href="/${escapeAttr(login)}" aria-label="View ${escapeAttr(login)}'s profile">
        <img src="${escapeAttr(avatar)}" alt="" width="44" height="44" />
      </a>
      <div class="oldgh-issue__comment-card">
        <header class="oldgh-issue__comment-head">
          <a href="/${escapeAttr(login)}" class="oldgh-issue__comment-author">${escapeText(login)}</a>
          <span class="oldgh-issue__comment-time">commented ${relativeTimeLink(c.createdAt)}</span>
          ${association}
        </header>
        <div class="oldgh-issue__body markdown-body">
          ${sanitizeHtml(c.bodyHtml) || '<p class="oldgh-issue__empty">No description provided.</p>'}
        </div>
        ${renderReactionRow(c.reactions)}
      </div>
    </article>
  `;
}

function renderReactionRow(reactions: ReactionCount[]): string {
  if (!reactions || reactions.length === 0) return "";
  return `
    <div class="oldgh-issue__reactions">
      ${reactions.map((r) => `<span class="oldgh-issue__reaction" title="${escapeAttr(reactionLabel(r.content))}">${reactionEmoji(r.content)} ${r.count}</span>`).join("")}
    </div>
  `;
}

function renderEvent(e: Extract<TimelineNode, { kind: "event" }>): string {
  const actor = e.actor?.login || "someone";
  const when = relativeTimeLink(e.createdAt);
  let icon = "primitive-dot";
  let line = "";

  switch (e.type) {
    case "LabeledEvent":
      icon = "tag";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> added the ${e.label ? renderLabelInline(e.label) : "(unknown)"} label ${when}`;
      break;
    case "UnlabeledEvent":
      icon = "tag";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> removed the ${e.label ? renderLabelInline(e.label) : "(unknown)"} label ${when}`;
      break;
    case "AssignedEvent":
      icon = "person";
      line = e.assignee && e.assignee.login !== actor
        ? `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> assigned <a href="/${escapeAttr(e.assignee.login)}">${escapeText(e.assignee.login)}</a> ${when}`
        : `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> self-assigned this ${when}`;
      break;
    case "UnassignedEvent":
      icon = "person";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> unassigned ${e.assignee ? `<a href="/${escapeAttr(e.assignee.login)}">${escapeText(e.assignee.login)}</a>` : "someone"} ${when}`;
      break;
    case "MilestonedEvent":
      icon = "milestone";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> added this to a milestone ${when}`;
      break;
    case "ClosedEvent":
      icon = "issue-closed";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> closed this ${e.toState && (e.toState || "").toUpperCase() !== "COMPLETED" ? `as ${escapeText(e.toState.toLowerCase().replace(/_/g, " "))}` : ""} ${when}`;
      break;
    case "ReopenedEvent":
      icon = "issue-reopened";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> reopened this ${when}`;
      break;
    case "MergedEvent":
      icon = "git-merge";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> merged commit ${e.commitOid ? `<code>${escapeText(e.commitOid)}</code>` : ""} ${when}`;
      break;
    case "RenamedTitleEvent":
      icon = "pencil";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> changed the title from <strong>${escapeText(e.fromState || "")}</strong> to <strong>${escapeText(e.toState || "")}</strong> ${when}`;
      break;
    case "ReferencedEvent":
    case "CrossReferencedEvent":
      icon = "bookmark";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> referenced this ${e.refUrl ? `in <a href="${safeAttrHref(e.refUrl)}">${escapeText(e.refTitle || e.ref || "another item")}</a>` : ""} ${when}`;
      break;
    case "PullRequestCommit":
    case "Commit":
      icon = "git-commit";
      line = `${e.commitOid ? `<code>${escapeText(e.commitOid)}</code>` : ""} ${e.commitMessageHeadline ? sanitizeHtml(e.commitMessageHeadline) : ""} ${when}`;
      break;
    case "HeadRefForcePushedEvent":
    case "BaseRefForcePushedEvent":
      icon = "repo-force-push";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> force-pushed ${e.fromState ? `from <code>${escapeText(e.fromState)}</code>` : ""} ${e.toState ? `to <code>${escapeText(e.toState)}</code>` : ""} ${when}`;
      break;
    case "HeadRefDeletedEvent":
      icon = "trashcan";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> deleted the branch ${when}`;
      break;
    case "ReadyForReviewEvent":
      icon = "git-pull-request";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> marked this as ready for review ${when}`;
      break;
    case "PullRequestReview": {
      // bodyless reviews arrive here; reviews with a body become comment nodes
      const state = (e.toState || "").toLowerCase();
      if (state === "approved") {
        icon = "check";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> approved these changes ${when}`;
      } else if (state === "changes_requested") {
        icon = "request-changes";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> requested changes ${when}`;
      } else {
        icon = "eye";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> reviewed ${when}`;
      }
      break;
    }
    case "TimelineGap": {
      const hidden = Number(e.toState);
      icon = "unfold";
      line = `${hidden
        ? `${hidden} more ${hidden === 1 ? "item isn't" : "items aren't"} shown here.`
        : `Comments and reviews come from GitHub's API, which didn't answer${isApiRateLimited() ? " because its hourly limit is used up" : ""}. <a href="#" data-oldgh-open-options>Add a token</a> or`} <a href="#" data-oldgh-show-native>${hidden ? "Show the full timeline on GitHub" : "show them on GitHub"}</a>.`;
      break;
    }
    case "SubscribedEvent":
    case "UnsubscribedEvent":
    case "MentionedEvent":
      return "";
    default:
      icon = "primitive-dot";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> ${escapeText(humanizeEventType(e.type))} ${when}`;
  }

  return `
    <div class="oldgh-issue__event">
      <span class="oldgh-issue__event-icon">${octicon(icon, { size: 14 })}</span>
      <span class="oldgh-issue__event-line">${line}</span>
    </div>
  `;
}

export function renderSidebar(v: IssueDetail | PullDetail): string {
  return `
    ${renderSidebarSection("Assignees", v.assignees.length === 0 ? `<p class="oldgh-issue__sidebar-empty">No one assigned</p>` : `
      <ul class="oldgh-issue__assignees">
        ${v.assignees.map((a) => `
          <li>
            <a href="/${escapeAttr(a.login)}">
              <img src="${escapeAttr(a.avatarUrl)}" width="20" height="20" alt="" />
              ${escapeText(a.login)}
            </a>
          </li>`).join("")}
      </ul>
    `)}

    ${renderSidebarSection("Labels", v.labels.length === 0 ? `<p class="oldgh-issue__sidebar-empty">None yet</p>` : `
      <ul class="oldgh-issue__labels">
        ${v.labels.map((l) => `<li>${renderLabelInline(l)}</li>`).join("")}
      </ul>
    `)}

    ${renderSidebarSection("Milestone", v.milestone ? `
      <a href="${safeAttrHref(v.milestone.url)}">${escapeText(v.milestone.title)}</a>
    ` : `<p class="oldgh-issue__sidebar-empty">No milestone</p>`)}
  `;
}

function renderSidebarSection(title: string, body: string): string {
  return `
    <div class="oldgh-issue__sidebar-section">
      <h3>${escapeText(title)}</h3>
      ${body}
    </div>
  `;
}

function renderLabelInline(l: Label): string {
  const bg = safeHexColor(l.color) ?? "#cccccc";
  return `<span class="oldgh-issue__label" style="background:${escapeAttr(bg)};color:${labelTextColor(bg)};" title="${escapeAttr(l.description || "")}">${escapeText(emojify(l.name))}</span>`;
}

export function relativeTimeLink(iso: string): string {
  if (!iso) return "";
  const rel = relativeTime(iso);
  const abs = absoluteTime(iso);
  return `<span title="${escapeAttr(abs)}">${escapeText(rel)}</span>`;
}

function reactionEmoji(content: string): string {
  switch (content) {
    case "THUMBS_UP": return "\u{1F44D}";
    case "THUMBS_DOWN": return "\u{1F44E}";
    case "LAUGH": return "\u{1F604}";
    case "HOORAY": return "\u{1F389}";
    case "CONFUSED": return "\u{1F615}";
    case "HEART": return "❤️";
    case "ROCKET": return "\u{1F680}";
    case "EYES": return "\u{1F440}";
    default: return "";
  }
}

function reactionLabel(content: string): string {
  return content.toLowerCase().replace(/_/g, " ");
}

function formatAssociation(a: string): string {
  switch (a) {
    case "OWNER": return "Owner";
    case "COLLABORATOR": return "Collaborator";
    case "MEMBER": return "Member";
    case "CONTRIBUTOR": return "Contributor";
    case "FIRST_TIME_CONTRIBUTOR": return "First-time contributor";
    case "FIRST_TIMER": return "First-timer";
    default: return a.toLowerCase();
  }
}

function humanizeEventType(t: string): string {
  return t
    .replace(/Event$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
