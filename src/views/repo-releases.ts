import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchApi } from "@/adapters/rate-limit";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-releases";

type ReleaseAsset = {
  name: string;
  downloadUrl: string;
  size: number;
  contentType: string;
  downloadCount: number;
};

type Release = {
  id: number;
  tagName: string;
  name: string;
  bodyHtml: string;
  body: string;
  htmlUrl: string;
  isDraft: boolean;
  isPrerelease: boolean;
  isLatest: boolean;
  authorLogin: string;
  authorAvatar: string;
  createdAt: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
  zipUrl: string;
  tarUrl: string;
  targetCommitish: string;
};

export async function mountRepoReleases(owner: string, repo: string, search: string, tag?: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(tag ? `Release ${tag}` : "Releases");
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-releases__main");
  if (!main) return;

  if (tag) {
    try {
      const raw = await fetchTagRelease(owner, repo, tag);
      const latestRaw = await fetchLatest(owner, repo);
      const latestId = latestRaw ? readNumber(latestRaw, "id") : null;
      const release = parseRelease(raw, latestId);
      if (!release) throw new Error("Could not parse release data");
      main.innerHTML = `
        <nav class="oldgh-releases__back"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases">${octicon("arrow-left", { size: 14 })} All releases</a></nav>
        <ul class="oldgh-releases__list">${renderRelease(owner, repo, release)}</ul>
      `;
    } catch (err) {
      main.innerHTML = `<div class="oldgh-releases__empty">Couldn't load release ${escapeText(tag)}: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
    }
    return;
  }

  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  try {
    const [releasesRaw, latestRaw] = await Promise.all([
      fetchReleases(owner, repo, page),
      fetchLatest(owner, repo),
    ]);
    const latestId = latestRaw ? readNumber(latestRaw, "id") : null;
    const items = releasesRaw.map((r) => parseRelease(r, latestId)).filter((r): r is Release => r !== null);
    if (items.length === 0) {
      main.innerHTML = renderNoReleases(owner, repo);
      return;
    }
    main.innerHTML = renderList(owner, repo, items, page);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/responded 404\b/.test(msg)) {
      // The anonymous REST API returns 404 for private repos; the user might
      // still be able to see releases via the cookie-authed HTML page.
      main.innerHTML = renderPrivateNotice(owner, repo);
      return;
    }
    main.innerHTML = `<div class="oldgh-releases__empty">Couldn't load releases: ${escapeText(msg)}</div>`;
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

function renderPrivateNotice(owner: string, repo: string): string {
  return `
    <div class="oldgh-releases__empty">
      <p class="oldgh-releases__empty-title">Releases for this repository aren't publicly available.</p>
      <p class="oldgh-releases__empty-hint">GitHub's REST API requires authentication for private repos. <a href="https://github.com/${escapeAttr(owner)}/${escapeAttr(repo)}/releases" rel="noopener">View releases on github.com</a>.</p>
    </div>
  `;
}

async function fetchReleases(owner: string, repo: string, page: number): Promise<unknown[]> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30&page=${page}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github.html+json" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getReleases", `releases responded ${resp.status}`);
  }
  const data = (await resp.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

async function fetchLatest(owner: string, repo: string): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as unknown;
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseRelease(raw: unknown, latestId: number | null): Release | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = readNumber(r, "id");
  const tagName = readString(r, "tag_name");
  if (id == null || !tagName) return null;
  const author = readObj(r["author"]);
  const assets = readArray(r["assets"]).map(parseAsset).filter((a): a is ReleaseAsset => a !== null);
  return {
    id,
    tagName,
    name: readString(r, "name") || tagName,
    bodyHtml: readString(r, "body_html") || "",
    body: readString(r, "body") || "",
    htmlUrl: readString(r, "html_url") || "",
    isDraft: r["draft"] === true,
    isPrerelease: r["prerelease"] === true,
    isLatest: latestId != null && id === latestId,
    authorLogin: (author && readString(author, "login")) || "",
    authorAvatar: (author && readString(author, "avatar_url")) || "",
    createdAt: readString(r, "created_at") || "",
    publishedAt: readString(r, "published_at"),
    assets,
    zipUrl: readString(r, "zipball_url") || "",
    tarUrl: readString(r, "tarball_url") || "",
    targetCommitish: readString(r, "target_commitish") || "",
  };
}

function parseAsset(raw: unknown): ReleaseAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const name = readString(a, "name");
  if (!name) return null;
  return {
    name,
    downloadUrl: readString(a, "browser_download_url") || "",
    size: readNumber(a, "size") || 0,
    contentType: readString(a, "content_type") || "",
    downloadCount: readNumber(a, "download_count") || 0,
  };
}

async function fetchTagRelease(owner: string, repo: string, tag: string): Promise<unknown> {
  const resp = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github.html+json" },
  });
  if (!resp.ok) throw new AdapterFailure("getTagRelease", `release responded ${resp.status}`);
  return resp.json();
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

function renderList(owner: string, repo: string, items: Release[], page: number): string {
  if (items.length === 0) {
    return `
      <div class="oldgh-releases__empty">
        <p>No releases published.</p>
        <p><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/tags">View tags</a></p>
      </div>
    `;
  }
  const pager = items.length === 30
    ? `<nav class="oldgh-releases__pager">
         ${page > 1 ? `<a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases?page=${page - 1}">‹ Newer</a>` : "<span></span>"}
         <span>Page ${page}</span>
         <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases?page=${page + 1}">Older ›</a>
       </nav>`
    : page > 1
      ? `<nav class="oldgh-releases__pager"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases?page=${page - 1}">‹ Newer</a><span>Page ${page}</span><span></span></nav>`
      : "";
  return `
    <ul class="oldgh-releases__list">
      ${items.map((r) => renderRelease(owner, repo, r)).join("")}
    </ul>
    ${pager}
  `;
}

function renderRelease(owner: string, repo: string, r: Release): string {
  const date = r.publishedAt || r.createdAt;
  const dateLabel = date ? `<span title="${escapeAttr(absoluteTime(date))}">${escapeText(relativeTime(date))}</span>` : "";
  const badges: string[] = [];
  if (r.isLatest) badges.push(`<span class="oldgh-releases__badge oldgh-releases__badge--latest">Latest</span>`);
  if (r.isPrerelease) badges.push(`<span class="oldgh-releases__badge oldgh-releases__badge--pre">Pre-release</span>`);
  if (r.isDraft) badges.push(`<span class="oldgh-releases__badge oldgh-releases__badge--draft">Draft</span>`);

  const targetCode = r.targetCommitish && r.targetCommitish.length > 0
    ? `<code class="oldgh-releases__sha">${escapeText(r.targetCommitish.slice(0, 7))}</code>`
    : "";

  return `
    <li class="oldgh-releases__row">
      <aside class="oldgh-releases__side">
        <div class="oldgh-releases__date">${dateLabel}</div>
        ${r.authorLogin ? `
          <div class="oldgh-releases__author">
            <img src="${escapeAttr(r.authorAvatar)}" width="20" height="20" alt="" />
            <a href="/${escapeAttr(r.authorLogin)}">${escapeText(r.authorLogin)}</a>
          </div>
        ` : ""}
        <div class="oldgh-releases__tag">${octicon("tag", { size: 14 })} <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases/tag/${encodeURIComponent(r.tagName)}">${escapeText(r.tagName)}</a></div>
        ${targetCode ? `<div class="oldgh-releases__target">${octicon("git-commit", { size: 14 })} <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/tree/${escapeAttr(r.targetCommitish)}">${targetCode}</a></div>` : ""}
      </aside>
      <div class="oldgh-releases__card">
        <header class="oldgh-releases__card-head">
          <h2 class="oldgh-releases__title">
            <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/releases/tag/${encodeURIComponent(r.tagName)}">${escapeText(r.name)}</a>
          </h2>
          <div class="oldgh-releases__badges">${badges.join("")}</div>
        </header>
        <div class="oldgh-releases__body markdown-body">
          ${r.bodyHtml ? sanitizeHtml(r.bodyHtml) : (r.body ? `<pre class="oldgh-releases__plain">${escapeText(r.body)}</pre>` : `<p class="oldgh-releases__no-body">No description provided.</p>`)}
        </div>
        ${renderAssets(r)}
      </div>
    </li>
  `;
}

function renderAssets(r: Release): string {
  const sourceAssets: ReleaseAsset[] = [];
  if (r.zipUrl) sourceAssets.push({ name: `Source code (zip)`, downloadUrl: r.zipUrl, size: 0, contentType: "application/zip", downloadCount: 0 });
  if (r.tarUrl) sourceAssets.push({ name: `Source code (tar.gz)`, downloadUrl: r.tarUrl, size: 0, contentType: "application/gzip", downloadCount: 0 });
  const all = [...r.assets, ...sourceAssets];
  if (all.length === 0) return "";
  return `
    <details class="oldgh-releases__assets" open>
      <summary>Assets <span class="oldgh-releases__asset-count">${r.assets.length === 0 ? "Source code" : `${r.assets.length} file${r.assets.length === 1 ? "" : "s"}${sourceAssets.length ? " + source" : ""}`}</span></summary>
      <ul>
        ${all.map((a) => `
          <li class="oldgh-releases__asset">
            ${octicon(a.contentType.includes("zip") || a.contentType.includes("gzip") ? "file-zip" : "file-binary", { size: 14 })}
            <a href="${escapeAttr(a.downloadUrl)}">${escapeText(a.name)}</a>
            ${a.size > 0 ? `<span class="oldgh-releases__asset-size">${formatBytes(a.size)}</span>` : ""}
            ${a.downloadCount > 0 ? `<span class="oldgh-releases__asset-downloads">${a.downloadCount.toLocaleString()} downloads</span>` : ""}
          </li>
        `).join("")}
      </ul>
    </details>
  `;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}
function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}
