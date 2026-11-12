import { octicon } from "@/icons";
import { getRepoCommits, type CommitEntry, type CommitsView, type PersonRef } from "@/adapters/repo-commits";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-commits";

export async function mountRepoCommits(
  owner: string,
  repo: string,
  refAndPath: string,
  query: string,
): Promise<void> {
  const nav = navigationToken();
  const view = await getRepoCommits(owner, repo, refAndPath, query);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  adoptBodyRoot(root, ".oldgh-repo-header", nav);
}

export function unmountRepoCommits(): void {
  removeAllBodyRoots();
}

function renderShell(v: CommitsView): string {
  // renderGroup drops groups whose commits all failed to parse, so check the rendered body, not group count
  const body = v.groups.map((g) => renderGroup(v, g)).join("");
  return `
    <div class="oldgh-page">
      ${renderHeader(v)}
      ${body.trim()
        ? body
        : `<div class="oldgh-repo-commits__group"><p class="oldgh-fg-muted">No commits found.</p></div>`}
      ${renderPagination(v)}
    </div>
  `;
}

function renderHeader(v: CommitsView): string {
  const branchIcon = octicon("git-branch", { size: 14 });
  return `
    <div class="oldgh-repo-commits__header">
      <h2 class="oldgh-repo-commits__title">Commits</h2>
      <span class="oldgh-breadcrumb__ref">${branchIcon}<strong>${escapeText(v.branch)}</strong></span>
      ${v.path ? `<span class="oldgh-breadcrumb__sep">/</span><span class="oldgh-breadcrumb__seg oldgh-breadcrumb__seg--current">${escapeText(v.path)}</span>` : ""}
    </div>
  `;
}

function renderGroup(v: CommitsView, g: { title: string; commits: CommitEntry[] }): string {
  if (g.commits.length === 0) return "";
  return `
    <section class="oldgh-repo-commits__group">
      <h3 class="oldgh-repo-commits__group-title">Commits on ${escapeText(g.title)}</h3>
      <ul class="oldgh-repo-commits__list">
        ${g.commits.map((c) => renderCommit(v, c)).join("")}
      </ul>
    </section>
  `;
}

function renderCommit(v: CommitsView, c: CommitEntry): string {
  const primaryAuthor = c.authors[0];
  const shortOid = c.oid.slice(0, 7);
  const messageHtml = c.shortMessageMarkdownLink
    ? sanitizeBodyHtml(c.shortMessageMarkdownLink)
    : `<a href="${escapeAttr(c.url)}" title="${escapeAttr(c.shortMessage)}">${escapeText(c.shortMessage)}</a>`;
  const browseHref = `/${v.owner}/${v.repo}/tree/${c.oid}${v.path ? "/" + pathSegments(v.path) : ""}`;
  return `
    <li class="oldgh-repo-commits__item">
      <div class="oldgh-repo-commits__avatar">
        ${primaryAuthor ? `<a href="${escapeAttr(primaryAuthor.path)}" aria-label="View ${escapeAttr(primaryAuthor.login)}'s profile"><img src="${escapeAttr(primaryAuthor.avatarUrl)}" alt="" width="36" height="36" /></a>` : ""}
      </div>
      <div class="oldgh-repo-commits__body">
        <p class="oldgh-repo-commits__msg">${messageHtml}</p>
        <p class="oldgh-repo-commits__meta">
          ${renderMeta(c)}
        </p>
      </div>
      <div class="oldgh-repo-commits__actions">
        <a class="oldgh-btn oldgh-repo-commits__sha" href="${escapeAttr(c.url)}" title="${escapeAttr(c.oid)}"><code>${escapeText(shortOid)}</code></a>
        <a class="oldgh-btn" href="${escapeAttr(browseHref)}" aria-label="Browse the repository at this point in the history">${octicon("file-code", { size: 14 })}<span>Browse files</span></a>
      </div>
    </li>
  `;
}

function renderMeta(c: CommitEntry): string {
  const committedLink = `<a href="${escapeAttr(c.url)}" title="${escapeAttr(absoluteTime(c.committedDate))}">${escapeText(relativeTime(c.committedDate))}</a>`;
  const primaryLogin = c.authors[0]?.login;
  // distinct committer gets the classic "authored ... and X committed ..." wording
  if (c.committer && c.authors.length > 0 && c.committer.login !== primaryLogin) {
    const authoredLink = `<a href="${escapeAttr(c.url)}" title="${escapeAttr(absoluteTime(c.authoredDate))}">${escapeText(relativeTime(c.authoredDate))}</a>`;
    return `${renderAuthors(c.authors)} authored ${authoredLink} and ${renderPerson(c.committer)} committed ${committedLink}`;
  }
  // an unlinked email author yields no authors; fall back to the committer so the actor is never blank
  const actor = c.authors.length > 0 ? renderAuthors(c.authors) : c.committer ? renderPerson(c.committer) : "";
  return `${actor} committed ${committedLink}`;
}

function renderPerson(p: PersonRef): string {
  return `<a class="oldgh-repo-commits__author" href="${escapeAttr(p.path)}"><strong>${escapeText(p.displayName)}</strong></a>`;
}

function renderAuthors(authors: PersonRef[]): string {
  if (authors.length === 0) return "";
  return authors.map(renderPerson).join(" and ");
}

function renderPagination(v: CommitsView): string {
  if (!v.pagination.hasNext && !v.pagination.hasPrevious) return "";
  const newer = v.pagination.hasPrevious && v.pagination.startCursor
    ? `<a class="oldgh-btn" href="?before=${encodeURIComponent(v.pagination.startCursor)}">${octicon("triangle-left", { size: 14 })}<span>Newer</span></a>`
    : `<button class="oldgh-btn" type="button" disabled>${octicon("triangle-left", { size: 14 })}<span>Newer</span></button>`;
  const older = v.pagination.hasNext && v.pagination.endCursor
    ? `<a class="oldgh-btn" href="?after=${encodeURIComponent(v.pagination.endCursor)}"><span>Older</span>${octicon("triangle-right", { size: 14 })}</a>`
    : `<button class="oldgh-btn" type="button" disabled><span>Older</span>${octicon("triangle-right", { size: 14 })}</button>`;
  return `
    <div class="oldgh-repo-commits__pagination">
      ${newer}
      ${older}
    </div>
  `;
}

function pathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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
