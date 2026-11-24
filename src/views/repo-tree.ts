import { getRepoTree, type RepoTreeView } from "@/adapters/repo-overview";
import { hydrateTreeTable, renderTreeTable } from "./_tree-table";
import { adoptBodyRoot, navigationToken } from "./_body";
import { renderRepoBreadcrumb } from "./_breadcrumb";

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

function renderShell(v: RepoTreeView): string {
  return `
    <div class="oldgh-page">
      ${renderRepoBreadcrumb({ owner: v.owner, repo: v.repo, branch: v.branch, path: v.path })}
      ${renderTreeTable({ owner: v.owner, repo: v.repo, branch: v.branch, basePath: v.path }, v.items)}
    </div>
  `;
}
