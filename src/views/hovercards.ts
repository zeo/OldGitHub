import { octicon } from "@/icons";
import { languageColor } from "@/util/language-color";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const SHOW_DELAY = 350;
const HIDE_DELAY = 200;
const FAILURE_TTL = 5 * 60 * 1000;
const MAX_CACHE = 200;

type UserCard = {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  location: string | null;
  orgs: string[];
  stats: string[];
  type: "User" | "Organization";
};

type RepoCard = {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  isPrivate: boolean;
  isArchived: boolean;
};

type IssueCard = {
  owner: string;
  repo: string;
  number: number;
  titleHtml: string;
  stateLabel: string;
  isPull: boolean;
  openedOn: string | null;
  bodyHtml: string;
};

const issueCache = new Map<string, Promise<IssueCard | null>>();

const userCache = new Map<string, Promise<UserCard | null>>();
const repoCache = new Map<string, Promise<RepoCard | null>>();
const negativeCache = new Set<string>();

let popoverEl: HTMLDivElement | null = null;
let activeAnchor: HTMLAnchorElement | null = null;
let showTimer: number | null = null;
let hideTimer: number | null = null;

const RESERVED = new Set([
  "settings", "notifications", "marketplace", "explore", "trending", "search",
  "issues", "pulls", "stars", "watching", "dashboard", "new", "login", "logout",
  "join", "signup", "topics", "collections", "events", "feed", "gist", "gists",
  "apps", "features", "pricing", "about", "contact", "help", "home", "users",
  "advisories", "security", "codespaces", "sponsors", "enterprise", "enterprises",
  "organizations", "orgs", "404", "premium-support", "site", "premium",
]);

export function mountHovercards(): void {
  if (popoverEl) return;
  popoverEl = document.createElement("div");
  popoverEl.className = "oldgh-hovercard";
  popoverEl.hidden = true;
  popoverEl.addEventListener("mouseenter", clearHideTimer);
  popoverEl.addEventListener("mouseleave", scheduleHide);
  document.body.appendChild(popoverEl);

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("scroll", hideNow, true);
}

function onMouseOver(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (!target) return;
  if (popoverEl && popoverEl.contains(target)) return;
  const anchor = target.closest<HTMLAnchorElement>("a");
  if (!anchor) return;
  if (anchor === activeAnchor) return;
  const target_ = resolveTarget(anchor);
  if (!target_) return;
  clearShowTimer();
  clearHideTimer();
  activeAnchor = anchor;
  const t = target_;
  showTimer = window.setTimeout(() => {
    void showCard(anchor, t);
  }, SHOW_DELAY);
}

function onMouseOut(e: MouseEvent): void {
  const related = e.relatedTarget as Element | null;
  if (related && popoverEl && popoverEl.contains(related)) return;
  scheduleHide();
}

function scheduleHide(): void {
  clearShowTimer();
  clearHideTimer();
  hideTimer = window.setTimeout(hideNow, HIDE_DELAY);
}

function hideNow(): void {
  clearShowTimer();
  clearHideTimer();
  activeAnchor = null;
  if (popoverEl) {
    popoverEl.hidden = true;
    popoverEl.innerHTML = "";
  }
}

function clearShowTimer(): void {
  if (showTimer != null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function clearHideTimer(): void {
  if (hideTimer != null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

type HoverTarget =
  | { kind: "user"; login: string }
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "issue"; owner: string; repo: string; number: number; isPull: boolean };

function resolveTarget(a: HTMLAnchorElement): HoverTarget | null {
  if (!a.href || a.dataset["oldghNoHover"] === "1") return null;
  if (a.closest(".oldgh-header, .oldgh-repo-tabs, .oldgh-tabs, .oldgh-progress-bar, .oldgh-hovercard, .oldgh-breadcrumb, .oldgh-profile__tabnav, .oldgh-repo-header__actions")) return null;
  let url: URL;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return null;
  }
  if (url.host !== location.host) return null;
  const path = url.pathname;
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const first = segs[0]!;
  if (RESERVED.has(first)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})$/.test(first)) return null;
  if (segs.length === 1 && !url.search) {
    if (negativeCache.has(`u:${first}`)) return null;
    return { kind: "user", login: first };
  }
  if (segs.length >= 2) {
    const second = segs[1]!;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(second)) return null;
    if (RESERVED.has(second)) {
      if (url.search) return null;
      return { kind: "user", login: first };
    }
    if (segs.length >= 4 && (segs[2] === "issues" || segs[2] === "pull")) {
      const num = parseInt(segs[3]!, 10);
      if (!Number.isNaN(num)) {
        if (negativeCache.has(`i:${first}/${second}#${num}`)) return null;
        return { kind: "issue", owner: first, repo: second, number: num, isPull: segs[2] === "pull" };
      }
    }
    if (segs.length === 2 && !url.search) {
      if (negativeCache.has(`r:${first}/${second}`)) return null;
      return { kind: "repo", owner: first, repo: second };
    }
  }
  return null;
}

async function showCard(anchor: HTMLAnchorElement, target: HoverTarget): Promise<void> {
  if (!popoverEl || activeAnchor !== anchor) return;
  popoverEl.innerHTML = `<div class="oldgh-hovercard__loading">Loading…</div>`;
  positionPopover(anchor);
  popoverEl.hidden = false;

  try {
    if (target.kind === "user") {
      const card = await fetchUser(target.login);
      if (!card) { hideNow(); return; }
      if (activeAnchor !== anchor) return;
      popoverEl.innerHTML = renderUserCard(card);
    } else if (target.kind === "repo") {
      const card = await fetchRepo(target.owner, target.repo);
      if (!card) { hideNow(); return; }
      if (activeAnchor !== anchor) return;
      popoverEl.innerHTML = renderRepoCard(card);
    } else {
      const card = await fetchIssue(target.owner, target.repo, target.number, target.isPull);
      if (!card) { hideNow(); return; }
      if (activeAnchor !== anchor) return;
      popoverEl.innerHTML = renderIssueCard(card);
    }
    positionPopover(anchor);
  } catch {
    hideNow();
  }
}

function positionPopover(anchor: HTMLAnchorElement): void {
  if (!popoverEl) return;
  const rect = anchor.getBoundingClientRect();
  const pop = popoverEl;
  pop.style.left = "0";
  pop.style.top = "0";
  pop.style.visibility = "hidden";
  pop.hidden = false;
  const popRect = pop.getBoundingClientRect();
  const popW = popRect.width || 300;
  const popH = popRect.height || 150;
  let left = rect.left;
  let top = rect.bottom + 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left + popW > vw - 12) left = Math.max(12, vw - popW - 12);
  if (top + popH > vh - 12) top = Math.max(12, rect.top - popH - 6);
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${top + window.scrollY}px`;
  pop.style.visibility = "";
}

// github serves its own hovercards as html fragments, which cost no api quota; null means the subject doesn't exist
async function fetchHovercard(path: string): Promise<Document | null> {
  const r = await fetch(path, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} responded ${r.status}`);
  return new DOMParser().parseFromString(await r.text(), "text/html");
}

function textOf(root: ParentNode, selector: string): string | null {
  return root.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || null;
}

function countOf(root: ParentNode, selector: string): number {
  return Number(textOf(root, selector)?.replace(/,/g, "")) || 0;
}

async function fetchUser(login: string): Promise<UserCard | null> {
  const cached = userCache.get(login);
  if (cached) return cached;
  const p = (async (): Promise<UserCard | null> => {
    try {
      const user = await fetchHovercard(`/users/${encodeURIComponent(login)}/hovercard`);
      if (user) {
        return {
          login: textOf(user, "section[aria-label='User login and name'] > a") ?? login,
          name: textOf(user, "section[aria-label='User login and name'] .Truncate-text"),
          avatarUrl: user.querySelector("img.user-hovercard-avatar-image")?.getAttribute("src") ?? `https://github.com/${login}.png?size=96`,
          bio: textOf(user, "section[aria-label='User bio']"),
          location: textOf(user, "address[aria-label='User location']"),
          orgs: Array.from(user.querySelectorAll("a[data-octo-dimensions='link_type:organization']"), (a) => a.getAttribute("href")?.slice(1) ?? "").filter(Boolean),
          stats: [],
          type: "User",
        };
      }
      const org = await fetchHovercard(`/orgs/${encodeURIComponent(login)}/hovercard`);
      if (!org) {
        negativeCache.add(`u:${login}`);
        return null;
      }
      const links = org.querySelectorAll("a.no-underline[href]");
      return {
        login: links[1]?.textContent?.trim() || login,
        name: links[0]?.textContent?.trim() || null,
        avatarUrl: org.querySelector("img.avatar")?.getAttribute("src") ?? `https://github.com/${login}.png?size=96`,
        bio: null,
        location: null,
        orgs: [],
        stats: Array.from(org.querySelectorAll(".border-top .d-inline-block"), (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean),
        type: "Organization",
      };
    } catch {
      return null;
    }
  })();
  return remember(userCache, login, p);
}

async function fetchRepo(owner: string, repo: string): Promise<RepoCard | null> {
  const key = `${owner}/${repo}`;
  const cached = repoCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<RepoCard | null> => {
    try {
      const doc = await fetchHovercard(`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hovercard`);
      if (!doc) {
        negativeCache.add(`r:${key}`);
        return null;
      }
      const labels = Array.from(doc.querySelectorAll(".Label"), (el) => el.textContent ?? "");
      return {
        fullName: textOf(doc, "h1 a") ?? key,
        description: textOf(doc, "p[itemprop='description']"),
        stars: countOf(doc, "a[href$='/stargazers']"),
        forks: countOf(doc, "a[href$='/forks']"),
        language: textOf(doc, "[itemprop='programmingLanguage']"),
        isPrivate: labels.some((l) => /private/i.test(l)),
        isArchived: labels.some((l) => /archive/i.test(l)),
      };
    } catch {
      return null;
    }
  })();
  return remember(repoCache, key, p);
}

async function fetchIssue(owner: string, repo: string, number: number, isPull: boolean): Promise<IssueCard | null> {
  const key = `${owner}/${repo}#${number}`;
  const cached = issueCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<IssueCard | null> => {
    try {
      const doc = await fetchHovercard(`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${isPull ? "pull" : "issues"}/${number}/hovercard`);
      if (!doc) {
        negativeCache.add(`i:${key}`);
        return null;
      }
      return {
        owner,
        repo,
        number,
        titleHtml: sanitizeHtml(doc.querySelector(".markdown-title bdi")?.innerHTML ?? ""),
        stateLabel: textOf(doc, ".State") ?? "Open",
        isPull: doc.querySelector("[data-hydro-view*='pull-request-hovercard']") !== null,
        openedOn: textOf(doc, ".mb-1 > span"),
        bodyHtml: doc.querySelector(".markdown-body-short")?.innerHTML ?? "",
      };
    } catch {
      return null;
    }
  })();
  return remember(issueCache, key, p);
}

// a failed lookup (rate limit, network) is retried after a while instead of never
function remember<T>(cache: Map<string, Promise<T | null>>, key: string, p: Promise<T | null>): Promise<T | null> {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, p);
  void p.then((card) => {
    if (card === null) window.setTimeout(() => cache.get(key) === p && cache.delete(key), FAILURE_TTL);
  });
  return p;
}

function renderUserCard(c: UserCard): string {
  const meta: string[] = [];
  if (c.location) meta.push(`${octicon("location", { size: 12 })} ${escapeText(c.location)}`);
  if (c.orgs.length) meta.push(`${octicon("organization", { size: 12 })} Member of ${c.orgs.map((o) => `<a href="/${escapeAttr(o)}">${escapeText(o)}</a>`).join(", ")}`);
  return `
    <header class="oldgh-hovercard__head">
      <img class="oldgh-hovercard__avatar" src="${escapeAttr(c.avatarUrl)}" width="64" height="64" alt="" />
      <div class="oldgh-hovercard__head-text">
        ${c.name ? `<div class="oldgh-hovercard__name">${escapeText(c.name)}</div>` : ""}
        <a class="oldgh-hovercard__login" href="/${escapeAttr(c.login)}">${escapeText(c.login)}</a>
        ${c.type === "Organization" ? `<span class="oldgh-hovercard__chip">Organization</span>` : ""}
      </div>
    </header>
    ${c.bio ? `<p class="oldgh-hovercard__bio">${escapeText(c.bio)}</p>` : ""}
    ${meta.length > 0 ? `<ul class="oldgh-hovercard__meta">${meta.map((m) => `<li>${m}</li>`).join("")}</ul>` : ""}
    ${c.stats.length > 0 ? `<ul class="oldgh-hovercard__stats">${c.stats.map((st) => `<li>${escapeText(st)}</li>`).join("")}</ul>` : ""}
  `;
}

function renderRepoCard(c: RepoCard): string {
  const [ownerLogin, repoName] = c.fullName.split("/");
  return `
    <header class="oldgh-hovercard__head">
      <img class="oldgh-hovercard__avatar oldgh-hovercard__avatar--repo" src="${escapeAttr(`https://github.com/${ownerLogin ?? ""}.png?size=64`)}" width="32" height="32" alt="" />
      <div class="oldgh-hovercard__head-text">
        <div class="oldgh-hovercard__login">
          <a href="/${escapeAttr(ownerLogin ?? "")}">${escapeText(ownerLogin ?? "")}</a> /
          <a href="/${escapeAttr(ownerLogin ?? "")}/${escapeAttr(repoName ?? "")}"><strong>${escapeText(repoName ?? "")}</strong></a>
        </div>
        <div class="oldgh-hovercard__chips">
          ${c.isPrivate ? `<span class="oldgh-hovercard__chip">Private</span>` : ""}
          ${c.isArchived ? `<span class="oldgh-hovercard__chip oldgh-hovercard__chip--warn">Archived</span>` : ""}
        </div>
      </div>
    </header>
    ${c.description ? `<p class="oldgh-hovercard__bio">${escapeText(c.description)}</p>` : ""}
    <ul class="oldgh-hovercard__stats">
      ${c.language ? `<li><span class="oldgh-search__lang-dot" style="background:${languageColor(c.language)}"></span>${escapeText(c.language)}</li>` : ""}
      <li>${octicon("star", { size: 12 })} ${formatCount(c.stars)}</li>
      <li>${octicon("repo-forked", { size: 12 })} ${formatCount(c.forks)}</li>
    </ul>
  `;
}

function renderIssueCard(c: IssueCard): string {
  const state = /^merged/i.test(c.stateLabel) ? "merged" : /^closed/i.test(c.stateLabel) ? "closed" : /^draft/i.test(c.stateLabel) ? "draft" : "open";
  const icon = c.isPull
    ? octicon(state === "merged" ? "git-merge" : "git-pull-request", { size: 14 })
    : octicon(state === "closed" ? "issue-closed" : "issue-opened", { size: 14 });
  const bodyExcerpt = c.bodyHtml ? `<div class="oldgh-hovercard__issue-body">${truncateHtml(c.bodyHtml, 320)}</div>` : "";
  return `
    <header class="oldgh-hovercard__head">
      <span class="oldgh-hovercard__state oldgh-hovercard__state--${state}">${icon}</span>
      <div class="oldgh-hovercard__head-text">
        <a class="oldgh-hovercard__issue-title" href="/${escapeAttr(c.owner)}/${escapeAttr(c.repo)}/${c.isPull ? "pull" : "issues"}/${c.number}">${c.titleHtml}</a>
        <div class="oldgh-hovercard__issue-meta">
          <span class="oldgh-hovercard__state-label">${escapeText(c.stateLabel)}</span>
          · ${escapeText(c.owner)}/${escapeText(c.repo)}#${c.number}${c.openedOn ? ` · opened ${escapeText(c.openedOn)}` : ""}
        </div>
      </div>
    </header>
    ${bodyExcerpt}
  `;
}

function truncateHtml(html: string, maxChars: number): string {
  const clean = sanitizeHtml(html);
  const tmp = document.createElement("template");
  tmp.innerHTML = clean;
  const text = tmp.content.textContent || "";
  if (text.length <= maxChars) return clean;
  return escapeText(text.slice(0, maxChars).trim() + "…");
}

import { formatCount } from "@/util/format";
