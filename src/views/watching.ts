import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { absoluteTime, relativeTime } from "@/util/time";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-watching";

type WatchedRepo = {
  fullName: string;
  ownerLogin: string;
  ownerAvatar: string;
  repoName: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  forks: number | null;
  updatedAt: string | null;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  subscriptionType: string | null;
};

export async function mountWatching(_pathname: string, _search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell();
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const slot = root.querySelector<HTMLElement>(".oldgh-watching__list-slot");
  if (!slot) return;

  try {
    const list = await scrapeWatching();
    slot.innerHTML = renderList(list);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slot.innerHTML = `<div class="oldgh-watching__empty">Couldn't load watched repositories: ${escapeText(msg)}</div>`;
  }
}

async function scrapeWatching(): Promise<WatchedRepo[]> {
  const resp = await fetch("https://github.com/watching", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) throw new Error(`responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const out: WatchedRepo[] = [];
  const seen = new Set<string>();
  // /watching renders rows linking to /owner/repo with subscription info
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/([\w.-]+)$/.exec(href);
    if (!m) continue;
    const owner = m[1]!;
    const name = m[2]!;
    if (RESERVED.has(owner)) continue;
    const key = `${owner}/${name}`;
    if (seen.has(key)) continue;
    const row = a.closest("li, article, .Box-row, .source");
    if (!row) continue;
    // Heuristic: a watching row also includes /unsubscribe or a notification dropdown
    if (!row.querySelector("a[href*='unsubscribe'], button[name*='notif'], [class*='notification']") &&
        !row.querySelector(`form[action*='${owner}/${name}/subscription']`)) {
      continue;
    }
    const titleEl = row.querySelector<HTMLElement>("h3, h4, .h3, .h4, .text-bold");
    const title = (titleEl?.textContent || "").trim() || `${owner}/${name}`;
    if (title.length > 200) continue;

    const descEl = row.querySelector<HTMLElement>("p.color-fg-muted, .text-small.color-fg-muted");
    const descText = descEl?.textContent?.trim() || "";
    // reject watch-status/settings blurbs that leak in as a fake description
    const description = descText && !WATCH_STATUS_RE.test(descText) ? descText : null;
    const langEl = row.querySelector<HTMLElement>("[itemprop='programmingLanguage']");
    const language = langEl?.textContent?.trim() || null;
    const starsAnchor = row.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${name}/stargazers"]`);
    const forksAnchor = row.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${name}/forks"], a[href$="/${owner}/${name}/network/members"]`);
    const timeEl = row.querySelector<HTMLTimeElement>("relative-time, time");
    const updatedAt = timeEl?.getAttribute("datetime") || null;
    const ownerAvatar = row.querySelector<HTMLImageElement>("img.avatar, img[src*='avatars']")?.getAttribute("src") || `https://github.com/${owner}.png?size=40`;
    const isPrivate = !!row.querySelector("svg.octicon-lock, [aria-label*='Private']");
    const isFork = !!row.querySelector("svg.octicon-repo-forked, [aria-label*='Fork']");
    const subscriptionEl = row.querySelector<HTMLElement>("[data-test-selector*='subscription'], .text-bold");
    const subscriptionType = subscriptionEl?.textContent?.replace(/\s+/g, " ").trim() || null;

    seen.add(key);
    out.push({
      fullName: key,
      ownerLogin: owner,
      ownerAvatar,
      repoName: name,
      description,
      language,
      stars: parseShortCount(starsAnchor?.textContent || ""),
      forks: parseShortCount(forksAnchor?.textContent || ""),
      updatedAt,
      url: `https://github.com${href}`,
      isPrivate,
      isFork,
      subscriptionType,
    });
  }
  return out;
}

const RESERVED = new Set([
  "marketplace", "explore", "topics", "collections", "events", "trending",
  "about", "pricing", "features", "contact", "help", "blog", "site",
  "settings", "notifications", "issues", "pulls", "stars", "watching",
  "dashboard", "users", "orgs", "search", "login", "logout", "join",
  "signup", "new", "import", "gist", "gists", "apps", "sponsors",
  "codespaces", "discussions", "security", "advisories",
]);

const WATCH_STATUS_RE = /\b(Watching|Participating|Releases|Ignoring)\b/;

function parseShortCount(s: string): number | null {
  const trimmed = s.replace(/[\s,]/g, "").toLowerCase();
  const m = /^([\d.]+)([km])?$/.exec(trimmed);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return null;
  if (m[2] === "k") return Math.round(n * 1000);
  if (m[2] === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

function renderShell(): string {
  return `
    <div class="oldgh-page oldgh-watching__page">
      <header class="oldgh-watching__header">
        <h1>${octicon("eye", { size: 22 })} Watching</h1>
        <p class="oldgh-watching__sub">Repositories you're subscribed to. You receive notifications for activity matching your subscription level.</p>
      </header>
      <div class="oldgh-watching__list-slot">
        <div class="oldgh-watching__loading">Loading watched repositories&hellip;</div>
      </div>
    </div>
  `;
}

function renderList(items: WatchedRepo[]): string {
  if (items.length === 0) {
    return `
      <div class="oldgh-watching__empty">
        ${octicon("eye-closed", { size: 40 })}
        <h2>You aren't watching anything.</h2>
        <p>Watching a repository subscribes you to notifications about its activity. On a repo's page, click "Watch" to choose what you want notifications for.</p>
      </div>
    `;
  }
  return `
    <div class="oldgh-watching__bar">
      <div><strong>${items.length}</strong> watched ${items.length === 1 ? "repository" : "repositories"}</div>
    </div>
    <ul class="oldgh-watching__list">
      ${items.map(renderRow).join("")}
    </ul>
  `;
}

function renderRow(r: WatchedRepo): string {
  return `
    <li class="oldgh-watching__row">
      <a class="oldgh-watching__avatar" href="/${escapeAttr(r.ownerLogin)}" aria-label="View ${escapeAttr(r.ownerLogin)}'s profile">
        <img src="${escapeAttr(r.ownerAvatar)}" width="32" height="32" alt="" />
      </a>
      <div class="oldgh-watching__main">
        <h3 class="oldgh-watching__title">
          ${r.isPrivate
            ? octicon("lock", { size: 14 })
            : r.isFork
              ? octicon("repo-forked", { size: 14 })
              : octicon("repo", { size: 14 })}
          <a href="/${escapeAttr(r.ownerLogin)}">${escapeText(r.ownerLogin)}</a>
          <span class="oldgh-watching__slash">/</span>
          <a href="/${escapeAttr(r.ownerLogin)}/${escapeAttr(r.repoName)}"><strong>${escapeText(r.repoName)}</strong></a>
          ${r.isPrivate ? `<span class="oldgh-watching__chip">Private</span>` : ""}
        </h3>
        ${r.description ? `<p class="oldgh-watching__desc">${escapeText(r.description)}</p>` : ""}
        ${r.language || r.stars !== null || r.forks !== null || r.updatedAt ? `<ul class="oldgh-watching__meta">
          ${r.language ? `<li>${escapeText(r.language)}</li>` : ""}
          ${r.stars !== null ? `<li>${octicon("star", { size: 11 })} ${r.stars.toLocaleString()}</li>` : ""}
          ${r.forks !== null ? `<li>${octicon("repo-forked", { size: 11 })} ${r.forks.toLocaleString()}</li>` : ""}
          ${r.updatedAt ? `<li>Updated <time datetime="${escapeAttr(r.updatedAt)}" title="${escapeAttr(absoluteTime(r.updatedAt))}">${escapeText(relativeTime(r.updatedAt))}</time></li>` : ""}
        </ul>` : ""}
      </div>
      <a class="oldgh-watching__manage" href="/${escapeAttr(r.ownerLogin)}/${escapeAttr(r.repoName)}">
        ${octicon("bell", { size: 12 })}<span>Manage</span>
      </a>
    </li>
  `;
}
