import { octicon } from "@/icons";
import { getIssueList, type IssueListView, type IssueRow } from "@/adapters/repo-issues";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-issues";

export async function mountRepoIssues(
  owner: string,
  repo: string,
  rawQuery: string,
  kind: "issues" | "pulls",
): Promise<void> {
  const nav = navigationToken();
  const view = await getIssueList(owner, repo, rawQuery, kind);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, kind);
  adoptBodyRoot(root, ".oldgh-repo-header", nav);
}

export function unmountRepoIssues(): void {
  removeAllBodyRoots();
}

function renderShell(v: IssueListView, kind: "issues" | "pulls"): string {
  const showsClosed = /\bis:closed\b/i.test(v.query);
  const basePath = `/${v.owner}/${v.repo}/${kind}`;
  const openHref = `${basePath}?q=${encodeURIComponent(buildSwappedQuery(v.query, "open"))}`;
  const closedHref = `${basePath}?q=${encodeURIComponent(buildSwappedQuery(v.query, "closed"))}`;

  return `
    <div class="oldgh-page">
      <div class="oldgh-issues__toolbar">
        ${renderSearch(v, kind)}
        <a class="oldgh-btn oldgh-btn--primary oldgh-issues__new" href="/${v.owner}/${v.repo}/${kind === "pulls" ? "compare" : "issues/new/choose"}">
          ${octicon(kind === "pulls" ? "git-pull-request" : "issue-opened", { size: 14 })}
          <span>New ${kind === "pulls" ? "pull request" : "issue"}</span>
        </a>
      </div>

      <ul class="oldgh-issues__state-tabs">
        <li>
          <a href="${escapeAttr(openHref)}"${!showsClosed ? ' aria-current="page"' : ""}>
            ${octicon(kind === "pulls" ? "git-pull-request" : "issue-opened", { size: 14 })}
            <strong>${v.openCount != null ? formatCount(v.openCount) + " " : ""}Open</strong>
          </a>
        </li>
        <li>
          <a href="${escapeAttr(closedHref)}"${showsClosed ? ' aria-current="page"' : ""}>
            ${octicon("check", { size: 14 })}
            <strong>${v.closedCount != null ? formatCount(v.closedCount) + " " : ""}Closed</strong>
          </a>
        </li>
      </ul>

      ${v.rows.length === 0 ? renderEmpty(kind, v) : `
        <ul class="oldgh-issues__list">
          ${v.rows.map((r) => renderRow(v, r, kind)).join("")}
        </ul>
      `}

      ${renderPagination(v, kind)}
    </div>
  `;
}

function renderSearch(v: IssueListView, kind: "issues" | "pulls"): string {
  return `
    <form class="oldgh-issues__search" action="/${v.owner}/${v.repo}/${kind}" method="get" role="search">
      <input type="search" name="q" value="${escapeAttr(v.query)}" placeholder="Search ${kind}" aria-label="Search ${kind}" />
    </form>
  `;
}

function renderRow(v: IssueListView, r: IssueRow, kind: "issues" | "pulls"): string {
  // not_planned (rest) and NOT_PLANNED (graphql) both mean the issue was closed as skipped
  const notPlanned = (r.stateReason || "").toUpperCase() === "NOT_PLANNED";
  const stateIcon = r.state === "OPEN"
    ? (r.isDraft
      ? octicon("git-pull-request", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--draft" })
      : octicon(kind === "pulls" ? "git-pull-request" : "issue-opened", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--open" }))
    : (kind === "pulls" && r.merged
      ? octicon("git-merge", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--merged" })
      : (kind === "pulls"
        ? octicon("git-pull-request", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--closed" })
        : (notPlanned
          ? octicon("circle-slash", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--not-planned" })
          : octicon("issue-closed", { size: 16, className: "oldgh-issues__state-icon oldgh-issues__state-icon--closed" }))));

  const labelState = /\bis:closed\b/i.test(v.query) ? "is:closed" : "is:open";
  const labels = r.labels.length > 0
    ? `<span class="oldgh-issues__labels">${r.labels.map((l) => `<a class="oldgh-issues__label" href="/${v.owner}/${v.repo}/${kind}?q=${labelState}+label:${encodeURIComponent('"' + l.name + '"')}" style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)};">${escapeText(emojify(l.name))}</a>`).join("")}</span>`
    : "";

  const author = r.author
    ? `<a href="/${escapeAttr(r.author.login)}">${escapeText(r.author.login)}</a>`
    : "ghost";

  const opened = r.state === "OPEN"
    ? `opened ${relativeTimeLink(r.createdAt, `/${v.owner}/${v.repo}/${kind === "pulls" ? "pull" : "issues"}/${r.number}`)} by ${author}`
    : (kind === "pulls" && r.merged
      ? `by ${author} was merged ${relativeTimeLink(r.closedAt ?? r.createdAt)}`
      : `by ${author} was closed ${relativeTimeLink(r.closedAt ?? r.createdAt)}`);

  const assignees = r.assignees.length > 0
    ? `<span class="oldgh-issues__assignees">${r.assignees.slice(0, 3).map((a) => `<a href="/${escapeAttr(a.login)}" aria-label="View ${escapeAttr(a.login)}'s profile"><img src="${escapeAttr(a.avatarUrl)}" alt="" width="20" height="20" /></a>`).join("")}</span>`
    : "";

  const commentsBadge = r.comments > 0
    ? `<a class="oldgh-issues__comments" href="${escapeAttr(`/${v.owner}/${v.repo}/${kind === "pulls" ? "pull" : "issues"}/${r.number}`)}" title="${r.comments} comment${r.comments === 1 ? "" : "s"}">${octicon("comment", { size: 14 })}<span>${r.comments}</span></a>`
    : "";

  const href = `/${v.owner}/${v.repo}/${kind === "pulls" ? "pull" : "issues"}/${r.number}`;

  return `
    <li class="oldgh-issues__row">
      <span class="oldgh-issues__state">${stateIcon}</span>
      <div class="oldgh-issues__body">
        <h3 class="oldgh-issues__title">
          <a href="${escapeAttr(href)}">${emojify(sanitizeTitleHtml(r.titleHtml))}</a>
          ${labels}
        </h3>
        <p class="oldgh-issues__meta">
          #${r.number} ${opened}
          ${r.milestone ? ` <span class="oldgh-issues__milestone">${octicon("milestone", { size: 12 })}<a href="${escapeAttr(r.milestone.url)}">${escapeText(r.milestone.title)}</a></span>` : ""}
        </p>
      </div>
      <div class="oldgh-issues__meta-right">${assignees}${commentsBadge}</div>
    </li>
  `;
}

function renderEmpty(kind: "issues" | "pulls", v: IssueListView): string {
  const noneAtAll = v.openCount === 0 && v.closedCount === 0;
  const inner = noneAtAll
    ? `<div class="oldgh-issues__empty">
        <p>No ${kind} here.</p>
        <p class="oldgh-issues__empty-hint">${kind === "pulls"
          ? "Either no one has opened a pull request yet, or this repository doesn't accept them."
          : "Either nothing has been reported yet, or this repository has issues disabled."}</p>
      </div>`
    : `<p class="oldgh-issues__filter-empty">No ${kind} match the current filters.</p>`;
  return `<div class="oldgh-issues__list oldgh-issues__list--empty">${inner}</div>`;
}

function renderPagination(v: IssueListView, kind: "issues" | "pulls"): string {
  if (!v.pageInfo.hasNext && !v.pageInfo.hasPrevious) return "";
  const url = new URL(`https://github.com/${v.owner}/${v.repo}/${kind}`);
  const params = new URLSearchParams(v.rawQuery);
  const current = parseInt(params.get("page") || "1", 10);
  const prev = makePageUrl(url, params, Math.max(1, current - 1));
  const next = makePageUrl(url, params, current + 1);
  const prevBtn = v.pageInfo.hasPrevious
    ? `<a class="oldgh-btn" href="${escapeAttr(prev)}">${octicon("triangle-left", { size: 14 })}<span>Previous</span></a>`
    : `<button class="oldgh-btn" type="button" disabled>${octicon("triangle-left", { size: 14 })}<span>Previous</span></button>`;
  const nextBtn = v.pageInfo.hasNext
    ? `<a class="oldgh-btn" href="${escapeAttr(next)}"><span>Next</span>${octicon("triangle-right", { size: 14 })}</a>`
    : `<button class="oldgh-btn" type="button" disabled><span>Next</span>${octicon("triangle-right", { size: 14 })}</button>`;
  return `<div class="oldgh-issues__pagination">${prevBtn}${nextBtn}</div>`;
}

function makePageUrl(base: URL, params: URLSearchParams, page: number): string {
  const copy = new URLSearchParams(params);
  if (page <= 1) copy.delete("page");
  else copy.set("page", String(page));
  const search = copy.toString();
  return search ? `${base.pathname}?${search}` : base.pathname;
}

function buildSwappedQuery(currentQuery: string, target: "open" | "closed"): string {
  const cleaned = currentQuery.replace(/\bis:(open|closed)\b/gi, "").replace(/\s+/g, " ").trim();
  return `is:${target}${cleaned ? " " + cleaned : ""}`;
}

import { formatCount } from "@/util/format";

function relativeTimeLink(iso: string, href?: string): string {
  if (!iso) return "";
  const rel = relativeTime(iso);
  const abs = absoluteTime(iso);
  if (href) {
    return `<a href="${escapeAttr(href)}" title="${escapeAttr(abs)}">${escapeText(rel)}</a>`;
  }
  return `<span title="${escapeAttr(abs)}">${escapeText(rel)}</span>`;
}

function sanitizeTitleHtml(html: string): string {
  // GH's titleHtml may contain <g-emoji> or <code> tags — those are safe to keep
  // but strip <script>/<style>/event attributes as a precaution
  return html
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function labelTextColor(hex: string): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#333" : "#fff";
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
