import { octicon } from "@/icons";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-collections";

type CollectionSummary = {
  slug: string;
  title: string;
  tagline: string | null;
  iconUrl: string | null;
};

type CollectionRepo = {
  slug: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  blurb: string | null; // collection-specific commentary
};

type CollectionDetail = {
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  createdBy: string | null;
  createdByLogin: string | null;
  repos: CollectionRepo[];
};

export async function mountCollections(pathname: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const segs = pathname.split("/").filter(Boolean);
  const slug = segs[1] || "";

  if (!slug) {
    root.innerHTML = renderIndexShell();
    try {
      const list = await fetchCollectionsIndex();
      const main = root.querySelector<HTMLElement>(".oldgh-collections__index-slot");
      if (main) main.innerHTML = renderIndex(list);
    } catch (err) {
      const main = root.querySelector<HTMLElement>(".oldgh-collections__index-slot");
      if (main) main.innerHTML = `<div class="oldgh-collections__empty">Couldn't load collections: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
    }
    return;
  }

  root.innerHTML = renderDetailShell(slug);
  try {
    const detail = await fetchCollection(slug);
    const main = root.querySelector<HTMLElement>(".oldgh-collections__detail-slot");
    if (main) main.innerHTML = renderDetail(detail);
  } catch (err) {
    const main = root.querySelector<HTMLElement>(".oldgh-collections__detail-slot");
    if (main) main.innerHTML = `<div class="oldgh-collections__empty">Couldn't load collection: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

export function unmountCollections(): void {
  removeAllBodyRoots();
}

async function fetchCollectionsIndex(): Promise<CollectionSummary[]> {
  const resp = await fetch("https://github.com/collections", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) throw new Error(`responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: CollectionSummary[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/collections\/([\w.-]+)$/.exec(href);
    if (!m) continue;
    const slug = m[1]!;
    if (seen.has(slug)) continue;
    const card = a.closest("li, article, .Box, .d-flex") || a;
    const heading = card.querySelector<HTMLElement>("h2, h3, .h2, .h3, .h4");
    const title = (heading?.textContent || a.textContent || slug).trim();
    if (!title || title.length > 80) continue;
    const tagEl = card.querySelector<HTMLElement>("p.f4, p.lead, p.color-fg-muted, p");
    const tagline = tagEl?.textContent?.trim() || null;
    const img = card.querySelector<HTMLImageElement>("img");
    const iconUrl = img?.getAttribute("src") || null;
    seen.add(slug);
    out.push({ slug, title, tagline, iconUrl });
    if (out.length >= 36) break;
  }
  return out;
}

async function fetchCollection(slug: string): Promise<CollectionDetail> {
  const resp = await fetch(`https://github.com/collections/${encodeURIComponent(slug)}`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) throw new Error(`responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const title =
    doc.querySelector<HTMLElement>("h1")?.textContent?.trim() ||
    meta(doc, "og:title") ||
    slug;
  const tagline = meta(doc, "og:description") || null;
  const descEl = doc.querySelector<HTMLElement>(".markdown-body, [data-test-selector*='description'], .blob-wrapper");
  const description = descEl?.textContent?.replace(/\s+/g, " ").trim() || null;
  const createdByEl = doc.querySelector<HTMLAnchorElement>("a[data-hovercard-type='user']");
  const createdBy = createdByEl?.textContent?.trim() || null;
  // a display name can contain spaces, so derive the profile login from the href
  const createdByLogin = /^\/([\w.-]+)\/?$/.exec(createdByEl?.getAttribute("href") || "")?.[1] || null;

  const repos: CollectionRepo[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/([\w.-]+)(?:[?#]|$)/.exec(href);
    if (!m) continue;
    const owner = m[1]!;
    const name = m[2]!;
    if (RESERVED.has(owner)) continue;
    const key = `${owner}/${name}`;
    if (seen.has(key)) continue;
    // The collection page lists curated repos as <article> or LI rows
    const card = a.closest("article, li, .Box, .Box-row, .my-3");
    if (!card) continue;
    if (!card.querySelector(`a[href$="/${owner}/${name}"], a[href*="${owner}/${name}/stargazers"]`)) continue;
    if (card.querySelectorAll("a[href]").length < 2) continue;
    // normalize whitespace like blurb so the desc !== blurb dedup guard matches
    const desc = card.querySelector<HTMLElement>("p.color-fg-muted, p.text-small.color-fg-muted, p")?.textContent?.replace(/\s+/g, " ").trim() || null;
    const langEl = card.querySelector<HTMLElement>("[itemprop='programmingLanguage']");
    // newer markup drops itemprop and puts the name in the text node after the color dot
    const dotSibling = card.querySelector<HTMLElement>(".repo-language-color")?.nextSibling?.textContent?.trim();
    const language = langEl?.textContent?.trim() || dotSibling || null;
    const starsAnchor = card.querySelector<HTMLAnchorElement>(`a[href$="/${owner}/${name}/stargazers"]`);
    const stars = parseShortCount(starsAnchor?.textContent || "");
    // Collection-specific commentary is usually a separate paragraph
    const blurbEl = card.querySelector<HTMLElement>("p.lh-condensed, .markdown-body p, [data-test-selector*='note']");
    const blurb = blurbEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    seen.add(key);
    repos.push({
      slug: key,
      owner,
      name,
      description: desc && desc !== blurb ? desc : null,
      language,
      stars,
      blurb: blurb && blurb.length > 24 ? blurb : null,
    });
    if (repos.length >= 60) break;
  }

  return { slug, title, tagline, description, createdBy, createdByLogin, repos };
}

const RESERVED = new Set([
  "marketplace", "explore", "topics", "collections", "events", "trending",
  "about", "pricing", "features", "contact", "help", "blog", "site",
  "settings", "notifications", "issues", "pulls", "stars", "watching",
  "dashboard", "users", "orgs", "search", "login", "logout", "join",
  "signup", "new", "import", "gist", "gists", "apps", "sponsors",
  "codespaces", "discussions", "security", "advisories", "premium-support",
]);

function meta(doc: Document, name: string): string | null {
  const el = doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`);
  return el?.content?.trim() || null;
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

function renderIndexShell(): string {
  return `
    <div class="oldgh-page oldgh-collections__page">
      <header class="oldgh-collections__hero">
        <h1>${octicon("bookmark", { size: 24 })} Featured Collections</h1>
        <p>Hand-curated lists of repositories grouped by theme — pick one to dig into the open-source community around it.</p>
      </header>
      <div class="oldgh-collections__index-slot">
        <div class="oldgh-collections__loading">Loading collections…</div>
      </div>
    </div>
  `;
}

function renderIndex(list: CollectionSummary[]): string {
  if (list.length === 0) {
    return `<div class="oldgh-collections__empty">No collections to show.</div>`;
  }
  return `
    <ul class="oldgh-collections__grid">
      ${list.map(renderIndexCard).join("")}
    </ul>
  `;
}

function renderIndexCard(c: CollectionSummary): string {
  return `
    <li class="oldgh-collections__card">
      <a class="oldgh-collections__card-link" href="/collections/${escapeAttr(c.slug)}">
        ${c.iconUrl
          ? `<img class="oldgh-collections__card-icon" src="${escapeAttr(c.iconUrl)}" alt="" />`
          : `<span class="oldgh-collections__card-icon-placeholder">${octicon("bookmark", { size: 24 })}</span>`}
        <div>
          <h2 class="oldgh-collections__card-title">${escapeText(c.title)}</h2>
          ${c.tagline ? `<p class="oldgh-collections__card-tagline">${escapeText(c.tagline)}</p>` : ""}
        </div>
      </a>
    </li>
  `;
}

function renderDetailShell(slug: string): string {
  return `
    <div class="oldgh-page oldgh-collections__page">
      <header class="oldgh-collections__back">
        <a href="/collections">${octicon("triangle-left", { size: 14 })} All collections</a>
      </header>
      <div class="oldgh-collections__detail-slot">
        <div class="oldgh-collections__loading">Loading <strong>${escapeText(slug)}</strong>…</div>
      </div>
    </div>
  `;
}

function renderDetail(d: CollectionDetail): string {
  return `
    <header class="oldgh-collections__detail-hero">
      <h1>${octicon("bookmark", { size: 24 })} ${escapeText(d.title)}</h1>
      ${d.tagline ? `<p class="oldgh-collections__detail-tagline">${escapeText(d.tagline)}</p>` : ""}
      ${d.description && d.description !== d.tagline ? `<p class="oldgh-collections__detail-desc">${escapeText(d.description.slice(0, 500))}</p>` : ""}
      ${d.createdBy ? `<p class="oldgh-collections__credit">Curated by ${d.createdByLogin ? `<a href="/${escapeAttr(d.createdByLogin)}">${escapeText(d.createdBy)}</a>` : escapeText(d.createdBy)}</p>` : ""}
    </header>
    <ul class="oldgh-collections__repo-list">
      ${d.repos.length === 0
        ? `<li class="oldgh-collections__empty">No repositories found in this collection.</li>`
        : d.repos.map(renderRepoRow).join("")}
    </ul>
  `;
}

function renderRepoRow(r: CollectionRepo): string {
  const metaItems: string[] = [];
  if (r.language) metaItems.push(`<li>${escapeText(r.language)}</li>`);
  if (r.stars !== null) metaItems.push(`<li>${octicon("star", { size: 11 })} ${r.stars.toLocaleString()}</li>`);
  return `
    <li class="oldgh-collections__repo">
      <h3 class="oldgh-collections__repo-title">
        ${octicon("repo", { size: 14 })}
        <a href="/${escapeAttr(r.owner)}">${escapeText(r.owner)}</a> /
        <a href="/${escapeAttr(r.owner)}/${escapeAttr(r.name)}"><strong>${escapeText(r.name)}</strong></a>
      </h3>
      ${r.description ? `<p class="oldgh-collections__repo-desc">${escapeText(r.description)}</p>` : ""}
      ${r.blurb ? `<blockquote class="oldgh-collections__blurb">${escapeText(r.blurb)}</blockquote>` : ""}
      ${metaItems.length > 0 ? `<ul class="oldgh-collections__repo-meta">${metaItems.join("")}</ul>` : ""}
    </li>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
