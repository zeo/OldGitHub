import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchApi } from "@/adapters/rate-limit";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-list";

export type RepoListKind = "tags" | "branches" | "forks" | "stargazers" | "watchers" | "labels" | "milestones";

export async function mountRepoList(owner: string, repo: string, kind: RepoListKind, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${kind}`;
  root.innerHTML = renderShell(kind);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-repo-list__main");
  if (!main) return;

  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const state = params.get("state") ?? "open";

  try {
    let html = "";
    if (kind === "tags") html = await renderTags(owner, repo, page);
    else if (kind === "branches") html = await renderBranches(owner, repo, page);
    else if (kind === "forks") html = await renderForks(owner, repo, page);
    else if (kind === "stargazers") html = await renderStargazers(owner, repo, page);
    else if (kind === "watchers") html = await renderWatchers(owner, repo, page);
    else if (kind === "labels") html = await renderLabels(owner, repo, page);
    else if (kind === "milestones") html = await renderMilestones(owner, repo, state, page);
    main.innerHTML = html;
  } catch (err) {
    main.innerHTML = `<div class="oldgh-repo-list__empty">Couldn't load: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

function titleFor(kind: RepoListKind): string {
  switch (kind) {
    case "tags": return "Tags";
    case "branches": return "Branches";
    case "forks": return "Forks";
    case "stargazers": return "Stargazers";
    case "watchers": return "Watchers";
    case "labels": return "Labels";
    case "milestones": return "Milestones";
  }
}

function renderShell(kind: RepoListKind): string {
  return `
    <div class="oldgh-page">
      <header class="oldgh-repo-list__header">
        <h1>${escapeText(titleFor(kind))}</h1>
      </header>
      <div class="oldgh-repo-list__main">
        <div class="oldgh-repo-list__loading">Loading…</div>
      </div>
    </div>
  `;
}

async function fetchPage(url: string): Promise<unknown[]> {
  const resp = await fetchApi(url, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
  if (!resp.ok) throw new AdapterFailure("repoList", `${url} responded ${resp.status}`);
  const data = (await resp.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

async function renderTags(owner: string, repo: string, page: number): Promise<string> {
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=30&page=${page}`);
  if (data.length === 0) return emptyHtml("No tags published.");
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const name = readString(r, "name") ?? "";
    const commit = readObj(r["commit"]);
    const sha = commit ? (readString(commit, "sha") ?? "") : "";
    const zipUrl = readString(r, "zipball_url") ?? "";
    const tarUrl = readString(r, "tarball_url") ?? "";
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <a class="oldgh-repo-list__tag" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases/tag/${encodeURIComponent(name)}">${octicon("tag", { size: 14 })} <strong>${escapeText(name)}</strong></a>
          ${sha ? `<code class="oldgh-repo-list__sha"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/commit/${escapeAttr(sha)}">${escapeText(sha.slice(0, 7))}</a></code>` : ""}
        </div>
        <div class="oldgh-repo-list__actions">
          ${zipUrl ? `<a class="oldgh-btn" href="${escapeAttr(zipUrl)}">${octicon("cloud-download", { size: 12 })} zip</a>` : ""}
          ${tarUrl ? `<a class="oldgh-btn" href="${escapeAttr(tarUrl)}">${octicon("cloud-download", { size: 12 })} tar.gz</a>` : ""}
        </div>
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "tags", page, data.length === 30)}`;
}

async function renderBranches(owner: string, repo: string, page: number): Promise<string> {
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=30&page=${page}`);
  if (data.length === 0) return emptyHtml("No branches.");
  // also fetch default branch
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const name = readString(r, "name") ?? "";
    const commit = readObj(r["commit"]);
    const sha = commit ? (readString(commit, "sha") ?? "") : "";
    const isProtected = r["protected"] === true;
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <a class="oldgh-repo-list__branch" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/tree/${encodeURIComponent(name)}">${octicon("git-branch", { size: 14 })} <strong>${escapeText(name)}</strong></a>
          ${isProtected ? `<span class="oldgh-repo-list__tag-badge">Protected</span>` : ""}
          ${sha ? `<code class="oldgh-repo-list__sha"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/commit/${escapeAttr(sha)}">${escapeText(sha.slice(0, 7))}</a></code>` : ""}
        </div>
        <div class="oldgh-repo-list__actions">
          <a class="oldgh-btn" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/compare/${encodeURIComponent(name)}">Compare</a>
        </div>
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "branches", page, data.length === 30)}`;
}

async function renderForks(owner: string, repo: string, page: number): Promise<string> {
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/forks?per_page=30&page=${page}&sort=stargazers`);
  if (data.length === 0) return emptyHtml("This repository has no forks yet.");
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const fullName = readString(r, "full_name") ?? "";
    const ownerObj = readObj(r["owner"]);
    const avatar = ownerObj ? (readString(ownerObj, "avatar_url") ?? "") : "";
    const stars = readNumber(r, "stargazers_count") ?? 0;
    const forks = readNumber(r, "forks_count") ?? 0;
    const updated = readString(r, "pushed_at") ?? readString(r, "updated_at") ?? "";
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <img class="oldgh-repo-list__avatar" src="${escapeAttr(avatar)}" width="20" height="20" alt="" />
          <a href="/${escapeAttr(fullName)}"><strong>${escapeText(fullName)}</strong></a>
          ${updated ? `<span class="oldgh-repo-list__muted">updated ${escapeText(relativeTime(updated))}</span>` : ""}
        </div>
        <div class="oldgh-repo-list__counters">
          <span>${octicon("star", { size: 12 })} ${formatCount(stars)}</span>
          <span>${octicon("repo-forked", { size: 12 })} ${formatCount(forks)}</span>
        </div>
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "forks", page, data.length === 30)}`;
}

async function renderStargazers(owner: string, repo: string, page: number): Promise<string> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=60&page=${page}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github.star+json" },
  });
  if (!resp.ok) throw new AdapterFailure("repoList", `stargazers responded ${resp.status}`);
  const data = (await resp.json()) as unknown;
  const arr = Array.isArray(data) ? data : [];
  if (arr.length === 0) return emptyHtml("No stargazers.");
  const rows = arr.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const starredAt = readString(r, "starred_at") ?? "";
    const user = readObj(r["user"]) ?? r;
    const login = (user && readString(user as Record<string, unknown>, "login")) ?? "";
    const avatar = (user && readString(user as Record<string, unknown>, "avatar_url")) ?? "";
    return `
      <li class="oldgh-repo-list__star-cell">
        <a class="oldgh-repo-list__star-link" href="/${escapeAttr(login)}">
          <img src="${escapeAttr(avatar)}" width="48" height="48" alt="" />
          <span class="oldgh-repo-list__star-name">${escapeText(login)}</span>
          ${starredAt ? `<span class="oldgh-repo-list__star-when" title="${escapeAttr(absoluteTime(starredAt))}">${escapeText(relativeTime(starredAt))}</span>` : ""}
        </a>
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__star-grid">${rows}</ul>${pagerHtml(owner, repo, "stargazers", page, arr.length === 60)}`;
}

async function renderWatchers(owner: string, repo: string, page: number): Promise<string> {
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/subscribers?per_page=60&page=${page}`);
  if (data.length === 0) return emptyHtml("No watchers.");
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const login = readString(r, "login") ?? "";
    const avatar = readString(r, "avatar_url") ?? "";
    return `
      <li class="oldgh-repo-list__star-cell">
        <a class="oldgh-repo-list__star-link" href="/${escapeAttr(login)}">
          <img src="${escapeAttr(avatar)}" width="48" height="48" alt="" />
          <span class="oldgh-repo-list__star-name">${escapeText(login)}</span>
        </a>
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__star-grid">${rows}</ul>${pagerHtml(owner, repo, "watchers", page, data.length === 60)}`;
}

async function renderLabels(owner: string, repo: string, page: number): Promise<string> {
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/labels?per_page=100&page=${page}`);
  if (data.length === 0) return emptyHtml("No labels.");
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const name = readString(r, "name") ?? "";
    const color = (readString(r, "color") ?? "ccc").replace(/^#/, "");
    const desc = readString(r, "description") ?? "";
    const labelQuery = new URLSearchParams({ q: `is:open label:"${name}"` }).toString();
    return `
      <li class="oldgh-repo-list__label-row">
        <a class="oldgh-repo-list__label" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/issues?${escapeAttr(labelQuery)}" style="background:#${escapeAttr(color)};color:${labelTextColor(color)};">${escapeText(name)}</a>
        ${desc ? `<span class="oldgh-repo-list__label-desc">${escapeText(desc)}</span>` : ""}
      </li>
    `;
  }).join("");
  return `<ul class="oldgh-repo-list__label-list">${rows}</ul>${pagerHtml(owner, repo, "labels", page, data.length === 100)}`;
}

async function renderMilestones(owner: string, repo: string, state: string, page: number): Promise<string> {
  const validState = state === "closed" ? "closed" : "open";
  const data = await fetchPage(`https://api.github.com/repos/${owner}/${repo}/milestones?per_page=30&page=${page}&state=${validState}&sort=due_on&direction=asc`);
  const switcher = `
    <div class="oldgh-repo-list__switch">
      <a class="${validState === "open" ? "is-active" : ""}" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/milestones?state=open">Open</a>
      <a class="${validState === "closed" ? "is-active" : ""}" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/milestones?state=closed">Closed</a>
    </div>
  `;
  if (data.length === 0) return `${switcher}${emptyHtml(validState === "open" ? "No open milestones." : "No closed milestones.")}`;
  const rows = data.map((raw) => {
    if (!raw || typeof raw !== "object") return "";
    const r = raw as Record<string, unknown>;
    const title = readString(r, "title") ?? "";
    const number = readNumber(r, "number") ?? 0;
    const open = readNumber(r, "open_issues") ?? 0;
    const closed = readNumber(r, "closed_issues") ?? 0;
    const total = open + closed;
    const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
    const due = readString(r, "due_on");
    const desc = readString(r, "description") ?? "";
    return `
      <li class="oldgh-repo-list__milestone">
        <h3 class="oldgh-repo-list__milestone-title">
          <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/issues?milestone=${encodeURIComponent(String(number))}">${escapeText(title)}</a>
        </h3>
        ${desc ? `<p class="oldgh-repo-list__milestone-desc">${escapeText(desc)}</p>` : ""}
        <div class="oldgh-repo-list__milestone-bar"><span style="width:${pct}%"></span></div>
        <div class="oldgh-repo-list__milestone-meta">
          <span><strong>${pct}%</strong> complete</span>
          <span>${open} open</span>
          <span>${closed} closed</span>
          ${due ? `<span>Due by ${escapeText(dueByLabel(due))}</span>` : ""}
        </div>
      </li>
    `;
  }).join("");
  return `${switcher}<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "milestones", page, data.length === 30, validState)}`;
}

function pagerHtml(owner: string, repo: string, kind: string, page: number, hasMore: boolean, state?: string): string {
  if (page <= 1 && !hasMore) return "";
  // milestones default to open when state is absent, so carry the closed tab across pages
  const stateQuery = kind === "milestones" && state === "closed" ? "&state=closed" : "";
  return `
    <nav class="oldgh-repo-list__pager">
      ${page > 1 ? `<a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/${escapeAttr(kind)}?page=${page - 1}${stateQuery}">‹ Newer</a>` : "<span></span>"}
      <span>Page ${page}</span>
      ${hasMore ? `<a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/${escapeAttr(kind)}?page=${page + 1}${stateQuery}">Older ›</a>` : "<span></span>"}
    </nav>
  `;
}

function emptyHtml(msg: string): string {
  return `<div class="oldgh-repo-list__empty">${escapeText(msg)}</div>`;
}

function dueByLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

import { formatCount } from "@/util/format";

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
