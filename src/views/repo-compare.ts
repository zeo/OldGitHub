import { octicon } from "@/icons";
import { getCompare, type CompareView } from "@/adapters/repo-compare";
import type { DiffFile } from "@/util/diff";
import { renderDiffFile, renderDiffSummary } from "./_diff-table";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-compare";

export async function mountRepoCompare(owner: string, repo: string, range: string): Promise<void> {
  const nav = navigationToken();
  const view = await getCompare(owner, repo, range);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  adoptBodyRoot(root, ".oldgh-repo-header", nav);
}

function renderShell(v: CompareView): string {
  return `
    <div class="oldgh-page">
      ${renderHeader(v)}
      ${v.files.length === 0
        ? `<div class="oldgh-repo-compare__empty"><p>There isn't anything to compare.</p><p class="oldgh-fg-muted">${escapeText(v.base)} and ${escapeText(v.head)} are identical.</p></div>`
        : `${renderDiffSummary(v.files)}${v.files.map((f) => renderFileWithLargeDiff(f)).join("")}`}
    </div>
  `;
}

// github omits the patch for large files, leaving empty hunks; show a placeholder body
function renderFileWithLargeDiff(f: DiffFile): string {
  const html = renderDiffFile(f);
  const isLargeDiff = f.hunks.length === 0 && !f.isBinary && (f.additions > 0 || f.deletions > 0);
  if (!isLargeDiff) return html;
  const placeholder = `<div class="oldgh-repo-commit__binary">${octicon("file", { size: 14 })} Large diff not shown</div>`;
  const closeIdx = html.lastIndexOf("</section>");
  if (closeIdx < 0) return html;
  return html.slice(0, closeIdx) + placeholder + html.slice(closeIdx);
}

function renderHeader(v: CompareView): string {
  const branchIcon = octicon("git-branch", { size: 14 });
  const sep = v.threeDot ? "..." : "..";
  const baseHref = `/${v.owner}/${v.repo}/tree/${encodeURIComponent(v.base)}`;
  const headHref = `/${v.owner}/${v.repo}/tree/${encodeURIComponent(v.head)}`;
  return `
    <div class="oldgh-repo-compare__header">
      <h1 class="oldgh-repo-compare__title">Comparing changes</h1>
      <p class="oldgh-repo-compare__intro">
        Choose two branches to see what's changed or to start a new pull request.
      </p>
      <div class="oldgh-repo-compare__refs">
        <span class="oldgh-breadcrumb__ref">${branchIcon}<span>base:</span> <a href="${escapeAttr(baseHref)}"><strong>${escapeText(v.base)}</strong></a></span>
        <span class="oldgh-repo-compare__sep">${escapeText(sep)}</span>
        <span class="oldgh-breadcrumb__ref">${branchIcon}<span>compare:</span> <a href="${escapeAttr(headHref)}"><strong>${escapeText(v.head)}</strong></a></span>
      </div>
    </div>
  `;
}
