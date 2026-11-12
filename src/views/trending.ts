import { octicon } from "@/icons";
import { fetchApi } from "@/adapters/rate-limit";
import { adoptBodyRoot, navigationToken } from "./_body";
import { languageColor } from "@/util/language-color";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-trending";

type TrendingRepo = {
  fullName: string;
  ownerLogin: string;
  ownerAvatar: string;
  repoName: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number;
  forks: number;
  starsInPeriod: number | null;
  createdAt: string;
  htmlUrl: string;
};

type TrendingPeriod = "daily" | "weekly" | "monthly";

type TrendingDev = {
  login: string;
  name: string | null;
  avatarUrl: string;
  popRepo: { name: string; href: string | null; description: string | null } | null;
};

export async function mountTrending(pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;

  const params = new URLSearchParams(search);
  const period: TrendingPeriod = (params.get("since") as TrendingPeriod) || "weekly";

  // parse /trending/developers and /trending/{language} from path
  const pathSegs = pathname.split("/").filter(Boolean);
  const isDevelopers = pathSegs[1] === "developers";
  const pathLanguage = !isDevelopers && pathSegs[1] ? decodeURIComponent(pathSegs[1]) : "";
  const language = params.get("language") ?? pathLanguage;

  root.innerHTML = renderShell(period, language, isDevelopers);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-trending__list-wrap");
  if (!main) return;

  try {
    if (isDevelopers) {
      const devs = await fetchDevelopers(period);
      main.innerHTML = renderDevList(devs);
    } else {
      const items = await fetchTrending(period, language);
      main.innerHTML = renderList(items);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate-?limit|status 40[39]|status 429/i.test(msg)) {
      main.innerHTML = `
        <div class="oldgh-trending__empty">
          ${octicon("clock", { size: 36 })}
          <p>You've hit GitHub's API rate limit. Trending works again within the hour, or <a href="javascript:void(0)" data-oldgh-open-options>add a token in options</a> for a higher limit.</p>
          <p><a href="https://github.com/trending${isDevelopers ? "/developers" : language ? `/${encodeURIComponent(language)}` : ""}?since=${encodeURIComponent(period)}">Open trending on modern GitHub</a></p>
        </div>
      `;
      return;
    }
    main.innerHTML = `<div class="oldgh-trending__empty">Couldn't load trending: ${escapeText(msg)}</div>`;
  }
}

async function fetchTrending(period: TrendingPeriod, language: string): Promise<TrendingRepo[]> {
  const scraped = await scrapeTrendingHtml(period, language);
  if (scraped.length > 0) return scraped;
  return await searchTrendingFallback(period, language);
}

async function scrapeTrendingHtml(period: TrendingPeriod, language: string): Promise<TrendingRepo[]> {
  const path = language ? `/trending/${encodeURIComponent(language)}` : "/trending";
  const url = `https://github.com${path}?since=${encodeURIComponent(period)}`;
  try {
    const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
    if (!resp.ok) return [];
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = doc.querySelectorAll<HTMLElement>("article.Box-row");
    const out: TrendingRepo[] = [];
    for (const row of Array.from(rows)) {
      const heading = row.querySelector<HTMLAnchorElement>("h2 a, h3 a");
      const href = heading?.getAttribute("href") || "";
      if (!href) continue;
      const slug = href.replace(/^\/+/, "");
      const [owner, repoName] = slug.split("/");
      if (!owner || !repoName) continue;
      const description = row.querySelector<HTMLElement>("p.col-9, p.color-fg-muted.my-1")?.textContent?.trim() || null;
      const langEl = row.querySelector<HTMLElement>("[itemprop='programmingLanguage']");
      const language = langEl?.textContent?.trim() || null;
      const dot = row.querySelector<HTMLElement>(".repo-language-color");
      const languageColor = dot?.style.backgroundColor || null;
      const starsAnchor = row.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${repoName}/stargazers"]`);
      const forksAnchor = row.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${repoName}/forks"]`);
      const momentumEl = row.querySelector<HTMLElement>(".float-sm-right, .d-inline-block.float-sm-right");
      const momentum = momentumEl?.textContent?.trim() || "";
      let starsInPeriod = parseShortCount((momentum.match(/^([\d,.]+\s*[km]?)/i)?.[1] ?? "").replace(/[\s,]/g, ""));
      // fallback: the momentum count also lives in the textual "N stars today/this
      // week/month" span next to an octicon-star, which the float-only path misses
      if (starsInPeriod === null) {
        const starText =
          row.querySelector<HTMLElement>("svg.octicon-star")?.parentElement?.textContent?.trim() || momentum;
        starsInPeriod = parseShortCount(
          (starText.match(/([\d,.]+\s*[km]?)\s*stars?\s+(?:today|this\s+(?:week|month))/i)?.[1] ?? "").replace(/[\s,]/g, ""),
        );
      }
      out.push({
        fullName: `${owner}/${repoName}`,
        ownerLogin: owner,
        ownerAvatar: `https://avatars.githubusercontent.com/${owner}`,
        repoName,
        description,
        language,
        languageColor,
        stars: parseShortCount(starsAnchor?.textContent || "") ?? 0,
        forks: parseShortCount(forksAnchor?.textContent || "") ?? 0,
        starsInPeriod,
        createdAt: "",
        htmlUrl: `https://github.com/${owner}/${repoName}`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

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

async function fetchDevelopers(period: TrendingPeriod): Promise<TrendingDev[]> {
  const resp = await fetch(`https://github.com/trending/developers?since=${encodeURIComponent(period)}`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) return [];
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll<HTMLElement>("article.Box-row");
  const out: TrendingDev[] = [];
  for (const row of Array.from(rows)) {
    const avatarImg = row.querySelector<HTMLImageElement>("img.avatar-user, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || "";
    const linkAnchors = Array.from(row.querySelectorAll<HTMLAnchorElement>("a[href^='/']"));
    const userLink = linkAnchors.find((a) => /^\/[\w.-]+\/?$/.test(a.getAttribute("href") || ""));
    const loginHref = userLink?.getAttribute("href") || "";
    const login = loginHref.replace(/^\/+|\/+$/g, "");
    if (!login) continue;
    const nameEl = row.querySelector<HTMLElement>(".h3 a, .lh-condensed a");
    const nameText = nameEl?.textContent?.trim() || null;
    const popRepoAnchor = row.querySelector<HTMLAnchorElement>(".h4 a, [data-hovercard-type='repository']");
    let popRepo: TrendingDev["popRepo"] = null;
    if (popRepoAnchor) {
      const repoName = popRepoAnchor.textContent?.trim() || "";
      const desc = row.querySelector<HTMLElement>(".f6.color-fg-muted, p.color-fg-muted")?.textContent?.trim() || null;
      // capture the anchor's real href; the popular repo can belong to another
      // owner/org, so reconstructing /login/name 404s
      const popRepoHref = popRepoAnchor.getAttribute("href") || null;
      if (repoName) popRepo = { name: repoName, href: popRepoHref, description: desc };
    }
    out.push({ login, name: nameText && nameText !== login ? nameText : null, avatarUrl, popRepo });
  }
  return out;
}

function renderDevList(devs: TrendingDev[]): string {
  if (devs.length === 0) {
    return `<div class="oldgh-trending__empty">No trending developers found.</div>`;
  }
  return `
    <ol class="oldgh-trending__dev-list">
      ${devs.map((d, i) => `
        <li class="oldgh-trending__dev-row">
          <span class="oldgh-trending__rank">#${i + 1}</span>
          <a class="oldgh-trending__dev-avatar" href="/${escapeAttr(d.login)}" aria-label="View ${escapeAttr(d.login)}'s profile">
            <img src="${escapeAttr(d.avatarUrl)}" width="48" height="48" alt="" />
          </a>
          <div class="oldgh-trending__dev-main">
            <div class="oldgh-trending__dev-name">
              ${d.name ? `<a href="/${escapeAttr(d.login)}"><strong>${escapeText(d.name)}</strong></a>` : ""}
              <a class="oldgh-trending__dev-login" href="/${escapeAttr(d.login)}">${escapeText(d.login)}</a>
            </div>
            ${d.popRepo && d.popRepo.href ? `
              <div class="oldgh-trending__dev-repo">
                ${octicon("repo", { size: 12 })}
                <a href="${escapeAttr(d.popRepo.href)}">${escapeText(d.popRepo.name)}</a>
                ${d.popRepo.description ? `<span class="oldgh-trending__dev-pop-desc">${escapeText(d.popRepo.description)}</span>` : ""}
              </div>
            ` : ""}
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

async function searchTrendingFallback(period: TrendingPeriod, language: string): Promise<TrendingRepo[]> {
  const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let q = `created:>${since}`;
  if (language) q += ` language:${language}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=25`;
  const resp = await fetchApi(url, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
  if (!resp.ok) {
    if (resp.status === 403 || resp.status === 429) throw new Error(`rate-limited (status ${resp.status})`);
    throw new Error(`status ${resp.status}`);
  }
  const data = (await resp.json()) as { items?: unknown[] };
  return (data.items ?? []).map(parseRepo).filter((r): r is TrendingRepo => r !== null);
}

function parseRepo(raw: unknown): TrendingRepo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fullName = typeof r["full_name"] === "string" ? (r["full_name"] as string) : null;
  if (!fullName) return null;
  const owner = r["owner"] && typeof r["owner"] === "object" ? (r["owner"] as Record<string, unknown>) : null;
  return {
    fullName,
    ownerLogin: (owner && typeof owner["login"] === "string" ? (owner["login"] as string) : fullName.split("/")[0]) ?? "",
    ownerAvatar: (owner && typeof owner["avatar_url"] === "string" ? (owner["avatar_url"] as string) : "") ?? "",
    repoName: (typeof r["name"] === "string" ? (r["name"] as string) : fullName.split("/")[1]) ?? "",
    description: typeof r["description"] === "string" ? (r["description"] as string) : null,
    language: typeof r["language"] === "string" ? (r["language"] as string) : null,
    languageColor: null,
    stars: typeof r["stargazers_count"] === "number" ? (r["stargazers_count"] as number) : 0,
    forks: typeof r["forks_count"] === "number" ? (r["forks_count"] as number) : 0,
    starsInPeriod: null,
    createdAt: typeof r["created_at"] === "string" ? (r["created_at"] as string) : "",
    htmlUrl: (typeof r["html_url"] === "string" ? (r["html_url"] as string) : `https://github.com/${fullName}`),
  };
}

function renderShell(period: TrendingPeriod, language: string, isDevelopers: boolean): string {
  const periodTabs: Array<{ key: TrendingPeriod; label: string }> = [
    { key: "daily", label: "Today" },
    { key: "weekly", label: "This week" },
    { key: "monthly", label: "This month" },
  ];
  const baseHref = isDevelopers ? "/trending/developers" : "/trending";
  const periodLinks = periodTabs.map((t) => {
    const href = `${baseHref}?since=${t.key}${!isDevelopers && language ? `&language=${encodeURIComponent(language)}` : ""}`;
    return `<a class="${period === t.key ? "is-active" : ""}" href="${href}">${escapeText(t.label)}</a>`;
  }).join("");
  return `
    <div class="oldgh-page">
      <header class="oldgh-trending__header">
        <h1>Trending ${isDevelopers ? "Developers" : "Repositories"}</h1>
        <p class="oldgh-trending__sub">See what the GitHub community is most excited about ${escapeText(period === "daily" ? "today" : period === "weekly" ? "this week" : "this month")}.</p>
      </header>
      <div class="oldgh-trending__type-switch">
        <a class="${!isDevelopers ? "is-active" : ""}" href="/trending?since=${encodeURIComponent(period)}${language ? `&language=${encodeURIComponent(language)}` : ""}">Repositories</a>
        <a class="${isDevelopers ? "is-active" : ""}" href="/trending/developers?since=${encodeURIComponent(period)}">Developers</a>
      </div>
      <div class="oldgh-trending__bar">
        <nav class="oldgh-trending__tabs">
          ${periodLinks}
        </nav>
        ${!isDevelopers ? `
        <form class="oldgh-trending__lang" action="/trending" method="get">
          <input type="hidden" name="since" value="${escapeAttr(period)}" />
          <label>Language: <input name="language" value="${escapeAttr(language)}" placeholder="any" /></label>
          <button type="submit" class="oldgh-btn">Filter</button>
        </form>` : ""}
      </div>
      <div class="oldgh-trending__list-wrap">
        <div class="oldgh-trending__loading">Loading trending ${isDevelopers ? "developers" : "repositories"}…</div>
      </div>
    </div>
  `;
}

function renderList(items: TrendingRepo[]): string {
  if (items.length === 0) {
    return `<div class="oldgh-trending__empty">No matching repositories found.</div>`;
  }
  return `
    <ol class="oldgh-trending__list">
      ${items.map((r, i) => renderRow(r, i + 1)).join("")}
    </ol>
  `;
}

function renderRow(r: TrendingRepo, rank: number): string {
  const langDot = r.language
    ? `<li><span class="oldgh-search__lang-dot" style="background:${r.languageColor || languageColor(r.language)}"></span>${escapeText(r.language)}</li>`
    : "";
  const periodLine = r.starsInPeriod && r.starsInPeriod > 0
    ? `<li class="oldgh-trending__momentum">${octicon("star", { size: 12 })} ${formatCount(r.starsInPeriod)} star${r.starsInPeriod === 1 ? "" : "s"} this period</li>`
    : r.createdAt
      ? `<li>Created ${escapeText(formatDate(r.createdAt))}</li>`
      : "";
  return `
    <li class="oldgh-trending__row">
      <span class="oldgh-trending__rank">#${rank}</span>
      <div class="oldgh-trending__main">
        <h2 class="oldgh-trending__name">
          <img class="oldgh-trending__avatar" src="${escapeAttr(r.ownerAvatar)}" width="20" height="20" alt="" />
          <a href="/${escapeAttr(r.ownerLogin)}">${escapeText(r.ownerLogin)}</a> /
          <a href="/${escapeAttr(r.ownerLogin)}/${escapeAttr(r.repoName)}"><strong>${escapeText(r.repoName)}</strong></a>
        </h2>
        ${r.description ? `<p class="oldgh-trending__desc">${escapeText(r.description)}</p>` : ""}
        <ul class="oldgh-trending__meta">
          ${langDot}
          <li>${octicon("star", { size: 12 })} ${formatCount(r.stars)}</li>
          <li>${octicon("repo-forked", { size: 12 })} ${formatCount(r.forks)}</li>
          ${periodLine}
        </ul>
      </div>
    </li>
  `;
}

import { formatCount } from "@/util/format";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
