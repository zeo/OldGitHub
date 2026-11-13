import { octicon } from "@/icons";
import { fetchPageDoc } from "@/adapters/_page";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-discussion";
const COMMENT = ".discussions-timeline-scroll-target[id^='discussioncomment-']";

type Reaction = { content: string; count: number };

type DiscussionComment = {
  id: number;
  login: string;
  avatarUrl: string;
  bodyHtml: string;
  createdAt: string;
  upvotes: number | null;
  reactions: Reaction[];
};

type Replies = { items: DiscussionComment[]; earlier: { url: string; label: string } | null };

type TimelineEntry =
  | { kind: "comment"; comment: DiscussionComment; replies: Replies }
  | { kind: "more"; url: string; label: string };

type DiscussionDetail = {
  number: number;
  title: string;
  opener: DiscussionComment;
  asked: boolean;
  state: "open" | "closed";
  isAnswered: boolean;
  answerId: number | null;
  answerChosenBy: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  countLine: string;
  labels: Array<{ name: string; color: string | null }>;
  timeline: TimelineEntry[];
};

export async function mountRepoDiscussion(owner: string, repo: string, number: number): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(number);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  let detail: DiscussionDetail;
  try {
    detail = parseDiscussion(await fetchPageDoc(`https://github.com/${owner}/${repo}/discussions/${number}`), number);
  } catch (err) {
    const main = root.querySelector(".oldgh-discussion__main");
    if (main) {
      main.innerHTML = `<p class="oldgh-discussion__empty">Couldn't load discussion: ${escapeText(err instanceof Error ? err.message : String(err))}</p>`;
    }
    return;
  }
  root.innerHTML = renderBody(detail);
  bindLoadMore(root, detail);
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseDiscussion(doc: Document, number: number): DiscussionDetail {
  const header = doc.querySelector(".gh-header-show");
  const title = text(header?.querySelector(".js-issue-title"));
  const openerEl = doc.querySelector(".TimelineItem[data-url$='/body'] .timeline-comment");
  if (!header || !title || !openerEl) throw new Error("the discussion page has no discussion in it");

  const stateText = text(header.querySelector(".State"));
  const answerHref = doc.querySelector("a.js-discussions-goto-answer-button[href*='#discussioncomment-']")?.getAttribute("href") ?? "";
  const answerId = Number(/#discussioncomment-(\d+)/.exec(answerHref)?.[1]) || null;
  const chosenBy = Array.from(doc.querySelectorAll("span"))
    .find((s) => text(s) === "Answer selected by")
    ?.parentElement?.querySelector("a[href^='/']");
  const categoryName = text(header.querySelector("a[href*='/discussions/categories/']")) || null;
  const sidebarCategory = text(doc.querySelector(".discussion-sidebar-item a[href*='/discussions/categories/']"));
  const categoryEmoji = categoryName && sidebarCategory.endsWith(categoryName) ? sidebarCategory.slice(0, -categoryName.length).trim() || null : null;

  return {
    number,
    title,
    opener: parseComment(openerEl, 0),
    asked: /\basked\b/.test(text(header)),
    state: stateText.startsWith("Closed") ? "closed" : "open",
    isAnswered: answerId != null || stateText.startsWith("Answered"),
    answerId,
    answerChosenBy: chosenBy ? loginOf(chosenBy) : null,
    categoryName,
    categoryEmoji,
    countLine: text(doc.querySelector("#discussion-comment-count")).replace(/^Replies:\s*/, ""),
    labels: Array.from(doc.querySelectorAll(".discussion-sidebar-item .IssueLabel"), (l) => ({ name: text(l), color: labelColor(l.getAttribute("style") ?? "") })),
    timeline: parseTimeline(doc),
  };
}

// a pages fragment carries the next hidden range as its own load-more form
function parseTimeline(doc: Document): TimelineEntry[] {
  const seen = new Set<number>();
  const out: TimelineEntry[] = [];
  for (const el of doc.querySelectorAll(`${COMMENT}, form[action*='/pages?']`)) {
    if (el.tagName === "FORM") {
      out.push({ kind: "more", url: el.getAttribute("action")!, label: text(el) || "Load more…" });
      continue;
    }
    if (el.closest("[id^='child-comments-']")) continue;
    const id = idOf(el);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: "comment", comment: parseComment(el, id), replies: parseReplies(doc.getElementById(`child-comments-${el.id}`)) });
  }
  return out;
}

function parseReplies(box: Element | null): Replies {
  if (!box) return { items: [], earlier: null };
  const form = box.querySelector("form[action$='/threads']");
  const params = new URLSearchParams(Array.from(form?.querySelectorAll("input[name]") ?? [], (i) => [i.getAttribute("name")!, i.getAttribute("value") ?? ""]));
  return {
    items: Array.from(box.querySelectorAll(COMMENT), (el) => parseComment(el, idOf(el))),
    earlier: form ? { url: `${form.getAttribute("action")}?${params}`, label: text(form) || "Show previous replies" } : null,
  };
}

function parseComment(el: Element, id: number): DiscussionComment {
  const card = el.matches(".timeline-comment") ? el : el.querySelector(".timeline-comment") ?? el;
  const authorLink = card.querySelector(".timeline-comment-header-text a[href^='/'], a.author[href^='/']");
  const login = authorLink ? loginOf(authorLink) : "ghost";
  const avatar = card.querySelector(".timeline-comment-header-text img")?.getAttribute("src")
    ?? el.closest(".TimelineItem")?.querySelector(":scope > .TimelineItem-avatar img")?.getAttribute("src");
  const reactions = Array.from(card.querySelector(".js-comment-reactions-options")?.querySelectorAll("button[value]") ?? []).flatMap((b) => {
    const count = Number(/(\d[\d,]*)\s*$/.exec(text(b))?.[1]?.replace(/,/g, ""));
    return count ? [{ content: b.getAttribute("value")!.split(" ")[0]!, count }] : [];
  });
  const upvotes = /(\d+)/.exec(card.querySelector(".js-upvote-button")?.getAttribute("aria-label") ?? "")?.[1];
  return {
    id,
    login,
    avatarUrl: avatar || `https://github.com/${login}.png?size=64`,
    bodyHtml: card.querySelector(".js-comment-body")?.innerHTML ?? "",
    createdAt: card.querySelector("relative-time")?.getAttribute("datetime") ?? "",
    upvotes: upvotes ? Number(upvotes) : null,
    reactions,
  };
}

function idOf(el: Element): number {
  return Number(el.id.replace("discussioncomment-", ""));
}

function loginOf(a: Element): string {
  return a.getAttribute("href")!.split("/").filter(Boolean).pop() ?? "ghost";
}

function labelColor(style: string): string | null {
  const hex = /#([\da-f]{6})\b/i.exec(style)?.[1];
  if (hex) return hex;
  const rgb = /--label-r:\s*(\d+);\s*--label-g:\s*(\d+);\s*--label-b:\s*(\d+)/.exec(style);
  return rgb ? rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("") : null;
}

function bindLoadMore(root: HTMLElement, d: DiscussionDetail): void {
  root.addEventListener("click", async (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("button[data-oldgh-more]");
    if (!button || button.disabled) return;
    const slot = button.closest(".oldgh-discussion__more-slot");
    if (!slot) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const doc = await fetchPageDoc(new URL(button.dataset["oldghMore"]!, "https://github.com").href);
      if (slot.classList.contains("oldgh-discussion__replies")) {
        slot.outerHTML = renderReplies(parseReplies(doc.querySelector("[id^='child-comments-']")));
      } else {
        slot.outerHTML = parseTimeline(doc).map((entry) => renderEntry(entry, d)).join("");
      }
    } catch {
      button.disabled = false;
      button.textContent = `${label} (couldn't load, try again)`;
    }
  });
}

function renderShell(number: number): string {
  return `
    <div class="oldgh-page oldgh-discussion">
      <div class="oldgh-discussion__main"><p class="oldgh-discussion__loading">Loading discussion #${number}…</p></div>
    </div>
  `;
}

function renderBody(d: DiscussionDetail): string {
  return `
    <div class="oldgh-page oldgh-discussion">
      <header class="oldgh-discussion__header">
        <h1 class="oldgh-discussion__title">
          ${escapeText(d.title)}
          <span class="oldgh-discussion__number">#${d.number}</span>
        </h1>
        <div class="oldgh-discussion__meta">
          ${renderStateBadge(d)}
          ${d.categoryName ? `<span class="oldgh-discussion__category">${renderCategoryIcon(d.categoryEmoji)}<span>${escapeText(d.categoryName)}</span></span>` : ""}
          <span class="oldgh-discussion__byline">
            <a href="/${escapeAttr(d.opener.login)}">${escapeText(d.opener.login)}</a>
            ${d.asked ? "asked" : "started this conversation"} ${relativeTimeLink(d.opener.createdAt)}
          </span>
        </div>
        ${d.labels.length > 0 ? `<div class="oldgh-discussion__labels">${d.labels.map((l) => `<span class="oldgh-issue__label"${l.color ? ` style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)};"` : ""}>${escapeText(emojify(l.name))}</span>`).join(" ")}</div>` : ""}
      </header>

      <div class="oldgh-discussion__main">
        ${renderCommentBlock(d.opener, "oldgh-discussion__opener")}
        ${d.timeline.length === 0 ? `<p class="oldgh-discussion__empty">No comments yet.</p>` : `
          ${d.countLine ? `<h2 class="oldgh-discussion__section">${escapeText(d.countLine)}</h2>` : ""}
          <div class="oldgh-discussion__comments">
            ${d.timeline.map((entry) => renderEntry(entry, d)).join("")}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderEntry(entry: TimelineEntry, d: DiscussionDetail): string {
  if (entry.kind === "more") {
    return `<div class="oldgh-discussion__more-slot">${moreButton(entry.url, entry.label)}</div>`;
  }
  const group = `
    <div class="oldgh-discussion__comment-group">
      ${renderCommentBlock(entry.comment, "")}
      ${renderReplies(entry.replies)}
    </div>
  `;
  if (entry.comment.id !== d.answerId) return group;
  const markedBy = d.answerChosenBy
    ? `marked by <a href="/${escapeAttr(d.answerChosenBy)}">${escapeText(d.answerChosenBy)}</a>`
    : "marked as answer";
  return `
    <div class="oldgh-discussion__answer-card">
      <header class="oldgh-discussion__answer-head">${octicon("check", { size: 14 })} <strong>Answer</strong> · ${markedBy}</header>
      ${group}
    </div>
  `;
}

function renderReplies(r: Replies): string {
  if (r.items.length === 0 && !r.earlier) return "";
  return `
    <div class="oldgh-discussion__replies oldgh-discussion__more-slot">
      ${r.earlier ? moreButton(r.earlier.url, r.earlier.label) : ""}
      ${r.items.map((c) => renderCommentBlock(c, "oldgh-discussion__reply")).join("")}
    </div>
  `;
}

function moreButton(url: string, label: string): string {
  return `<button type="button" class="oldgh-btn oldgh-discussion__more" data-oldgh-more="${escapeAttr(url)}">${escapeText(label)}</button>`;
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

function renderStateBadge(d: DiscussionDetail): string {
  if (d.isAnswered) {
    return `<span class="oldgh-discussion__state oldgh-discussion__state--answered">${octicon("check", { size: 14 })}<span>Answered</span></span>`;
  }
  if (d.state === "closed") {
    return `<span class="oldgh-discussion__state oldgh-discussion__state--closed">${octicon("check", { size: 14 })}<span>Closed</span></span>`;
  }
  return `<span class="oldgh-discussion__state oldgh-discussion__state--open">${octicon("comment-discussion", { size: 14 })}<span>Open</span></span>`;
}

function renderCommentBlock(c: DiscussionComment, cls: string): string {
  return `
    <article class="oldgh-issue__comment ${cls}"${c.id ? ` id="discussioncomment-${c.id}"` : ""}>
      <a class="oldgh-issue__avatar" href="/${escapeAttr(c.login)}" aria-label="View ${escapeAttr(c.login)}'s profile">
        <img src="${escapeAttr(c.avatarUrl)}" alt="" width="44" height="44" />
      </a>
      <div class="oldgh-issue__comment-card">
        <header class="oldgh-issue__comment-head">
          <a href="/${escapeAttr(c.login)}" class="oldgh-issue__comment-author">${escapeText(c.login)}</a>
          <span class="oldgh-issue__comment-time">commented ${relativeTimeLink(c.createdAt)}</span>
        </header>
        <div class="oldgh-issue__body markdown-body">
          ${sanitizeHtml(c.bodyHtml) || `<p class="oldgh-issue__empty">No description provided.</p>`}
        </div>
        ${renderReactionRow(c)}
      </div>
    </article>
  `;
}

function renderReactionRow(c: DiscussionComment): string {
  if (c.reactions.length === 0 && !c.upvotes) return "";
  return `
    <div class="oldgh-issue__reactions">
      ${c.upvotes ? `<span class="oldgh-issue__reaction" title="upvotes">${octicon("arrow-up", { size: 12 })} ${c.upvotes}</span>` : ""}
      ${c.reactions.map((r) => `<span class="oldgh-issue__reaction" title="${escapeAttr(r.content.toLowerCase().replace(/_/g, " "))}">${reactionEmoji(r.content)} ${r.count}</span>`).join("")}
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
