import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { getTreeCommitInfo, type CommitInfo, type TreeItem } from "@/adapters/repo-overview";
import { absoluteTime, relativeTime } from "@/util/time";
import { escapeAttr, escapeText, sanitizeHtml } from "@/util/html";

export type TreeTableContext = {
  owner: string;
  repo: string;
  branch: string;
  basePath: string;
};

export function renderTreeTable(ctx: TreeTableContext, items: TreeItem[]): string {
  const sorted = sortTree(items);
  const heading = ctx.basePath
    ? `${escapeText(ctx.repo)} / <span class="oldgh-fg-muted">${escapeText(ctx.basePath)}</span> @ ${escapeText(ctx.branch)}`
    : `${escapeText(ctx.repo)} <span class="oldgh-fg-muted">@ ${escapeText(ctx.branch)}</span>`;
  return `
    <table class="oldgh-table oldgh-repo-home__tree" aria-label="Files">
      <thead>
        <tr><th colspan="4">${heading}</th></tr>
      </thead>
      <tbody>
        ${ctx.basePath ? renderUpRow(ctx) : ""}
        ${sorted.length === 0
          ? `<tr><td colspan="4" class="oldgh-fg-muted">${ctx.basePath ? "This directory is empty." : "This repository is empty."}</td></tr>`
          : sorted.map((it) => renderRow(ctx, it)).join("")}
      </tbody>
    </table>
  `;
}

export function sortTree(items: TreeItem[]): TreeItem[] {
  const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
  return [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return cmp(a.name, b.name);
  });
}

function renderUpRow(ctx: TreeTableContext): string {
  const parts = ctx.basePath.split("/").filter(Boolean);
  parts.pop();
  const upPath = parts.join("/");
  const href = upPath
    ? `/${ctx.owner}/${ctx.repo}/tree/${encodeURIComponent(ctx.branch)}/${pathSegments(upPath)}`
    : `/${ctx.owner}/${ctx.repo}`;
  return `
    <tr data-up>
      <td class="oldgh-repo-home__cell-icon">${octicon("reply", { size: 16 })}</td>
      <td class="oldgh-repo-home__cell-name"><a href="${escapeAttr(href)}">..</a></td>
      <td class="oldgh-repo-home__cell-msg"></td>
      <td class="oldgh-repo-home__cell-age"></td>
    </tr>
  `;
}

function renderRow(ctx: TreeTableContext, it: TreeItem): string {
  const iconName = it.isDirectory ? "file-directory" : "file";
  const href = it.isDirectory
    ? `/${ctx.owner}/${ctx.repo}/tree/${encodeURIComponent(ctx.branch)}/${pathSegments(it.path)}`
    : `/${ctx.owner}/${ctx.repo}/blob/${encodeURIComponent(ctx.branch)}/${pathSegments(it.path)}`;
  const relativeKey = ctx.basePath ? it.path.slice(ctx.basePath.length + 1) : it.path;
  return `
    <tr data-path="${escapeAttr(it.path)}" data-key="${escapeAttr(relativeKey)}">
      <td class="oldgh-repo-home__cell-icon">${octicon(iconName, { size: 16 })}</td>
      <td class="oldgh-repo-home__cell-name"><a href="${escapeAttr(href)}">${escapeText(it.name)}</a></td>
      <td class="oldgh-repo-home__cell-msg" data-msg></td>
      <td class="oldgh-repo-home__cell-age" data-age></td>
    </tr>
  `;
}

export async function hydrateTreeTable(root: HTMLElement, ctx: TreeTableContext): Promise<void> {
  let info: Record<string, CommitInfo>;
  try {
    info = await getTreeCommitInfo(ctx.owner, ctx.repo, ctx.basePath ? `${ctx.branch}/${ctx.basePath}` : ctx.branch);
  } catch (err) {
    if (err instanceof AdapterFailure) {
      console.debug("[oldgh] tree-commit-info failure:", err.message);
      // keep the right-hand columns from collapsing when hydration fails
      root.querySelectorAll<HTMLTableCellElement>("[data-msg], [data-age]").forEach((cell) => {
        cell.innerHTML = `<span class="oldgh-fg-muted">&mdash;</span>`;
      });
      return;
    }
    throw err;
  }

  const placeholder = `<span class="oldgh-fg-muted">&mdash;</span>`;
  root.querySelectorAll<HTMLTableRowElement>("tr[data-key]").forEach((row) => {
    const key = row.dataset["key"];
    if (!key) return;
    const ci = info[key];
    const msgCell = row.querySelector<HTMLTableCellElement>("[data-msg]");
    const ageCell = row.querySelector<HTMLTableCellElement>("[data-age]");
    // omitted or empty commit-info rows get the same placeholder as a full hydration failure
    if (msgCell) msgCell.innerHTML = ci?.shortMessageHtmlLink ? sanitizeHtml(ci.shortMessageHtmlLink) : placeholder;
    if (ageCell) {
      if (ci?.date) {
        ageCell.textContent = relativeTime(ci.date);
        ageCell.title = absoluteTime(ci.date);
      } else {
        ageCell.innerHTML = placeholder;
      }
    }
  });
}

function pathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
