import { octicon } from "@/icons";
import { fetchApi } from "@/adapters/rate-limit";
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
  followers: number;
  following: number;
  publicRepos: number;
  company: string | null;
  location: string | null;
  htmlUrl: string;
  type: "User" | "Organization";
};

type RepoCard = {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  htmlUrl: string;
  ownerAvatar: string;
  isPrivate: boolean;
  isArchived: boolean;
};

type IssueCard = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  stateReason: string | null;
  isPull: boolean;
  merged: boolean;
  draft: boolean;
  authorLogin: string;
  authorAvatar: string;
  createdAt: string;
  bodyHtml: string;
  htmlUrl: string;
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
      const card = await fetchIssue(target.owner, target.repo, target.number);
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

async function fetchUser(login: string): Promise<UserCard | null> {
  const cached = userCache.get(login);
  if (cached) return cached;
  const p = (async (): Promise<UserCard | null> => {
    try {
      const r = await fetchApi(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (r.status === 404) {
        negativeCache.add(`u:${login}`);
        return null;
      }
      if (!r.ok) return null;
      const d = (await r.json()) as Record<string, unknown>;
      return {
        login: readString(d, "login") ?? login,
        name: readString(d, "name"),
        avatarUrl: readString(d, "avatar_url") ?? `https://github.com/${login}.png?size=96`,
        bio: readString(d, "bio"),
        followers: readNumber(d, "followers") ?? 0,
        following: readNumber(d, "following") ?? 0,
        publicRepos: readNumber(d, "public_repos") ?? 0,
        company: readString(d, "company"),
        location: readString(d, "location"),
        htmlUrl: readString(d, "html_url") ?? `https://github.com/${login}`,
        type: readString(d, "type") === "Organization" ? "Organization" : "User",
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
      const r = await fetchApi(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (r.status === 404) {
        negativeCache.add(`r:${key}`);
        return null;
      }
      if (!r.ok) return null;
      const d = (await r.json()) as Record<string, unknown>;
      const ownerObj = d["owner"] && typeof d["owner"] === "object" ? (d["owner"] as Record<string, unknown>) : null;
      return {
        fullName: readString(d, "full_name") ?? key,
        description: readString(d, "description"),
        stars: readNumber(d, "stargazers_count") ?? 0,
        forks: readNumber(d, "forks_count") ?? 0,
        language: readString(d, "language"),
        htmlUrl: readString(d, "html_url") ?? `https://github.com/${key}`,
        ownerAvatar: (ownerObj && readString(ownerObj, "avatar_url")) ?? "",
        isPrivate: d["private"] === true,
        isArchived: d["archived"] === true,
      };
    } catch {
      return null;
    }
  })();
  return remember(repoCache, key, p);
}

async function fetchIssue(owner: string, repo: string, number: number): Promise<IssueCard | null> {
  const key = `${owner}/${repo}#${number}`;
  const cached = issueCache.get(key);
  if (cached) return cached;
  const p = (async (): Promise<IssueCard | null> => {
    try {
      const r = await fetchApi(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`, {
        credentials: "omit",
        headers: { Accept: "application/vnd.github.html+json" },
      });
      if (r.status === 404) {
        negativeCache.add(`i:${key}`);
        return null;
      }
      if (!r.ok) return null;
      const d = (await r.json()) as Record<string, unknown>;
      const userObj = d["user"] && typeof d["user"] === "object" ? (d["user"] as Record<string, unknown>) : null;
      const pull = d["pull_request"] && typeof d["pull_request"] === "object" ? (d["pull_request"] as Record<string, unknown>) : null;
      const isPull = !!pull;
      const merged = pull ? typeof pull["merged_at"] === "string" && pull["merged_at"] !== null : false;
      return {
        owner,
        repo,
        number,
        title: readString(d, "title") ?? "",
        state: readString(d, "state") === "closed" ? "closed" : "open",
        stateReason: readString(d, "state_reason"),
        isPull,
        merged,
        draft: d["draft"] === true,
        authorLogin: userObj ? (readString(userObj, "login") ?? "") : "",
        authorAvatar: userObj ? (readString(userObj, "avatar_url") ?? "") : "",
        createdAt: readString(d, "created_at") ?? "",
        bodyHtml: readString(d, "body_html") ?? "",
        htmlUrl: readString(d, "html_url") ?? `https://github.com/${key}`,
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
  if (c.company) meta.push(`${octicon("organization", { size: 12 })} ${escapeText(c.company)}`);
  if (c.location) meta.push(`${octicon("location", { size: 12 })} ${escapeText(c.location)}`);
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
    <ul class="oldgh-hovercard__stats">
      <li><strong>${formatCount(c.followers)}</strong> ${c.followers === 1 ? "follower" : "followers"}</li>
      <li><strong>${formatCount(c.following)}</strong> following</li>
      <li><strong>${formatCount(c.publicRepos)}</strong> ${c.publicRepos === 1 ? "repo" : "repos"}</li>
    </ul>
  `;
}

function renderRepoCard(c: RepoCard): string {
  const [ownerLogin, repoName] = c.fullName.split("/");
  return `
    <header class="oldgh-hovercard__head">
      <img class="oldgh-hovercard__avatar oldgh-hovercard__avatar--repo" src="${escapeAttr(c.ownerAvatar)}" width="32" height="32" alt="" />
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
  let stateIcon = octicon("issue-opened", { size: 14 });
  let stateLabel = "Open";
  let stateCls = "oldgh-hovercard__state--open";
  if (c.isPull) {
    if (c.merged) {
      stateIcon = octicon("git-merge", { size: 14 });
      stateLabel = "Merged";
      stateCls = "oldgh-hovercard__state--merged";
    } else if (c.state === "closed") {
      stateIcon = octicon("git-pull-request", { size: 14 });
      stateLabel = "Closed";
      stateCls = "oldgh-hovercard__state--closed";
    } else if (c.draft) {
      stateIcon = octicon("git-pull-request", { size: 14 });
      stateLabel = "Draft";
      stateCls = "oldgh-hovercard__state--draft";
    } else {
      stateIcon = octicon("git-pull-request", { size: 14 });
      stateLabel = "Open";
    }
  } else if (c.state === "closed") {
    stateIcon = octicon("issue-closed", { size: 14 });
    stateLabel = c.stateReason === "not_planned" ? "Closed (not planned)" : "Closed";
    stateCls = "oldgh-hovercard__state--closed";
  }
  const dateNote = c.createdAt ? ` · opened ${formatRelative(c.createdAt)}` : "";
  const bodyExcerpt = c.bodyHtml ? `<div class="oldgh-hovercard__issue-body">${truncateHtml(c.bodyHtml, 320)}</div>` : "";
  return `
    <header class="oldgh-hovercard__head">
      <span class="oldgh-hovercard__state ${stateCls}">${stateIcon}</span>
      <div class="oldgh-hovercard__head-text">
        <a class="oldgh-hovercard__issue-title" href="/${escapeAttr(c.owner)}/${escapeAttr(c.repo)}/${c.isPull ? "pull" : "issues"}/${c.number}">${escapeText(c.title)}</a>
        <div class="oldgh-hovercard__issue-meta">
          <span class="oldgh-hovercard__state-label">${escapeText(stateLabel)}</span>
          · ${escapeText(c.owner)}/${escapeText(c.repo)}#${c.number}${dateNote}
        </div>
      </div>
    </header>
    ${c.authorLogin ? `
      <div class="oldgh-hovercard__issue-author">
        <img src="${escapeAttr(c.authorAvatar)}" width="20" height="20" alt="" />
        <a href="/${escapeAttr(c.authorLogin)}">${escapeText(c.authorLogin)}</a>
      </div>
    ` : ""}
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

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.round(mo / 12);
  return `${y}y ago`;
}

import { formatCount } from "@/util/format";

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}
function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}
