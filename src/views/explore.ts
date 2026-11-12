import { octicon } from "@/icons";
import { languageColor as languageColorFor } from "@/util/language-color";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-explore";

type TrendingRepo = {
  slug: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number;
  starsInPeriod: number | null;
};

type TrendingDev = {
  login: string;
  name: string | null;
  avatarUrl: string;
  popRepo: { name: string; href: string | null; description: string | null } | null;
};

const CURATED_TOPICS: { slug: string; label: string }[] = [
  { slug: "react", label: "React" },
  { slug: "vue", label: "Vue" },
  { slug: "typescript", label: "TypeScript" },
  { slug: "rust", label: "Rust" },
  { slug: "go", label: "Go" },
  { slug: "python", label: "Python" },
  { slug: "machine-learning", label: "Machine Learning" },
  { slug: "game-engine", label: "Game Engine" },
  { slug: "static-site-generator", label: "Static Site Generator" },
  { slug: "kubernetes", label: "Kubernetes" },
  { slug: "graphql", label: "GraphQL" },
  { slug: "wasm", label: "WebAssembly" },
];

const CURATED_COLLECTIONS: { slug: string; label: string; tagline: string }[] = [
  { slug: "made-in-africa", label: "Made in Africa", tagline: "Software is being built all over the African continent." },
  { slug: "learn-to-code", label: "Learn to code", tagline: "Resources from the open source community to make it easier to learn." },
  { slug: "music", label: "Music", tagline: "Open-source tools for making, learning about, and remixing music." },
  { slug: "game-off", label: "Game Off", tagline: "Game jams that bring together the open-source gaming community." },
];

export async function mountExplore(): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell();
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const repoSlot = root.querySelector<HTMLElement>(".oldgh-explore__trending-repos");
  const devSlot = root.querySelector<HTMLElement>(".oldgh-explore__trending-devs");

  const [repos, devs] = await Promise.all([
    fetchTrendingRepos().catch(() => [] as TrendingRepo[]),
    fetchTrendingDevs().catch(() => [] as TrendingDev[]),
  ]);

  if (repoSlot) repoSlot.innerHTML = renderRepos(repos);
  if (devSlot) devSlot.innerHTML = renderDevs(devs);
}

function renderShell(): string {
  const topics = CURATED_TOPICS.map(
    (t) => `<a class="oldgh-explore__topic" href="/topics/${encodeURIComponent(t.slug)}">${escapeText(t.label)}</a>`,
  ).join("");
  const collections = CURATED_COLLECTIONS.map(
    (c) => `
      <li class="oldgh-explore__collection">
        <a class="oldgh-explore__collection-link" href="/collections/${encodeURIComponent(c.slug)}">
          <strong>${escapeText(c.label)}</strong>
          <span>${escapeText(c.tagline)}</span>
        </a>
      </li>
    `,
  ).join("");

  return `
    <div class="oldgh-page oldgh-explore__page">
      <header class="oldgh-explore__hero">
        <h1>Discover great projects</h1>
        <p>Find your next read, contribute, or just bookmark something cool. These are picked from GitHub's public trending.</p>
        <nav class="oldgh-explore__nav">
          <a href="/explore" class="is-active">${octicon("telescope", { size: 14 })}<span>Explore</span></a>
          <a href="/topics">${octicon("tag", { size: 14 })}<span>Topics</span></a>
          <a href="/trending">${octicon("flame", { size: 14 })}<span>Trending</span></a>
          <a href="/collections">${octicon("bookmark", { size: 14 })}<span>Collections</span></a>
        </nav>
      </header>

      <div class="oldgh-explore__layout">
        <main class="oldgh-explore__main">
          <section class="oldgh-explore__section">
            <header class="oldgh-explore__section-head">
              <h2>${octicon("flame", { size: 16 })} Trending repositories <span class="oldgh-explore__period">this week</span></h2>
              <a class="oldgh-explore__more" href="/trending?since=weekly">See more &rsaquo;</a>
            </header>
            <div class="oldgh-explore__trending-repos">
              <div class="oldgh-explore__loading">Loading trending repositories&hellip;</div>
            </div>
          </section>

          <section class="oldgh-explore__section">
            <header class="oldgh-explore__section-head">
              <h2>${octicon("person", { size: 16 })} Trending developers <span class="oldgh-explore__period">this week</span></h2>
              <a class="oldgh-explore__more" href="/trending/developers?since=weekly">See more &rsaquo;</a>
            </header>
            <div class="oldgh-explore__trending-devs">
              <div class="oldgh-explore__loading">Loading trending developers&hellip;</div>
            </div>
          </section>
        </main>

        <aside class="oldgh-explore__rail">
          <div class="oldgh-explore__rail-box">
            <h3>${octicon("tag", { size: 14 })} Popular topics</h3>
            <div class="oldgh-explore__topics">${topics}</div>
          </div>
          <div class="oldgh-explore__rail-box">
            <h3>${octicon("bookmark", { size: 14 })} Featured collections</h3>
            <ul class="oldgh-explore__collections">${collections}</ul>
          </div>
          <div class="oldgh-explore__rail-box oldgh-explore__protip">
            <h3>${octicon("light-bulb", { size: 14 })} ProTip</h3>
            <p>Browse <a href="/marketplace">Marketplace</a> for apps and actions that automate work — code review, deployments, dependency upgrades, the lot.</p>
          </div>
        </aside>
      </div>
    </div>
  `;
}

async function fetchTrendingRepos(): Promise<TrendingRepo[]> {
  const resp = await fetch("https://github.com/trending?since=weekly", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) return [];
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll<HTMLElement>("article.Box-row");
  const out: TrendingRepo[] = [];
  for (const row of Array.from(rows).slice(0, 8)) {
    const a = row.querySelector<HTMLAnchorElement>("h2 a, h3 a");
    const href = a?.getAttribute("href") || "";
    if (!href) continue;
    const slug = href.replace(/^\/+/, "");
    const [owner, name] = slug.split("/");
    if (!owner || !name) continue;
    const description = row.querySelector<HTMLElement>("p.col-9, p.color-fg-muted.my-1")?.textContent?.trim() || null;
    const langEl = row.querySelector<HTMLElement>("[itemprop='programmingLanguage']");
    const language = langEl?.textContent?.trim() || null;
    const dot = row.querySelector<HTMLElement>(".repo-language-color");
    const languageColor = dot?.style.backgroundColor || null;
    const starsAnchor = row.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${name}/stargazers"]`);
    const momentumEl = row.querySelector<HTMLElement>(".float-sm-right, .d-inline-block.float-sm-right");
    const momentum = momentumEl?.textContent?.trim() || "";
    const starsInPeriod = parseCount((momentum.match(/^([\d,.]+\s*[km]?)/i)?.[1] ?? "").replace(/[\s,]/g, ""));
    out.push({
      slug: `${owner}/${name}`,
      owner,
      name,
      description,
      language,
      languageColor,
      stars: parseCount(starsAnchor?.textContent || "") ?? 0,
      starsInPeriod,
    });
  }
  return out;
}

async function fetchTrendingDevs(): Promise<TrendingDev[]> {
  const resp = await fetch("https://github.com/trending/developers?since=weekly", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) return [];
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll<HTMLElement>("article.Box-row");
  const out: TrendingDev[] = [];
  for (const row of Array.from(rows).slice(0, 8)) {
    const avatarImg = row.querySelector<HTMLImageElement>("img.avatar-user, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || "";
    const loginAnchor = row.querySelector<HTMLAnchorElement>(".h3 a, h1.h3 a, .lh-condensed a");
    const nameAnchor = row.querySelector<HTMLAnchorElement>(".h3 a, .Link--secondary[href]");
    const linkAnchors = Array.from(row.querySelectorAll<HTMLAnchorElement>("a[href^='/']"));
    const userLink = linkAnchors.find((a) => /^\/[\w.-]+\/?$/.test(a.getAttribute("href") || ""));
    const href = userLink?.getAttribute("href") || loginAnchor?.getAttribute("href") || "";
    const login = href.replace(/^\/+|\/+$/g, "");
    if (!login) continue;
    const nameText = nameAnchor?.textContent?.trim() || null;
    const popRepoAnchor = row.querySelector<HTMLAnchorElement>("h1.h4 a, h2.h4 a, .h4 a, [data-hovercard-type='repository']");
    let popRepo: TrendingDev["popRepo"] = null;
    if (popRepoAnchor) {
      const repoName = popRepoAnchor.textContent?.trim() || "";
      // walk every muted text element under the row and accept the first one
      // that's actually a sentence — earlier we accepted star counts ("1") as
      // the description since they share the .f6.color-fg-muted class.
      let desc: string | null = null;
      for (const el of Array.from(row.querySelectorAll<HTMLElement>(".f6.color-fg-muted, p.color-fg-muted, p.text-gray, p.col-9"))) {
        const t = el.textContent?.replace(/\s+/g, " ").trim() || "";
        if (!t) continue;
        if (/^\d[\d.,kKmM ]*$/.test(t)) continue;
        if (t.length < 6) continue;
        if (/There was an error while loading/i.test(t)) continue;
        desc = t;
        break;
      }
      // capture the anchor's real href; the popular repo can belong to another
      // owner/org, so reconstructing /login/name 404s
      const popRepoHref = popRepoAnchor.getAttribute("href") || null;
      if (repoName) popRepo = { name: repoName, href: popRepoHref, description: desc };
    }
    out.push({ login, name: nameText && nameText !== login ? nameText : null, avatarUrl, popRepo });
  }
  return out;
}

function renderRepos(items: TrendingRepo[]): string {
  if (items.length === 0) {
    return `<p class="oldgh-explore__empty">Couldn't load trending repositories.</p>`;
  }
  return `
    <ol class="oldgh-explore__repos">
      ${items.map((r) => `
        <li class="oldgh-explore__repo">
          <div class="oldgh-explore__repo-head">
            <h3>
              ${octicon("repo", { size: 14 })}
              <a href="/${escapeAttr(r.owner)}">${escapeText(r.owner)}</a> /
              <a href="/${escapeAttr(r.owner)}/${escapeAttr(r.name)}"><strong>${escapeText(r.name)}</strong></a>
            </h3>
            ${r.starsInPeriod ? `<span class="oldgh-explore__momentum">${octicon("star", { size: 11 })} +${formatCount(r.starsInPeriod)} this week</span>` : ""}
          </div>
          ${r.description ? `<p class="oldgh-explore__repo-desc">${escapeText(r.description)}</p>` : ""}
          <div class="oldgh-explore__repo-meta">
            ${r.language ? `<span><span class="oldgh-search__lang-dot" style="background:${r.languageColor || languageColorFor(r.language)}"></span>${escapeText(r.language)}</span>` : ""}
            <span>${octicon("star", { size: 12 })} ${formatCount(r.stars)}</span>
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderDevs(items: TrendingDev[]): string {
  if (items.length === 0) {
    return `<p class="oldgh-explore__empty">Couldn't load trending developers.</p>`;
  }
  return `
    <ol class="oldgh-explore__devs">
      ${items.map((d) => `
        <li class="oldgh-explore__dev">
          <a class="oldgh-explore__dev-avatar" href="/${escapeAttr(d.login)}" aria-label="View ${escapeAttr(d.login)}'s profile">
            <img src="${escapeAttr(d.avatarUrl)}" width="48" height="48" alt="" />
          </a>
          <div class="oldgh-explore__dev-main">
            <div class="oldgh-explore__dev-name">
              ${d.name ? `<a href="/${escapeAttr(d.login)}"><strong>${escapeText(d.name)}</strong></a>` : ""}
              <a class="oldgh-explore__dev-login" href="/${escapeAttr(d.login)}">${escapeText(d.login)}</a>
            </div>
            ${d.popRepo ? `
              <div class="oldgh-explore__dev-repo">
                <span class="oldgh-explore__dev-pop-label">Popular repo</span>
                <a href="${escapeAttr(d.popRepo.href || `/${d.login}/${d.popRepo.name}`)}">${escapeText(d.popRepo.name)}</a>
                ${d.popRepo.description ? `<span class="oldgh-explore__dev-pop-desc">${escapeText(d.popRepo.description)}</span>` : ""}
              </div>
            ` : ""}
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

function parseCount(s: string): number | null {
  const trimmed = s.replace(/[\s,]/g, "").toLowerCase();
  const m = /^([\d.]+)([km])?$/.exec(trimmed);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return null;
  if (m[2] === "k") return Math.round(n * 1000);
  if (m[2] === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}

import { formatCount } from "@/util/format";
