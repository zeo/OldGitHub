import { getCommit, type CommitView, type PersonRef } from "@/adapters/repo-commit";
import { absoluteTime, relativeTime } from "@/util/time";
import { renderDiffFile, renderDiffSummary } from "./_diff-table";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-commit";

export async function mountRepoCommit(owner: string, repo: string, sha: string): Promise<void> {
  const nav = navigationToken();
  const view = await getCommit(owner, repo, sha);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  adoptBodyRoot(root, ".oldgh-repo-header", nav);
}

export function unmountRepoCommit(): void {
  removeAllBodyRoots();
}

function renderShell(c: CommitView): string {
  // merge commits and --allow-empty serve an empty diff
  const body = c.files.length === 0
    ? `<div class="oldgh-repo-commit__empty">${
        c.parents.length >= 2
          ? "This is a merge commit; view the individual parents for changes."
          : "No file changes in this commit."
      }</div>`
    : c.files.map((f) => renderDiffFile(f)).join("");
  return `
    <div class="oldgh-page">
      ${renderHeader(c)}
      ${renderDiffSummary(c.files)}
      ${body}
    </div>
  `;
}

function renderHeader(c: CommitView): string {
  const shortOid = c.oid.slice(0, 7);
  const author = c.authors[0];
  const authoredHtml = renderAuthor(author);
  const commBy = c.committer && (!author || c.committer.login !== author.login)
    ? `committed by <a href="${escapeAttr(c.committer.path)}"><strong>${escapeText(c.committer.displayName)}</strong></a>`
    : "";
  // join credits without a leading comma and keep "on" only when a credit precedes it
  const credits = [authoredHtml, commBy].filter(Boolean).join(", ");
  const time = `<time datetime="${escapeAttr(c.committedDate)}" title="${escapeAttr(absoluteTime(c.committedDate))}">${escapeText(relativeTime(c.committedDate))}</time>`;
  // capitalize when the committer leads, to match the "Committed on" fallback
  const leadingCredits = !authoredHtml && commBy ? `C${commBy.slice(1)}` : credits;
  const byline = credits ? `${leadingCredits} on ${time}` : `Committed on ${time}`;
  const parents = c.parents.length > 0
    ? `<div class="oldgh-repo-commit__parents">
        ${c.parents.length >= 2 ? "merge of " : "parent "}${c.parents
          .map((p) => `<a href="/${escapeAttr(c.owner)}/${escapeAttr(c.repo)}/commit/${escapeAttr(p)}"><code>${escapeText(p.slice(0, 7))}</code></a>`)
          .join(" + ")}
      </div>`
    : "";

  return `
    <div class="oldgh-repo-commit__header">
      <div class="oldgh-repo-commit__title-row">
        <h1 class="oldgh-repo-commit__title">${escapeText(c.shortMessage)}</h1>
        <a class="oldgh-btn oldgh-repo-commit__sha" href="/${escapeAttr(c.owner)}/${escapeAttr(c.repo)}/tree/${escapeAttr(c.oid)}" title="Browse files at ${escapeAttr(c.oid)}"><code>${escapeText(shortOid)}</code></a>
      </div>
      ${c.bodyMessageHtml ? `<div class="oldgh-repo-commit__body markdown-body">${sanitizeBodyHtml(c.bodyMessageHtml)}</div>` : ""}
      <div class="oldgh-repo-commit__meta">
        ${byline}
      </div>
      ${parents}
    </div>
  `;
}

function renderAuthor(a: PersonRef | undefined): string {
  if (!a) return "";
  return `<img class="oldgh-repo-commit__avatar" src="${escapeAttr(a.avatarUrl)}" alt="" width="20" height="20" /> <a href="${escapeAttr(a.path)}"><strong>${escapeText(a.displayName)}</strong></a> authored`;
}

function sanitizeBodyHtml(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href=(["'])https?:\/\/github\.com(\/[^"']*)\1/gi, 'href=$1$2$1');
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
