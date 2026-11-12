import { octicon } from "@/icons";
import { getRepoTree, type RepoTreeView } from "@/adapters/repo-overview";
import { hydrateTreeTable, renderTreeTable } from "./_tree-table";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-tree";

export async function mountRepoTree(
  owner: string,
  repo: string,
  refAndPath: string,
): Promise<void> {
  const nav = navigationToken();
  const view = await getRepoTree(owner, repo, refAndPath);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  void hydrateTreeTable(root, {
    owner: view.owner,
    repo: view.repo,
    branch: view.branch,
    basePath: view.path,
  });
}

export function unmountRepoTree(): void {
  removeAllBodyRoots();
}

function renderShell(v: RepoTreeView): string {
  return `
    <div class="oldgh-page">
      ${renderBreadcrumb(v)}
      ${renderTreeTable({ owner: v.owner, repo: v.repo, branch: v.branch, basePath: v.path }, v.items)}
    </div>
  `;
}

function renderBreadcrumb(v: RepoTreeView): string {
  const parts = v.path.split("/").filter(Boolean);
  const branchIcon = octicon("git-branch", { size: 14 });
  const pieces: string[] = [];
  pieces.push(`
    <span class="oldgh-breadcrumb__ref">${branchIcon}<strong>${escapeText(v.branch)}</strong></span>
  `);
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

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
