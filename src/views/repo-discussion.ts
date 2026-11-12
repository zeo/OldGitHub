import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchApi } from "@/adapters/rate-limit";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, navigationToken } from "./_body";
import { cleanScrapedPage, escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-discussion";

type Reaction = { content: string; count: number };

type DiscussionActor = {
  login: string;
  avatarUrl: string;
};

type DiscussionDetail = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  bodyHtml: string;
  state: "open" | "closed";
  stateReason: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  author: DiscussionActor | null;
  createdAt: string;
  commentsCount: number;
  isAnswered: boolean;
  answerHtmlUrl: string | null;
  answerChosenBy: string | null;
  htmlUrl: string;
  reactions: Reaction[];
  labels: Array<{ name: string; color: string }>;
};

type DiscussionComment = {
  id: number;
  parentId: number | null;
  author: DiscussionActor | null;
  authorAssociation: string | null;
  bodyHtml: string;
  createdAt: string;
  htmlUrl: string;
  reactions: Reaction[];
  childCount: number;
};

export async function mountRepoDiscussion(owner: string, repo: string, number: number): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(number);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  try {
    const [detail, comments] = await Promise.all([
      fetchDiscussion(owner, repo, number),
      fetchComments(owner, repo, number),
    ]);
    root.innerHTML = renderBody(detail, comments);
  } catch (err) {
    // anonymous REST returns 404 for private/access-gated discussions and 403
    // when rate-limited; fall back to the cookie-authed HTML page scrape
    const scraped = await fetchScrapedDiscussion(owner, repo, number);
    if (scraped) {
      root.innerHTML = scraped;
      return;
    }
    const main = root.querySelector(".oldgh-discussion__main");
    if (main) {
      main.innerHTML = `<p class="oldgh-discussion__empty">Couldn't load discussion: ${escapeText(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }
}

async function fetchScrapedDiscussion(owner: string, repo: string, number: number): Promise<string | null> {
  try {
    const resp = await fetch(`https://github.com/${owner}/${repo}/discussions/${number}`, {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const inner =
      doc.querySelector("turbo-frame#repo-content-turbo-frame") ||
      doc.querySelector("[data-pjax-container]") ||
      doc.querySelector(".application-main") ||
      doc.querySelector("main");
    if (!inner) return null;
    cleanScrapedPage(inner, ["[class*='PageLayout-Header-']", "[class*='PageHeader-']", ".tabnav", ".UnderlineNav"]);
    const title = (doc.querySelector("title")?.textContent || "").trim();
    return `
      <div class="oldgh-page oldgh-discussion">
        ${title ? `<header class="oldgh-discussion__header"><h1 class="oldgh-discussion__title">${escapeText(title)} <span class="oldgh-discussion__number">#${number}</span></h1></header>` : ""}
        <div class="oldgh-discussion__main">${inner.innerHTML}</div>
      </div>
    `;
  } catch {
    return null;
  }
}

async function fetchDiscussion(owner: string, repo: string, number: number): Promise<DiscussionDetail> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/discussions/${number}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github.html+json" },
  });
  if (!resp.ok) throw new AdapterFailure("getDiscussion", `responded ${resp.status}`);
  const d = (await resp.json()) as Record<string, unknown>;
  return parseDiscussion(owner, repo, number, d);
}

async function fetchComments(owner: string, repo: string, number: number): Promise<DiscussionComment[]> {
  const out: DiscussionComment[] = [];
  let url: string | null = `https://api.github.com/repos/${owner}/${repo}/discussions/${number}/comments?per_page=100`;
  let attempts = 0;
  while (url && attempts < 5) {
    attempts++;
    const resp = await fetchApi(url, { credentials: "omit", headers: { Accept: "application/vnd.github.html+json" } });
    if (!resp.ok) break;
    const arr = (await resp.json()) as unknown;
    if (!Array.isArray(arr)) break;
    for (const raw of arr) {
      const parsed = parseComment(raw);
      if (parsed) out.push(parsed);
    }
    const link = resp.headers.get("link") || "";
    const m = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = m && m[1] ? m[1] : null;
  }
  return out;
}

function parseDiscussion(owner: string, repo: string, number: number, d: Record<string, unknown>): DiscussionDetail {
  const user = readObj(d["user"]);
  const chosenBy = readObj(d["answer_chosen_by"]);
  const category = readObj(d["category"]);
  const labelsRaw = Array.isArray(d["labels"]) ? d["labels"] : [];
  return {
    owner,
    repo,
    number,
    title: readString(d, "title") ?? "",
    bodyHtml: readString(d, "body_html") ?? "",
    state: readString(d, "state") === "closed" ? "closed" : "open",
    stateReason: readString(d, "state_reason"),
    categoryName: category ? readString(category, "name") : null,
    categoryEmoji: category ? readString(category, "emoji") : null,
    author: user ? { login: readString(user, "login") ?? "", avatarUrl: readString(user, "avatar_url") ?? "" } : null,
    createdAt: readString(d, "created_at") ?? "",
    commentsCount: readNumber(d, "comments") ?? 0,
    isAnswered: readString(d, "answer_chosen_at") !== null,
    answerHtmlUrl: readString(d, "answer_html_url"),
    answerChosenBy: chosenBy ? readString(chosenBy, "login") : null,
    htmlUrl: readString(d, "html_url") ?? `https://github.com/${owner}/${repo}/discussions/${number}`,
    reactions: parseReactions(d["reactions"]),
    labels: labelsRaw
      .map((l) => {
        if (!l || typeof l !== "object") return null;
        const o = l as Record<string, unknown>;
        const n = readString(o, "name");
        if (!n) return null;
        return { name: n, color: (readString(o, "color") ?? "ccc").replace(/^#/, "") };
      })
      .filter((x): x is { name: string; color: string } => x !== null),
  };
}

function parseComment(raw: unknown): DiscussionComment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = readNumber(r, "id");
  if (id == null) return null;
  const user = readObj(r["user"]);
  return {
    id,
    parentId: readNumber(r, "parent_id"),
    author: user ? { login: readString(user, "login") ?? "", avatarUrl: readString(user, "avatar_url") ?? "" } : null,
    authorAssociation: readString(r, "author_association"),
    bodyHtml: readString(r, "body_html") ?? "",
    createdAt: readString(r, "created_at") ?? "",
    htmlUrl: readString(r, "html_url") ?? "",
    reactions: parseReactions(r["reactions"]),
    childCount: readNumber(r, "child_comment_count") ?? 0,
  };
}

function parseReactions(raw: unknown): Reaction[] {
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
  const out: Reaction[] = [];
  for (const [k, c] of map) {
    const v = r[k];
    if (typeof v === "number" && v > 0) out.push({ content: c, count: v });
  }
  return out;
}

function renderShell(number: number): string {
  return `
    <div class="oldgh-page oldgh-discussion">
      <div class="oldgh-discussion__main"><p class="oldgh-discussion__loading">Loading discussion #${number}…</p></div>
    </div>
  `;
}

function renderBody(d: DiscussionDetail, comments: DiscussionComment[]): string {
  const stateBadge = renderStateBadge(d);
  const opener = renderOpener(d);
  const answerComment = findAnswerComment(d, comments);
  // the answer renders in its own card, so drop it from the flat list to avoid showing it twice
  const listed = answerComment ? comments.filter((c) => c.id !== answerComment.id) : comments;
  const topLevel = listed.filter((c) => c.parentId == null);
  const replies = listed.filter((c) => c.parentId != null);
  const repliesByParent = new Map<number, DiscussionComment[]>();
  for (const r of replies) {
    if (r.parentId == null) continue;
    const list = repliesByParent.get(r.parentId) ?? [];
    list.push(r);
    repliesByParent.set(r.parentId, list);
  }
  return `
    <div class="oldgh-page oldgh-discussion">
      <header class="oldgh-discussion__header">
        <h1 class="oldgh-discussion__title">
          ${escapeText(d.title)}
          <span class="oldgh-discussion__number">#${d.number}</span>
        </h1>
        <div class="oldgh-discussion__meta">
          ${stateBadge}
          ${d.categoryName ? `<span class="oldgh-discussion__category">${renderCategoryIcon(d.categoryEmoji)}<span>${escapeText(d.categoryName)}</span></span>` : ""}
          <span class="oldgh-discussion__byline">
            ${d.author ? `<a href="/${escapeAttr(d.author.login)}">${escapeText(d.author.login)}</a>` : "ghost"}
            asked ${relativeTimeLink(d.createdAt)}
            · ${d.commentsCount} ${d.commentsCount === 1 ? "comment" : "comments"}
          </span>
        </div>
        ${d.labels.length > 0 ? `<div class="oldgh-discussion__labels">${d.labels.map((l) => `<span class="oldgh-issue__label" style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)};">${escapeText(emojify(l.name))}</span>`).join(" ")}</div>` : ""}
      </header>

      <div class="oldgh-discussion__main">
        ${opener}
        ${answerComment ? renderAnswer(answerComment, d.answerChosenBy) : ""}
        ${topLevel.length === 0 ? `<p class="oldgh-discussion__empty">No comments yet.</p>` : `
          <h2 class="oldgh-discussion__section">${topLevel.length} top-level ${topLevel.length === 1 ? "comment" : "comments"}</h2>
          <div class="oldgh-discussion__comments">
            ${topLevel.map((c) => renderComment(c, repliesByParent.get(c.id) ?? [])).join("")}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderCategoryIcon(emoji: string | null): string {
  if (emoji) {
    const resolved = emojify(emoji);
    // emojify returns the unresolved :shortcode: token for emoji it doesn't
    // cover (loudspeaker, ballot_box, new); fall back to the octicon then
    if (!/^:[a-z0-9_+-]+:$/i.test(resolved)) {
      return `<span class="oldgh-discussion__category-emoji">${escapeText(resolved)}</span>`;
    }
  }
  return octicon("comment-discussion", { size: 14 });
}

function findAnswerComment(d: DiscussionDetail, comments: DiscussionComment[]): DiscussionComment | null {
  if (!d.answerHtmlUrl) return null;
  // answer_html_url ends with #discussioncomment-<id> matching a comment's id/htmlUrl
  const m = /#discussioncomment-(\d+)/.exec(d.answerHtmlUrl);
  const answerId = m && m[1] ? Number(m[1]) : null;
  return (
    comments.find((c) => (answerId != null && c.id === answerId) || c.htmlUrl === d.answerHtmlUrl) ?? null
  );
}

function renderStateBadge(d: DiscussionDetail): string {
  if (d.isAnswered) {
    return `<span class="oldgh-discussion__state oldgh-discussion__state--answered">${octicon("check", { size: 14 })}<span>Answered</span></span>`;
  }
  if (d.state === "closed") {
    return `<span class="oldgh-discussion__state oldgh-discussion__state--closed">${octicon("check", { size: 14 })}<span>Closed</span></span>`;
  }
  return `<span class="oldgh-discussion__state oldgh-discussion__state--open">${octicon("comment-discussion", { size: 14 })}<span>Open</span></span>`;
}

function renderOpener(d: DiscussionDetail): string {
  return renderCommentBlock({
    avatar: d.author?.avatarUrl || (d.author ? `https://github.com/${d.author.login}.png?size=64` : ""),
    login: d.author?.login || "ghost",
    createdAt: d.createdAt,
    bodyHtml: d.bodyHtml,
    reactions: d.reactions,
    authorAssociation: null,
    cls: "oldgh-discussion__opener",
  });
}

function renderAnswer(c: DiscussionComment, chosenBy: string | null): string {
  const markedBy = chosenBy
    ? `marked by <a href="/${escapeAttr(chosenBy)}">${escapeText(chosenBy)}</a>`
    : "marked as answer";
  return `
    <div class="oldgh-discussion__answer-card">
      <header class="oldgh-discussion__answer-head">${octicon("check", { size: 14 })} <strong>Answer</strong> · ${markedBy}</header>
      ${renderCommentBlock({
        avatar: c.author?.avatarUrl || (c.author ? `https://github.com/${c.author.login}.png?size=64` : ""),
        login: c.author?.login || "ghost",
        createdAt: c.createdAt,
        bodyHtml: c.bodyHtml,
        reactions: c.reactions,
        authorAssociation: c.authorAssociation,
        cls: "oldgh-discussion__answer",
      })}
    </div>
  `;
}

function renderComment(c: DiscussionComment, replies: DiscussionComment[]): string {
  return `
    <div class="oldgh-discussion__comment-group">
      ${renderCommentBlock({
        avatar: c.author?.avatarUrl || (c.author ? `https://github.com/${c.author.login}.png?size=64` : ""),
        login: c.author?.login || "ghost",
        createdAt: c.createdAt,
        bodyHtml: c.bodyHtml,
        reactions: c.reactions,
        authorAssociation: c.authorAssociation,
        cls: "",
      })}
      ${replies.length > 0 ? `<div class="oldgh-discussion__replies">${replies.map((r) => renderCommentBlock({
        avatar: r.author?.avatarUrl || (r.author ? `https://github.com/${r.author.login}.png?size=64` : ""),
        login: r.author?.login || "ghost",
        createdAt: r.createdAt,
        bodyHtml: r.bodyHtml,
        reactions: r.reactions,
        authorAssociation: r.authorAssociation,
        cls: "oldgh-discussion__reply",
      })).join("")}</div>` : ""}
      ${renderMoreReplies(c, replies.length)}
    </div>
  `;
}

function renderMoreReplies(c: DiscussionComment, rendered: number): string {
  // child_comment_count is the true reply total; nested replies aren't inlined
  // here, so link out for any that weren't rendered instead of dropping them
  const missing = c.childCount - rendered;
  if (missing <= 0 || !c.htmlUrl) return "";
  return `<a class="oldgh-discussion__more-replies" href="${escapeAttr(c.htmlUrl)}">${octicon("reply", { size: 14 })} ${missing} more ${missing === 1 ? "reply" : "replies"}</a>`;
}

type CommentBlockArgs = {
  avatar: string;
  login: string;
  createdAt: string;
  bodyHtml: string;
  reactions: Reaction[];
  authorAssociation: string | null;
  cls: string;
};

function renderCommentBlock(c: CommentBlockArgs): string {
  const association = c.authorAssociation && c.authorAssociation !== "NONE" && c.authorAssociation !== "MEMBER"
    ? `<span class="oldgh-issue__association">${escapeText(formatAssociation(c.authorAssociation))}</span>`
    : "";
  return `
    <article class="oldgh-issue__comment ${c.cls}">
      <a class="oldgh-issue__avatar" href="/${escapeAttr(c.login)}" aria-label="View ${escapeAttr(c.login)}'s profile">
        <img src="${escapeAttr(c.avatar)}" alt="" width="44" height="44" />
      </a>
      <div class="oldgh-issue__comment-card">
        <header class="oldgh-issue__comment-head">
          <a href="/${escapeAttr(c.login)}" class="oldgh-issue__comment-author">${escapeText(c.login)}</a>
          <span class="oldgh-issue__comment-time">commented ${relativeTimeLink(c.createdAt)}</span>
          ${association}
        </header>
        <div class="oldgh-issue__body markdown-body">
          ${sanitizeHtml(c.bodyHtml) || `<p class="oldgh-issue__empty">No description provided.</p>`}
        </div>
        ${renderReactionRow(c.reactions)}
      </div>
    </article>
  `;
}

function renderReactionRow(reactions: Reaction[]): string {
  if (reactions.length === 0) return "";
  return `
    <div class="oldgh-issue__reactions">
      ${reactions.map((r) => `<span class="oldgh-issue__reaction" title="${escapeAttr(r.content.toLowerCase().replace(/_/g, " "))}">${reactionEmoji(r.content)} ${r.count}</span>`).join("")}
    </div>
  `;
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

function labelTextColor(hex: string): string {
  const m = /^([\da-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#333" : "#fff";
}

function relativeTimeLink(iso: string): string {
  if (!iso) return "";
  return `<span title="${escapeAttr(absoluteTime(iso))}">${escapeText(relativeTime(iso))}</span>`;
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}
function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}
