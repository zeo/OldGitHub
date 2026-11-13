import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchPageDoc, pageLinks } from "@/adapters/_page";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-releases";

export type Release = {
  tagName: string;
  name: string;
  bodyHtml: string;
  authorLogin: string;
  authorHref: string;
  authorAvatar: string;
  date: string;
  sha: string;
  labels: string[];
  assetsUrl: string;
  assetCount: string;
};

export async function mountRepoReleases(owner: string, repo: string, search: string, tag?: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(tag ? `Release ${tag}` : "Releases");
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-releases__main");
  if (!main) return;
  const base = `https://github.com/${owner}/${repo}/releases`;
  const query = search.replace(/^\?/, "");

  try {
    const doc = await fetchPageDoc(tag ? `${base}/tag/${encodeURIComponent(tag)}` : query ? `${base}?${query}` : base);
    if (tag) {
      const card = doc.querySelector("[data-hpc] .Box");
      const release = card && parseRelease(card);
      if (!release) throw new AdapterFailure("getTagRelease", `release ${tag} not found on the page`);
      main.innerHTML = `
        <nav class="oldgh-releases__back"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases">${octicon("arrow-left", { size: 14 })} All releases</a></nav>
        <ul class="oldgh-releases__list">${renderRelease(owner, repo, release, true)}</ul>
      `;
    } else {
      // each release is its own innermost section; the page wraps them in two outer ones
      const items = Array.from(doc.querySelectorAll("section"))
        .filter((s) => !s.querySelector("section"))
        .map(parseRelease)
        .filter((r): r is Release => r !== null);
      if (items.length === 0) {
        if (!doc.querySelector(".blankslate h2")) throw new AdapterFailure("getReleases", "no releases found on the page");
        main.innerHTML = renderNoReleases(owner, repo);
        return;
      }
      const page = Math.max(1, parseInt(new URLSearchParams(query).get("page") ?? "1", 10) || 1);
      main.innerHTML = `
        <ul class="oldgh-releases__list">${items.map((r, i) => renderRelease(owner, repo, r, i === 0)).join("")}</ul>
        ${renderPager(doc, page)}
      `;
    }
  } catch (err) {
    const what = tag ? `release ${tag}` : "releases";
    main.innerHTML = `<div class="oldgh-releases__empty">Couldn't load ${escapeText(what)}: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
    return;
  }
  for (const details of Array.from(main.querySelectorAll<HTMLDetailsElement>("details[data-assets-url]"))) {
    if (details.open) void loadAssets(details);
    else details.addEventListener("toggle", () => void loadAssets(details), { once: true });
  }
}

function renderNoReleases(owner: string, repo: string): string {
  return `
    <div class="oldgh-releases__empty">
      <p class="oldgh-releases__empty-title">There aren't any releases here.</p>
      <p class="oldgh-releases__empty-hint">Releases are how you ship versions of your project. <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases/new">Draft the first release</a>.</p>
    </div>
  `;
}

export function parseRelease(card: Element): Release | null {
  // release notes can hold their own links, times and labels, so read only the card chrome
  const chrome = <T extends Element>(selector: string): T[] =>
    Array.from(card.querySelectorAll<T>(selector)).filter((el) => !el.closest(".markdown-body"));
  const tree = chrome<HTMLAnchorElement>('a[href*="/tree/"]')[0]?.getAttribute("href") ?? "";
  const tagName = decodeURIComponent(tree.split("/tree/")[1] ?? "");
  if (!tagName) return null;
  const avatar = card.querySelector("img.avatar-small");
  const author = avatar?.nextElementSibling instanceof HTMLAnchorElement ? avatar.nextElementSibling : null;
  const assets = chrome<HTMLElement>("include-fragment[src*='/expanded_assets/'], include-fragment[data-deferred-src*='/expanded_assets/']")[0];
  return {
    tagName,
    name: chrome(":is(span.f1, h1)")[0]?.textContent?.trim() || tagName,
    bodyHtml: card.querySelector(".markdown-body")?.innerHTML ?? "",
    authorLogin: author?.textContent?.trim() ?? "",
    authorHref: author?.getAttribute("href") ?? "",
    authorAvatar: avatar?.getAttribute("src") ?? "",
    date: chrome("relative-time[datetime]")[0]?.getAttribute("datetime") ?? "",
    sha: chrome('a[href*="/commit/"] code')[0]?.textContent?.trim() ?? "",
    labels: [...new Set(chrome(".Label").map((l) => l.textContent?.trim() ?? ""))].filter(Boolean),
    assetsUrl: assets?.getAttribute("src") ?? assets?.getAttribute("data-deferred-src") ?? "",
    assetCount: chrome("summary .Counter")[0]?.textContent?.trim() ?? "",
  };
}

export type ReleaseAsset = { href: string; label: string; size: string };

export async function fetchAssets(url: string): Promise<ReleaseAsset[]> {
  const doc = await fetchPageDoc(url);
  return Array.from(doc.querySelectorAll("li")).flatMap((li) => {
    const link = li.querySelector("a[href]");
    const href = link?.getAttribute("href") ?? "";
    if (!href) return [];
    const size = Array.from(li.querySelectorAll("span.flex-shrink-0")).find((s) => !s.querySelector("relative-time"))?.textContent?.trim() ?? "";
    return [{ href, label: link?.textContent?.replace(/\s+/g, " ").trim() ?? "", size }];
  });
}

async function loadAssets(details: HTMLDetailsElement): Promise<void> {
  const url = details.dataset.assetsUrl;
  const list = details.querySelector("ul");
  if (!url || !list) return;
  delete details.dataset.assetsUrl;
  try {
    list.innerHTML = (await fetchAssets(url)).map((a) => `
      <li class="oldgh-releases__asset">
        ${octicon(a.href.includes("/archive/") ? "file-zip" : "file-binary", { size: 14 })}
        <a href="${escapeAttr(a.href)}">${escapeText(a.label)}</a>
        ${a.size ? `<span class="oldgh-releases__asset-size">${escapeText(a.size)}</span>` : ""}
      </li>
    `).join("");
  } catch (err) {
    list.innerHTML = `<li class="oldgh-releases__asset">Couldn't load assets: ${escapeText(err instanceof Error ? err.message : String(err))}</li>`;
  }
}

function renderShell(title: string): string {
  return `
    <div class="oldgh-page">
      <header class="oldgh-releases__header">
        <h1>${escapeText(title)}</h1>
      </header>
      <div class="oldgh-releases__main">
        <div class="oldgh-releases__loading">Loading…</div>
      </div>
    </div>
  `;
}

function renderPager(doc: Document, page: number): string {
  const { prev, next } = pageLinks(doc);
  if (!prev && !next) return "";
  return `
    <nav class="oldgh-releases__pager">
      ${prev ? `<a href="${escapeAttr(prev)}">‹ Newer</a>` : "<span></span>"}
      <span>Page ${page}</span>
      ${next ? `<a href="${escapeAttr(next)}">Older ›</a>` : "<span></span>"}
    </nav>
  `;
}

const BADGES: Record<string, string> = { Latest: "latest", "Pre-release": "pre", Draft: "draft" };

function renderRelease(owner: string, repo: string, r: Release, openAssets: boolean): string {
  const dateLabel = r.date ? `<span title="${escapeAttr(absoluteTime(r.date))}">${escapeText(relativeTime(r.date))}</span>` : "";
  const badges = r.labels
    .filter((l) => BADGES[l])
    .map((l) => `<span class="oldgh-releases__badge oldgh-releases__badge--${BADGES[l]}">${escapeText(l)}</span>`);
  const repoPath = `/${escapeAttr(owner)}/${escapeAttr(repo)}`;
  const tagHref = `${repoPath}/releases/tag/${encodeURIComponent(r.tagName)}`;

  return `
    <li class="oldgh-releases__row">
      <aside class="oldgh-releases__side">
        <div class="oldgh-releases__date">${dateLabel}</div>
        ${r.authorLogin ? `
          <div class="oldgh-releases__author">
            ${r.authorAvatar ? `<img src="${escapeAttr(r.authorAvatar)}" width="20" height="20" alt="" />` : ""}
            <a href="${escapeAttr(r.authorHref)}">${escapeText(r.authorLogin)}</a>
          </div>
        ` : ""}
        <div class="oldgh-releases__tag">${octicon("tag", { size: 14 })} <a href="${tagHref}">${escapeText(r.tagName)}</a></div>
        ${r.sha ? `<div class="oldgh-releases__target">${octicon("git-commit", { size: 14 })} <a href="${repoPath}/commit/${escapeAttr(r.sha)}"><code class="oldgh-releases__sha">${escapeText(r.sha)}</code></a></div>` : ""}
      </aside>
      <div class="oldgh-releases__card">
        <header class="oldgh-releases__card-head">
          <h2 class="oldgh-releases__title"><a href="${tagHref}">${escapeText(r.name)}</a></h2>
          <div class="oldgh-releases__badges">${badges.join("")}</div>
        </header>
        <div class="oldgh-releases__body markdown-body">
          ${r.bodyHtml.trim() ? sanitizeHtml(r.bodyHtml) : `<p class="oldgh-releases__no-body">No description provided.</p>`}
        </div>
        ${r.assetsUrl ? `
          <details class="oldgh-releases__assets" data-assets-url="${escapeAttr(r.assetsUrl)}"${openAssets ? " open" : ""}>
            <summary>Assets${r.assetCount ? ` <span class="oldgh-releases__asset-count">${escapeText(r.assetCount)}</span>` : ""}</summary>
            <ul><li class="oldgh-releases__asset">Loading…</li></ul>
          </details>
        ` : ""}
      </div>
    </li>
  `;
}
