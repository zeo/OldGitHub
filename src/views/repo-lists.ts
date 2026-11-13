import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchApi } from "@/adapters/rate-limit";
import { fetchPageDoc, loadPagePayload, pageLinks } from "@/adapters/_page";
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
    if (kind === "tags") html = await renderTags(owner, repo, search);
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

async function renderTags(owner: string, repo: string, search: string): Promise<string> {
  const query = search.replace(/^\?/, "");
  const doc = await fetchPageDoc(`https://github.com/${owner}/${repo}/tags${query ? `?${query}` : ""}`);
  const repoPath = `/${escapeAttr(owner)}/${escapeAttr(repo)}`;
  const rows = Array.from(doc.querySelectorAll(".Box-row")).map((row) => {
    const name = row.querySelector("h2 a")?.textContent?.trim() ?? "";
    if (!name) return "";
    const sha = row.querySelector('a[href*="/commit/"]')?.textContent?.trim() ?? "";
    const date = row.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? "";
    const archives = Array.from(row.querySelectorAll('a[href*="/archive/"]'), (a) => a.getAttribute("href") ?? "");
    const zipUrl = archives.find((h) => h.endsWith(".zip")) ?? "";
    const tarUrl = archives.find((h) => h.endsWith(".tar.gz")) ?? "";
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <a class="oldgh-repo-list__tag" href="${repoPath}/releases/tag/${encodeURIComponent(name)}">${octicon("tag", { size: 14 })} <strong>${escapeText(name)}</strong></a>
          ${sha ? `<code class="oldgh-repo-list__sha"><a href="${repoPath}/commit/${escapeAttr(sha)}">${escapeText(sha)}</a></code>` : ""}
          ${date ? `<span class="oldgh-repo-list__muted" title="${escapeAttr(absoluteTime(date))}">${escapeText(relativeTime(date))}</span>` : ""}
        </div>
        <div class="oldgh-repo-list__actions">
          ${zipUrl ? `<a class="oldgh-btn" href="${escapeAttr(zipUrl)}">${octicon("cloud-download", { size: 12 })} zip</a>` : ""}
          ${tarUrl ? `<a class="oldgh-btn" href="${escapeAttr(tarUrl)}">${octicon("cloud-download", { size: 12 })} tar.gz</a>` : ""}
        </div>
      </li>
    `;
  }).join("");
  if (!rows) return emptyHtml("No tags published.");
  const { prev, next } = pageLinks(doc);
  const pager = prev || next
    ? `<nav class="oldgh-repo-list__pager">${prev ? `<a href="${escapeAttr(prev)}">‹ Newer</a>` : "<span></span>"}${next ? `<a href="${escapeAttr(next)}">Older ›</a>` : "<span></span>"}</nav>`
    : "";
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pager}`;
}

async function renderBranches(owner: string, repo: string, page: number): Promise<string> {
  const payload = readObj(readObj(await loadPagePayload(`https://github.com/${owner}/${repo}/branches/all?page=${page}`))?.["payload"]) ?? {};
  const branches = Array.isArray(payload["branches"]) ? payload["branches"] : [];
  const repoPath = `/${escapeAttr(owner)}/${escapeAttr(repo)}`;
  const rows = branches.map((raw) => {
    const r = readObj(raw);
    const name = r ? readString(r, "name") ?? "" : "";
    if (!r || !name) return "";
    const isDefault = r["isDefault"] === true;
    const author = readObj(r["author"]);
    const login = author ? readString(author, "login") ?? "" : "";
    const date = readString(r, "authoredDate") ?? "";
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <a class="oldgh-repo-list__branch" href="${repoPath}/tree/${encodeURIComponent(name)}">${octicon("git-branch", { size: 14 })} <strong>${escapeText(name)}</strong></a>
          ${isDefault ? `<span class="oldgh-repo-list__tag-badge">Default</span>` : ""}
          ${r["protectedByBranchProtections"] === true ? `<span class="oldgh-repo-list__tag-badge">Protected</span>` : ""}
          ${date ? `<span class="oldgh-repo-list__muted" title="${escapeAttr(absoluteTime(date))}">updated ${escapeText(relativeTime(date))}${login ? ` by <a href="/${escapeAttr(login)}">${escapeText(login)}</a>` : ""}</span>` : ""}
        </div>
        <div class="oldgh-repo-list__actions">
          ${isDefault ? "" : `<a class="oldgh-btn" href="${repoPath}/compare/${encodeURIComponent(name)}">Compare</a>`}
        </div>
      </li>
    `;
  }).join("");
  if (!rows) return emptyHtml("No branches.");
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "branches", page, payload["has_more"] === true)}`;
}

export async function renderForks(owner: string, repo: string, page: number): Promise<string> {
  const doc = await fetchPageDoc(`https://github.com/${owner}/${repo}/forks?page=${page}`);
  const rows = Array.from(doc.querySelectorAll(".Box-row")).map((row) => {
    const fullName = row.querySelector("h2 a.Link")?.getAttribute("href")?.slice(1) ?? "";
    if (!fullName.includes("/")) return "";
    const avatar = row.querySelector("h2 img")?.getAttribute("src") ?? "";
    const count = (list: string): string => row.querySelector(`a[href$="/${list}"]`)?.textContent?.trim() || "0";
    const times = row.querySelectorAll("relative-time[datetime]");
    const updated = times[times.length - 1]?.getAttribute("datetime") ?? "";
    return `
      <li class="oldgh-repo-list__row">
        <div class="oldgh-repo-list__main-cell">
          <img class="oldgh-repo-list__avatar" src="${escapeAttr(avatar)}" width="20" height="20" alt="" />
          <a href="/${escapeAttr(fullName)}"><strong>${escapeText(fullName)}</strong></a>
          ${updated ? `<span class="oldgh-repo-list__muted">updated ${escapeText(relativeTime(updated))}</span>` : ""}
        </div>
        <div class="oldgh-repo-list__counters">
          <span>${octicon("star", { size: 12 })} ${escapeText(count("stargazers"))}</span>
          <span>${octicon("repo-forked", { size: 12 })} ${escapeText(count("forks"))}</span>
        </div>
      </li>
    `;
  }).join("");
  if (!rows) return emptyHtml("This repository has no forks yet.");
  return `<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "forks", page, pageLinks(doc).next !== null)}`;
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

// labels and milestones pages embed the graphql connection they render
async function routeConnection(url: string, route: string, field: string): Promise<{ nodes: Record<string, unknown>[]; total: number }> {
  const payload = readObj(readObj(await loadPagePayload(url))?.["payload"]);
  const connection = readObj(readObj(readObj(readObj(payload?.[route])?.["data"])?.["repository"])?.[field]);
  if (!connection) throw new AdapterFailure("repoList", `${new URL(url).pathname} holds no ${field}`);
  const edges = Array.isArray(connection["edges"]) ? connection["edges"] : [];
  const nodes = edges.map((e) => readObj(readObj(e)?.["node"])).filter((n): n is Record<string, unknown> => n !== null);
  return { nodes, total: readNumber(connection, "totalCount") ?? nodes.length };
}

const LABELS_PER_PAGE = 30;
const MILESTONES_PER_PAGE = 50;

async function renderLabels(owner: string, repo: string, page: number): Promise<string> {
  const { nodes, total } = await routeConnection(`https://github.com/${owner}/${repo}/labels?page=${page}`, "labelsRoute", "labels");
  if (nodes.length === 0) return emptyHtml("No labels.");
  const rows = nodes.map((r) => {
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
  return `<ul class="oldgh-repo-list__label-list">${rows}</ul>${pagerHtml(owner, repo, "labels", page, page * LABELS_PER_PAGE < total)}`;
}

async function renderMilestones(owner: string, repo: string, state: string, page: number): Promise<string> {
  const validState = state === "closed" ? "closed" : "open";
  const { nodes, total } = await routeConnection(
    `https://github.com/${owner}/${repo}/milestones?state=${validState}&page=${page}`,
    "milestonesRoute",
    "milestones",
  );
  const switcher = `
    <div class="oldgh-repo-list__switch">
      <a class="${validState === "open" ? "is-active" : ""}" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/milestones?state=open">Open</a>
      <a class="${validState === "closed" ? "is-active" : ""}" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/milestones?state=closed">Closed</a>
    </div>
  `;
  if (nodes.length === 0) return `${switcher}${emptyHtml(validState === "open" ? "No open milestones." : "No closed milestones.")}`;
  const rows = nodes.map((r) => {
    const title = readString(r, "title") ?? "";
    const milestoneQuery = new URLSearchParams({ q: `is:${validState} milestone:"${title}"` }).toString();
    const open = readNumber(r, "openIssueCount") ?? 0;
    const closed = readNumber(r, "closedIssueCount") ?? 0;
    const pct = Math.round(readNumber(r, "progressPercentage") ?? 0);
    const due = readString(r, "dueOn");
    const desc = readString(r, "description") ?? "";
    return `
      <li class="oldgh-repo-list__milestone">
        <h3 class="oldgh-repo-list__milestone-title">
          <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/issues?${escapeAttr(milestoneQuery)}">${escapeText(title)}</a>
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
  return `${switcher}<ul class="oldgh-repo-list__list">${rows}</ul>${pagerHtml(owner, repo, "milestones", page, page * MILESTONES_PER_PAGE < total, validState)}`;
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
