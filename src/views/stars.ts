import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { currentUserLogin } from "@/auth/session";
import { fetchApi } from "@/adapters/rate-limit";
import { languageColor } from "@/util/language-color";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-stars";

type StarredRepo = {
  fullName: string;
  ownerLogin: string;
  ownerAvatar: string;
  repoName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  // scraper path can't read star/fork counts, so omit them instead of claiming 0
  hasCounts: boolean;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  htmlUrl: string;
  updatedAt: string;
  starredAt: string;
  topics: string[];
};

export async function mountStars(pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;

  const segs = pathname.split("/").filter(Boolean);
  const login = segs[0] === "stars" && segs[1] ? segs[1] : currentUserLogin();
  if (!login) {
    root.innerHTML = `
      <div class="oldgh-page">
        <header class="oldgh-stars__header"><h1>Stars</h1></header>
        <p class="oldgh-stars__empty">Sign in to view your starred repositories.</p>
      </div>
    `;
    adoptBodyRoot(root, undefined, nav);
    return;
  }

  const params = new URLSearchParams(search);
  const sort = params.get("sort") ?? "created"; // created = recently starred
  const direction = params.get("direction") ?? "desc";
  const languageFilter = params.get("language") ?? "";

  root.innerHTML = `
    <div class="oldgh-page">
      <header class="oldgh-stars__header">
        <h1>${octicon("star", { size: 22 })} ${escapeText(login)}'s Stars</h1>
        <p class="oldgh-stars__sub">Repositories starred by <a href="/${escapeAttr(login)}">${escapeText(login)}</a></p>
      </header>
      <div class="oldgh-stars__loading">Loading stars…</div>
    </div>
  `;
  if (!adoptBodyRoot(root, undefined, nav)) return;

  try {
    const resp = await fetchApi(`https://api.github.com/users/${encodeURIComponent(login)}/starred?per_page=100&sort=${encodeURIComponent(sort)}&direction=${encodeURIComponent(direction)}`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github.star+json" },
    });
    let items: StarredRepo[] = [];
    if (resp.ok) {
      const data = (await resp.json()) as unknown[];
      items = data.map(parseStarred).filter((s): s is StarredRepo => s !== null);
    }
    // anonymous api can't see PRIVATE starred repos. when the api returns 0
    // (or fails outright), fall back to scraping the cookie-authed page —
    // exactly what /:user?tab=stars does. private starred entries surface
    // from this path so users see what they actually starred.
    if (items.length === 0) {
      const scraped = await scrapeStarredPage(login);
      if (scraped?.length) items = scraped;
      else if (!resp.ok) throw new Error(`GitHub responded ${resp.status}`);
    }
    const loading = root.querySelector(".oldgh-stars__loading");
    if (loading) loading.remove();
    const page = root.querySelector(".oldgh-page");
    if (page) {
      const layout = document.createElement("div");
      layout.className = "oldgh-stars__layout";
      layout.innerHTML = renderLayout(items, { login, sort, direction, languageFilter });
      page.appendChild(layout);
      bindStarsSort(layout);
    }
  } catch (err) {
    const loading = root.querySelector(".oldgh-stars__loading");
    if (loading) loading.textContent = `Couldn't load stars: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function scrapeStarredPage(login: string): Promise<StarredRepo[] | null> {
  try {
    const resp = await fetch(`https://github.com/${encodeURIComponent(login)}?tab=stars`, {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out: StarredRepo[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("h3 a[href^='/']"))) {
      const href = a.getAttribute("href") || "";
      const m = /^\/([\w.-]+)\/([\w.-]+)\/?$/.exec(href);
      if (!m || !m[1] || !m[2]) continue;
      const ownerLogin = m[1];
      const repoName = m[2];
      const fullName = `${ownerLogin}/${repoName}`;
      if (seen.has(fullName)) continue;
      seen.add(fullName);
      const card: Element = a.closest("article, li, .Box-row, [class*='border-bottom'], div.py-3, div.py-4") || a.parentElement?.parentElement || a.parentElement || a;
      const descEls = Array.from(card.querySelectorAll<HTMLElement>(".pinned-item-desc, p[itemprop='description'], p.color-fg-muted, h3 + p, h3 + div p"));
      let description: string | null = null;
      for (const el of descEls) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        if (/There was an error while loading/i.test(t)) continue;
        if (/^Loading\.?\.?\.?$/i.test(t)) continue;
        description = t;
        break;
      }
      const langText =
        card.querySelector<HTMLElement>("[itemprop='programmingLanguage']")?.textContent?.replace(/\s+/g, " ").trim() ||
        null;
      const isPrivate = !!card.querySelector(".Label[title='Private' i], svg.octicon-lock");
      const timeEl = card.querySelector<HTMLElement>("relative-time, time-ago, time");
      const updatedAt = timeEl?.getAttribute("datetime") || "";
      out.push({
        fullName,
        ownerLogin,
        ownerAvatar: `https://github.com/${ownerLogin}.png?size=40`,
        repoName,
        description,
        language: langText,
        stars: 0,
        forks: 0,
        hasCounts: false,
        isPrivate,
        isFork: false,
        isArchived: false,
        htmlUrl: `https://github.com${href}`,
        updatedAt,
        starredAt: "",
        topics: [],
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

type StarsCtx = { login: string; sort: string; direction: string; languageFilter: string };

function renderLayout(items: StarredRepo[], ctx: StarsCtx): string {
  const filtered = ctx.languageFilter
    ? items.filter((r) => (r.language || "Unknown").toLowerCase() === ctx.languageFilter.toLowerCase())
    : items;
  const langCounts = new Map<string, number>();
  for (const it of items) {
    const k = it.language || "Unknown";
    langCounts.set(k, (langCounts.get(k) ?? 0) + 1);
  }
  const sortedLangs = Array.from(langCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const filterHref = (language: string | null) => {
    const params = new URLSearchParams({ sort: ctx.sort, direction: ctx.direction });
    if (language) params.set("language", language);
    return `/stars/${encodeURIComponent(ctx.login)}?${params}`;
  };

  return `
    <aside class="oldgh-stars__sidebar">
      <div class="oldgh-stars__sidebox">
        <h3>${octicon("flame", { size: 14 })} Stats</h3>
        <ul class="oldgh-stars__stats">
          <li><strong>${items.length}</strong> ${items.length === 1 ? "repository" : "repositories"} starred</li>
          <li><strong>${langCounts.size}</strong> ${langCounts.size === 1 ? "language" : "languages"}</li>
        </ul>
      </div>
      ${sortedLangs.length > 0 ? `
        <div class="oldgh-stars__sidebox">
          <h3>${octicon("code", { size: 14 })} Languages</h3>
          <ul class="oldgh-stars__lang-list">
            ${ctx.languageFilter ? `<li><a href="${escapeAttr(filterHref(null))}">${octicon("x", { size: 12 })} Clear filter</a></li>` : ""}
            ${sortedLangs.map(([lang, count]) => `
              <li class="${ctx.languageFilter.toLowerCase() === lang.toLowerCase() ? "is-active" : ""}">
                <a href="${escapeAttr(filterHref(lang))}">
                  ${lang !== "Unknown" ? `<span class="oldgh-search__lang-dot" style="background:${languageColor(lang)}"></span>` : ""}
                  ${escapeText(lang)}
                  <span class="oldgh-stars__lang-count">${count}</span>
                </a>
              </li>
            `).join("")}
          </ul>
        </div>
      ` : ""}
    </aside>
    <main class="oldgh-stars__main">
      <div class="oldgh-stars__bar">
        <div class="oldgh-stars__count">
          <strong>${filtered.length}</strong> ${filtered.length === 1 ? "result" : "results"}
          ${ctx.languageFilter ? ` · filtered by <strong>${escapeText(ctx.languageFilter)}</strong>` : ""}
        </div>
        <label class="oldgh-stars__sort">
          <span>Sort:</span>
          <select data-oldgh-stars-sort>
            <option value="created:desc"${ctx.sort === "created" && ctx.direction === "desc" ? " selected" : ""}>Recently starred</option>
            <option value="created:asc"${ctx.sort === "created" && ctx.direction === "asc" ? " selected" : ""}>Earliest starred</option>
            <option value="updated:desc"${ctx.sort === "updated" ? " selected" : ""}>Recently active</option>
          </select>
        </label>
      </div>
      ${items.length === 100 ? `<p class="oldgh-stars__notice">${octicon("info", { size: 14 })} Showing the first 100 starred repositories.</p>` : ""}
      ${renderList(filtered, !!ctx.languageFilter)}
    </main>
  `;
}

function bindStarsSort(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("select[data-oldgh-stars-sort]");
  if (!select) return;
  select.addEventListener("change", () => {
    const [sort, direction] = select.value.split(":");
    const params = new URLSearchParams(window.location.search);
    if (sort) params.set("sort", sort);
    if (direction) params.set("direction", direction);
    const href = `${window.location.pathname}?${params.toString()}`;
    history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function parseStarred(raw: unknown): StarredRepo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // star+json wraps: { starred_at, repo }
  const repoMaybe = r["repo"];
  const repoObj = repoMaybe && typeof repoMaybe === "object" ? (repoMaybe as Record<string, unknown>) : r;
  const fullName = typeof repoObj["full_name"] === "string" ? (repoObj["full_name"] as string) : null;
  if (!fullName) return null;
  const owner = repoObj["owner"] && typeof repoObj["owner"] === "object" ? (repoObj["owner"] as Record<string, unknown>) : null;
  const license = repoObj["license"] && typeof repoObj["license"] === "object" ? (repoObj["license"] as Record<string, unknown>) : null;
  void license;
  return {
    fullName,
    ownerLogin: (owner && typeof owner["login"] === "string" ? (owner["login"] as string) : fullName.split("/")[0]) ?? "",
    ownerAvatar: (owner && typeof owner["avatar_url"] === "string" ? (owner["avatar_url"] as string) : "") ?? "",
    repoName: (typeof repoObj["name"] === "string" ? (repoObj["name"] as string) : fullName.split("/")[1]) ?? "",
    description: typeof repoObj["description"] === "string" ? (repoObj["description"] as string) : null,
    language: typeof repoObj["language"] === "string" ? (repoObj["language"] as string) : null,
    stars: typeof repoObj["stargazers_count"] === "number" ? (repoObj["stargazers_count"] as number) : 0,
    forks: typeof repoObj["forks_count"] === "number" ? (repoObj["forks_count"] as number) : 0,
    hasCounts: true,
    isPrivate: repoObj["private"] === true,
    isFork: repoObj["fork"] === true,
    isArchived: repoObj["archived"] === true,
    htmlUrl: (typeof repoObj["html_url"] === "string" ? (repoObj["html_url"] as string) : `https://github.com/${fullName}`),
    updatedAt: typeof repoObj["updated_at"] === "string" ? (repoObj["updated_at"] as string) : "",
    starredAt: typeof r["starred_at"] === "string" ? (r["starred_at"] as string) : "",
    topics: Array.isArray(repoObj["topics"]) ? (repoObj["topics"] as unknown[]).filter((t): t is string => typeof t === "string") : [],
  };
}

function renderList(items: StarredRepo[], isFiltered: boolean): string {
  if (items.length === 0) {
    const msg = isFiltered ? "No starred repositories match this language." : "No starred repositories yet.";
    return `<p class="oldgh-stars__empty">${octicon("star", { size: 36 })} ${msg}</p>`;
  }
  return `
    <ul class="oldgh-stars__list">
      ${items.map(renderRow).join("")}
    </ul>
  `;
}

function renderRow(r: StarredRepo): string {
  return `
    <li class="oldgh-stars__row">
      <h2 class="oldgh-stars__name">
        <img class="oldgh-stars__avatar" src="${escapeAttr(r.ownerAvatar)}" width="20" height="20" alt="" />
        <a href="/${escapeAttr(r.ownerLogin)}">${escapeText(r.ownerLogin)}</a> /
        <a href="/${escapeAttr(r.ownerLogin)}/${escapeAttr(r.repoName)}"><strong>${escapeText(r.repoName)}</strong></a>
        ${r.isPrivate ? `<span class="oldgh-search__tag">Private</span>` : ""}
        ${r.isFork ? `<span class="oldgh-search__tag">Fork</span>` : ""}
        ${r.isArchived ? `<span class="oldgh-search__tag oldgh-search__tag--warn">Archived</span>` : ""}
      </h2>
      ${r.description ? `<p class="oldgh-stars__desc">${escapeText(r.description)}</p>` : ""}
      ${r.topics.length > 0 ? `<p class="oldgh-stars__topics">${r.topics.slice(0, 6).map((t) => `<a class="oldgh-search__topic" href="/topics/${escapeAttr(t)}">${escapeText(t)}</a>`).join(" ")}</p>` : ""}
      <ul class="oldgh-stars__meta">
        ${r.language ? `<li><span class="oldgh-search__lang-dot" style="background:${languageColor(r.language)}"></span>${escapeText(r.language)}</li>` : ""}
        ${r.hasCounts ? `<li>${octicon("star", { size: 12 })} ${formatCount(r.stars)}</li>` : ""}
        ${r.hasCounts ? `<li>${octicon("repo-forked", { size: 12 })} ${formatCount(r.forks)}</li>` : ""}
        ${r.starredAt ? `<li>Starred ${escapeText(formatDate(r.starredAt))}</li>` : ""}
        ${r.updatedAt ? `<li>Updated ${escapeText(formatDate(r.updatedAt))}</li>` : ""}
      </ul>
    </li>
  `;
}

import { formatCount } from "@/util/format";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
