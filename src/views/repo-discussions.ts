import { octicon } from "@/icons";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";
import { absoluteTime, relativeTime } from "@/util/time";

const ROOT_CLASS = "oldgh-repo-discussions";

type DiscussionItem = {
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string | null } | null;
  category: { name: string; emoji: string | null; color: string | null } | null;
  state: "open" | "answered" | "closed";
  commentCount: number;
  isPinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type Category = {
  name: string;
  slug: string;
  emoji: string | null;
  description: string | null;
  count: number;
};

type DiscussionsView = {
  owner: string;
  repo: string;
  items: DiscussionItem[];
  categories: Category[];
  totalOpen: number;
  query: string;
};

export async function mountRepoDiscussions(owner: string, repo: string, subPath: string, query: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(owner, repo);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-discussions__main");
  if (!main) return;

  try {
    const view = await scrapeDiscussions(owner, repo, subPath, query);
    main.innerHTML = renderBody(view);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-discussions__empty">Couldn't load discussions: ${escapeText(msg)}</div>`;
  }
}

export function unmountRepoDiscussions(): void {
  removeAllBodyRoots();
}

async function scrapeDiscussions(owner: string, repo: string, subPath: string, query: string): Promise<DiscussionsView> {
  const url = `https://github.com/${owner}/${repo}${subPath.startsWith("/") ? "" : "/"}${subPath}${query ? `?${query}` : ""}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) throw new Error(`responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const items: DiscussionItem[] = [];
  const seen = new Set<number>();
  // Discussion rows have anchors to /owner/repo/discussions/N
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = new RegExp(`^/${owner}/${repo}/discussions/(\\d+)$`).exec(href);
    if (!m) continue;
    const num = parseInt(m[1]!, 10);
    if (seen.has(num)) continue;
    const row = a.closest("li, .Box-row, article, [data-listing-row]") || a.parentElement;
    if (!row) continue;
    // Title — usually inside the anchor or nearby h3
    const title = (a.textContent || "").trim();
    if (!title || title.length > 300) continue;

    const avatarImg = row.querySelector<HTMLImageElement>("img.avatar, img.avatar-user, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || null;
    const authorAnchor = row.querySelector<HTMLAnchorElement>("a[data-hovercard-type='user']");
    const author = authorAnchor
      ? { login: authorAnchor.textContent?.trim() || (authorAnchor.getAttribute("href") || "").replace(/^\/+/, ""), avatarUrl }
      : null;
    const categoryEl = row.querySelector<HTMLElement>("[data-test-selector='discussion-category-tag'], .DiscussionCategoryAvatar, [class*='discussion-category']");
    const category = categoryEl
      ? {
          name: (categoryEl.textContent?.trim() || "General").replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+\s*/u, "").trim() || "General",
          emoji: extractEmoji(categoryEl),
          color: null,
        }
      : null;
    const stateEl = row.querySelector<HTMLElement>("[data-state], .State");
    const stateText = stateEl?.textContent?.trim().toLowerCase() || "";
    const isAnswered = !!row.querySelector("[aria-label*='Answered'], svg.octicon-check-circle-fill");
    const state: DiscussionItem["state"] = isAnswered
      ? "answered"
      : stateText.includes("closed")
        ? "closed"
        : "open";
    const commentCountText = row.querySelector<HTMLElement>("[aria-label*='comment'], .Counter")?.textContent || "";
    const commentCount = parseInt(commentCountText.replace(/\D/g, ""), 10) || 0;
    const isPinned = !!row.querySelector("svg.octicon-pin, [aria-label*='Pinned']");
    const timeEl = row.querySelector<HTMLTimeElement>("relative-time, time");
    const updatedAt = timeEl?.getAttribute("datetime") || null;

    seen.add(num);
    items.push({
      number: num,
      title,
      url: href,
      author,
      category,
      state,
      commentCount,
      isPinned,
      createdAt: null,
      updatedAt,
    });
  }

  // Categories — sidebar links to /owner/repo/discussions/categories/X
  const categories: Category[] = [];
  const seenCat = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const cm = new RegExp(`^/${owner}/${repo}/discussions/categories/([\\w.-]+)`).exec(href);
    if (!cm) continue;
    const slug = cm[1]!;
    if (seenCat.has(slug)) continue;
    seenCat.add(slug);
    const name = a.textContent?.trim() || slug;
    if (!name || name.length > 64) continue;
    categories.push({
      name: name.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+\s*/u, ""),
      slug,
      emoji: extractEmoji(a),
      description: null,
      count: 0,
    });
  }

  // Total open from the discussions header tab
  let totalOpen = items.length;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("a[href*='discussions']"))) {
    const txt = el.textContent?.replace(/\s+/g, " ").trim() || "";
    const m = /\b([\d,]+)\b.*open/i.exec(txt);
    if (m) {
      totalOpen = parseInt(m[1]!.replace(/,/g, ""), 10) || totalOpen;
      break;
    }
  }

  return { owner, repo, items, categories, totalOpen, query };
}

function extractEmoji(el: Element | null): string | null {
  if (!el) return null;
  const text = el.textContent || "";
  const m = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2700}-\u{27BF}]/u.exec(text);
  return m?.[0] ?? null;
}

function renderShell(owner: string, repo: string): string {
  return `
    <div class="oldgh-page oldgh-discussions">
      <header class="oldgh-discussions__header">
        <h1>${octicon("comment-discussion", { size: 22 })} Discussions</h1>
        <p class="oldgh-discussions__sub">Threaded conversations about <strong>${escapeText(owner)}/${escapeText(repo)}</strong> — questions, ideas, and announcements.</p>
      </header>
      <div class="oldgh-discussions__main">
        <div class="oldgh-discussions__loading">Loading discussions&hellip;</div>
      </div>
    </div>
  `;
}

function renderBody(v: DiscussionsView): string {
  if (v.items.length === 0 && v.categories.length === 0) {
    return `
      <div class="oldgh-discussions__empty">
        ${octicon("comment-discussion", { size: 48 })}
        <h2>No discussions yet.</h2>
        <p>Discussions are a place for community-led conversations: questions, ideas, polls, show-and-tell. Maintainers usually enable them when they want a hub outside of issues.</p>
        <p class="oldgh-discussions__cta">
          <a class="oldgh-btn oldgh-btn--primary" href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/discussions/new/choose">${octicon("plus", { size: 14 })}<span>Start a discussion</span></a>
        </p>
      </div>
    `;
  }
  return `
    <div class="oldgh-discussions__layout">
      <aside class="oldgh-discussions__sidebar">
        ${renderCategories(v)}
      </aside>
      <main class="oldgh-discussions__feed">
        ${renderToolbar(v)}
        ${v.items.length === 0
          ? `<div class="oldgh-discussions__empty-small"><p>No discussions match the current filter.</p></div>`
          : `<ul class="oldgh-discussions__list">${v.items.map(renderItem).join("")}</ul>`}
      </main>
    </div>
  `;
}

function renderToolbar(v: DiscussionsView): string {
  return `
    <div class="oldgh-discussions__toolbar">
      <span><strong>${v.items.length}</strong> showing${v.totalOpen ? ` · <strong>${v.totalOpen}</strong> open` : ""}</span>
      <a class="oldgh-btn oldgh-btn--primary" href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/discussions/new/choose">${octicon("plus", { size: 12 })}<span>New discussion</span></a>
    </div>
  `;
}

function renderCategories(v: DiscussionsView): string {
  if (v.categories.length === 0) return "";
  return `
    <div class="oldgh-discussions__sidebox">
      <h3>${octicon("list-unordered", { size: 12 })} Categories</h3>
      <ul>
        <li><a href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/discussions">${octicon("comment-discussion", { size: 12 })} All discussions</a></li>
        ${v.categories.map((c) => `
          <li>
            <a href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/discussions/categories/${escapeAttr(c.slug)}">
              ${c.emoji ? `<span class="oldgh-discussions__cat-emoji">${escapeText(c.emoji)}</span>` : octicon("comment", { size: 12 })}
              ${escapeText(c.name)}
            </a>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderItem(d: DiscussionItem): string {
  const stateIcon =
    d.state === "answered"
      ? `<span class="oldgh-discussions__state oldgh-discussions__state--answered" title="Answered">${octicon("check", { size: 14 })}</span>`
      : d.state === "closed"
        ? `<span class="oldgh-discussions__state oldgh-discussions__state--closed" title="Closed">${octicon("circle-slash", { size: 14 })}</span>`
        : `<span class="oldgh-discussions__state oldgh-discussions__state--open" title="Open">${octicon("comment-discussion", { size: 14 })}</span>`;
  return `
    <li class="oldgh-discussions__item">
      ${stateIcon}
      <div class="oldgh-discussions__item-main">
        <h3 class="oldgh-discussions__item-title">
          ${d.isPinned ? `<span class="oldgh-discussions__pin" title="Pinned">${octicon("pin", { size: 12 })}</span>` : ""}
          <a href="${escapeAttr(d.url)}">${escapeText(d.title)}</a>
          <span class="oldgh-discussions__item-num">#${d.number}</span>
        </h3>
        <div class="oldgh-discussions__item-meta">
          ${d.category ? `<span class="oldgh-discussions__cat-chip">${d.category.emoji ? escapeText(d.category.emoji) + " " : ""}${escapeText(d.category.name)}</span>` : ""}
          ${d.author ? `<span>by <a href="/${escapeAttr(d.author.login)}">${escapeText(d.author.login)}</a></span>` : ""}
          ${d.updatedAt ? `<span>updated <time datetime="${escapeAttr(d.updatedAt)}" title="${escapeAttr(absoluteTime(d.updatedAt))}">${escapeText(relativeTime(d.updatedAt))}</time></span>` : ""}
        </div>
      </div>
      ${d.commentCount > 0
        ? `<span class="oldgh-discussions__comments" title="${d.commentCount} comment${d.commentCount === 1 ? "" : "s"}">${octicon("comment", { size: 14 })} ${d.commentCount}</span>`
        : ""}
    </li>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
