import { octicon } from "@/icons";
import { getRepoBlob, type RepoBlobView } from "@/adapters/repo-overview";
import { highlightFile } from "@/highlight";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-blob";
const MAX_HIGHLIGHT_CHARS = 1_000_000;
const MAX_HIGHLIGHT_LINES = 20_000;

export async function mountRepoBlob(owner: string, repo: string, refAndPath: string, query = ""): Promise<void> {
  const nav = navigationToken();
  const href = `/${owner}/${repo}/blob/${refAndPath}`;
  const plain = new URLSearchParams(query).get("plain") === "1";
  const view = await getRepoBlob(owner, repo, refAndPath, query);
  const rendered = view.richHtml !== null && !plain;

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, rendered, href);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  if (!rendered && !view.isBinary && view.rawLines.length > 0) {
    void hydrateHighlight(root, view);
  }
}

async function hydrateHighlight(root: HTMLElement, view: RepoBlobView): Promise<void> {
  const text = view.rawLines.join("\n");
  // highlight.js runs on the main thread; past this size plain text beats a frozen tab
  if (text.length > MAX_HIGHLIGHT_CHARS || view.rawLines.length > MAX_HIGHLIGHT_LINES) return;
  const result = await highlightFile(text, view.language);
  if (!result) return;
  const codeCells = root.querySelectorAll<HTMLTableCellElement>("td.oldgh-repo-blob__code");
  for (let i = 0; i < codeCells.length && i < result.lines.length; i++) {
    codeCells[i]!.innerHTML = result.lines[i]!;
  }
  root.classList.add(`oldgh-hljs-${result.language}`);
  root.classList.add("oldgh-hljs");
}

function renderShell(v: RepoBlobView, rendered: boolean, href: string): string {
  const content = rendered
    ? `<div class="oldgh-repo-blob__rendered oldgh-repo-home__readme-body">${sanitizeHtml(v.richHtml ?? "")}</div>`
    : v.isBinary ? renderBinary(v) : v.truncated ? renderTruncated(v) : renderSource(v);
  return `
    <div class="oldgh-page">
      ${renderBreadcrumb(v)}
      <div class="oldgh-repo-blob__file">
        ${renderFileHeader(v, rendered, href)}
        ${content}
      </div>
    </div>
  `;
}

function renderBreadcrumb(v: RepoBlobView): string {
  const parts = v.path.split("/").filter(Boolean);
  const branchIcon = octicon("git-branch", { size: 14 });
  const pieces: string[] = [];
  pieces.push(`<span class="oldgh-breadcrumb__ref">${branchIcon}<strong>${escapeText(v.branch)}</strong></span>`);
  pieces.push(`<span class="oldgh-breadcrumb__sep">/</span>`);
  pieces.push(`<a class="oldgh-breadcrumb__seg" href="/${v.owner}/${v.repo}">${escapeText(v.repo)}</a>`);
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    acc = acc ? `${acc}/${seg}` : seg;
    pieces.push(`<span class="oldgh-breadcrumb__sep">/</span>`);
    if (i === parts.length - 1) {
      pieces.push(`<span class="oldgh-breadcrumb__seg oldgh-breadcrumb__seg--current">${escapeText(seg)}</span>`);
    } else {
      const href = `/${v.owner}/${v.repo}/tree/${encodeURIComponent(v.branch)}/${acc.split("/").map(encodeURIComponent).join("/")}`;
      pieces.push(`<a class="oldgh-breadcrumb__seg" href="${escapeAttr(href)}">${escapeText(seg)}</a>`);
    }
  }
  return `<div class="oldgh-breadcrumb">${pieces.join("")}</div>`;
}

function renderFileHeader(v: RepoBlobView, rendered: boolean, href: string): string {
  const lineCount = v.rawLines.length;
  const byteSize = v.isImage ? "image" : v.isBinary ? "binary" : formatBytes(v.size);
  const lang = v.language ? `<span class="oldgh-repo-blob__lang">${escapeText(v.language)}</span>` : "";
  const raw = v.rawBlobUrl
    ? `<a class="oldgh-btn" href="${escapeAttr(v.rawBlobUrl)}">${octicon("file-binary", { size: 14 })}<span>Raw</span></a>`
    : "";
  const fileName = v.path.split("/").pop() || v.path;
  const download = v.rawBlobUrl
    ? `<a class="oldgh-btn oldgh-repo-blob__download" href="${escapeAttr(v.rawBlobUrl)}" download="${escapeAttr(fileName)}" title="Download ${escapeAttr(fileName)}">${octicon("cloud-download", { size: 14 })}<span class="oldgh-repo-blob__download-label">Download</span></a>`
    : "";
  const blame = `<a class="oldgh-btn" href="/${v.owner}/${v.repo}/blame/${encodeURIComponent(v.branch)}/${pathSegments(v.path)}">${octicon("versions", { size: 14 })}<span>Blame</span></a>`;
  const history = `<a class="oldgh-btn" href="/${v.owner}/${v.repo}/commits/${encodeURIComponent(v.branch)}/${pathSegments(v.path)}">${octicon("history", { size: 14 })}<span>History</span></a>`;
  const toggle = !v.hasPreview
    ? ""
    : rendered
      ? `<a class="oldgh-btn" href="${escapeAttr(href)}?plain=1">${octicon("code", { size: 14 })}<span>Source</span></a>`
      : `<a class="oldgh-btn" href="${escapeAttr(href)}">${octicon("eye", { size: 14 })}<span>Preview</span></a>`;

  // empty text files have no meaningful line/byte counts to show
  const emptySource = !v.isBinary && isEmptySource(v);
  const counts = v.isBinary
    ? `<span>${byteSize}</span>`
    : emptySource
      ? ""
      : `<span>${lineCount} line${lineCount === 1 ? "" : "s"}</span><span class="oldgh-repo-blob__sep">·</span><span>${byteSize}</span>`;
  return `
    <div class="oldgh-repo-blob__file-header">
      <div class="oldgh-repo-blob__meta">
        ${counts}
        ${lang ? `${counts ? `<span class="oldgh-repo-blob__sep">·</span>` : ""}${lang}` : ""}
      </div>
      <div class="oldgh-repo-blob__actions">${toggle}${raw}${download}${blame}${history}</div>
    </div>
  `;
}

// a file with no lines, or a single empty line, has no displayable source
function isEmptySource(v: RepoBlobView): boolean {
  return v.rawLines.length === 0 || (v.rawLines.length === 1 && v.rawLines[0] === "");
}

function renderSource(v: RepoBlobView): string {
  if (isEmptySource(v)) {
    // a single "" line means the file loaded but is empty; no lines at all
    // means the content never arrived
    const empty = v.rawLines.length === 1;
    const icon = octicon(empty ? "file" : "alert", { size: 32 });
    const message = empty ? "This file is empty." : "Could not load file contents.";
    return `
      <div class="oldgh-repo-blob__empty">
        ${icon}
        <p>${escapeText(message)}</p>
      </div>
    `;
  }
  const rows: string[] = [];
  for (let i = 0; i < v.rawLines.length; i++) {
    const n = i + 1;
    rows.push(`<tr id="L${n}"><td class="oldgh-repo-blob__num"><a href="#L${n}">${n}</a></td><td class="oldgh-repo-blob__code">${escapeText(v.rawLines[i]!)}</td></tr>`);
  }
  return `
    <div class="oldgh-repo-blob__scroll">
      <table class="oldgh-repo-blob__table">
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function renderBinary(v: RepoBlobView): string {
  if (v.isImage && v.rawBlobUrl) {
    return `<div class="oldgh-repo-blob__image"><img src="${escapeAttr(v.rawBlobUrl)}" alt="${escapeAttr(v.displayName)}" /></div>`;
  }
  return `
    <div class="oldgh-repo-blob__binary">
      <p>This file is a binary and cannot be displayed inline.</p>
      ${v.rawBlobUrl ? `<a class="oldgh-btn" href="${escapeAttr(v.rawBlobUrl)}">${octicon("cloud-download", { size: 14 })}<span>Download</span></a>` : ""}
    </div>
  `;
}

function renderTruncated(v: RepoBlobView): string {
  // when truncated content has no lines, skip renderSource to avoid stacking its empty-state error under the notice
  return `
    <div class="oldgh-repo-blob__truncated">
      <p>This file has been truncated. ${v.rawBlobUrl ? `<a href="${escapeAttr(v.rawBlobUrl)}">View raw</a>.` : ""}</p>
      ${isEmptySource(v) ? "" : renderSource(v)}
    </div>
  `;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function pathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
