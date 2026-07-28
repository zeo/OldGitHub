import { octicon } from "@/icons";
import {
  searchRepositories,
  searchIssues,
  searchUsers,
  searchCodePage,
  searchCommits,
  searchTopics,
  type RepoResult,
  type IssueResult,
  type UserResult,
  type CommitResult,
  type TopicResult,
  type SearchSummary,
  type SearchType,
  type SearchOrder,
} from "@/adapters/search";
import { relativeTime, absoluteTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { languageColor } from "@/util/language-color";
import { adoptBodyRoot, removeAllBodyRoots } from "./_body";

const ROOT_CLASS = "oldgh-search";

const SEARCH_TABS: Array<{ key: SearchType; label: string; icon: string }> = [
  { key: "repositories", label: "Repositories", icon: "repo" },
  { key: "code", label: "Code", icon: "code" },
  { key: "commits", label: "Commits", icon: "git-commit" },
  { key: "issues", label: "Issues", icon: "issue-opened" },
  { key: "pullrequests", label: "Pull requests", icon: "git-pull-request" },
  { key: "users", label: "Users", icon: "person" },
  { key: "topics", label: "Topics", icon: "tag" },
];

export async function mountSearch(_pathname: string, search: string): Promise<void> {
  const params = new URLSearchParams(search);
  const query = params.get("q") ?? "";
  const typeRaw = params.get("type") ?? "repositories";
  const type = mapSearchType(typeRaw);
  const sort = params.get("s") ?? params.get("sort") ?? "best-match";
  const order = (params.get("o") ?? params.get("order")) === "asc" ? "asc" : "desc";

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(query, type);
  adoptBodyRoot(root);

  const resultsEl = root.querySelector<HTMLElement>(".oldgh-search__results");
  if (!resultsEl) return;
  if (!query.trim()) {
    resultsEl.innerHTML = `<div class="oldgh-search__empty">${octicon("search", { size: 36 })}<p>Enter a query above to search GitHub.</p></div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="oldgh-search__loading">Loading results…</div>`;
  const sortCtx: SortContext = { query, type, sort, order: order as SearchOrder };
  try {
    if (type === "repositories") {
      const { summary, items } = await searchRepositories(query, sort, order as SearchOrder);
      resultsEl.innerHTML = renderRepoResults(summary, items, sortCtx);
    } else if (type === "issues" || type === "pullrequests") {
      const { summary, items } = await searchIssues(query, sort, order as SearchOrder, type === "pullrequests");
      resultsEl.innerHTML = renderIssueResults(summary, items, sortCtx);
    } else if (type === "users") {
      const { summary, items } = await searchUsers(query, sort, order as SearchOrder);
      resultsEl.innerHTML = renderUserResults(summary, items, sortCtx);
    } else if (type === "code") {
      const { summary, html } = await searchCodePage(query, sort, order as SearchOrder);
      resultsEl.innerHTML = `${renderResultBar(summary, sortCtx)}<div class="oldgh-search__web-results">${html}</div>`;
    } else if (type === "commits") {
      const { summary, items } = await searchCommits(query, sort, order as SearchOrder);
      resultsEl.innerHTML = renderCommitResults(summary, items, sortCtx);
    } else if (type === "topics") {
      const { summary, items } = await searchTopics(query);
      resultsEl.innerHTML = renderTopicResults(summary, items, sortCtx);
    }
    bindSortControl(resultsEl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate-?limit/i.test(msg)) {
      const fallbackType = type === "pullrequests" ? "pullrequests" : type;
      resultsEl.innerHTML = `
        <div class="oldgh-search__empty">
          ${octicon("clock", { size: 36 })}
          <p>You've hit GitHub's anonymous API rate limit. It resets in a few minutes.</p>
          <p><a href="https://github.com/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(fallbackType)}">Open this search on modern GitHub</a></p>
        </div>
      `;
      return;
    }
    resultsEl.innerHTML = `<div class="oldgh-search__empty"><p>Couldn't load results: ${escapeText(msg)}</p></div>`;
  }
}

export function unmountSearch(): void {
  removeAllBodyRoots();
}

function mapSearchType(raw: string): SearchType {
  switch (raw) {
    case "repositories":
    case "repo":
    case "Repositories":
      return "repositories";
    case "issues":
    case "Issues":
      return "issues";
    case "pullrequests":
    case "pulls":
    case "pr":
      return "pullrequests";
    case "users":
    case "Users":
      return "users";
    case "code":
    case "Code":
      return "code";
    case "commits":
    case "Commits":
      return "commits";
    case "topics":
    case "Topics":
      return "topics";
    default:
      return "repositories";
  }
}

function renderShell(query: string, activeType: SearchType): string {
  const tabs = SEARCH_TABS.map(
    (t) => `<li class="${activeType === t.key ? "is-active" : ""}"><a href="${escapeAttr(searchHref(query, t.key))}">${octicon(t.icon, { size: 14 })}<span>${escapeText(t.label)}</span></a></li>`,
  ).join("");
  return `
    <div class="oldgh-page">
      <header class="oldgh-search__header">
        <h1 class="oldgh-search__title">${query ? `Results for <em>${escapeText(query)}</em>` : "Search"}</h1>
        <form class="oldgh-search__form" action="/search" method="get">
          <input type="search" name="q" value="${escapeAttr(query)}" placeholder="Search GitHub" autocomplete="off" />
          <input type="hidden" name="type" value="${escapeAttr(activeType)}" />
          <button type="submit" class="oldgh-btn oldgh-btn--primary">${octicon("search", { size: 14 })}<span>Search</span></button>
        </form>
      </header>
      <div class="oldgh-search__layout">
        <aside class="oldgh-search__rail">
          <div class="oldgh-search__rail-box">
            <h3>Filter by</h3>
            <ul class="oldgh-search__tabs">${tabs}</ul>
          </div>
        </aside>
        <main class="oldgh-search__results"></main>
      </div>
    </div>
  `;
}

function renderRepoResults(summary: SearchSummary, items: RepoResult[], ctx: SortContext): string {
  if (items.length === 0) return renderEmpty(summary);
  return `
    ${renderResultBar(summary, ctx)}
    <ul class="oldgh-search__list">
      ${items.map((r) => renderRepoRow(r)).join("")}
    </ul>
  `;
}

function renderRepoRow(r: RepoResult): string {
  const langColor = languageColor(r.language);
  return `
    <li class="oldgh-search__row oldgh-search__row--repo">
      <h2 class="oldgh-search__name">
        <img class="oldgh-search__avatar" src="${escapeAttr(r.ownerAvatar)}" width="20" height="20" alt="" />
        <a href="/${escapeAttr(r.ownerLogin)}">${escapeText(r.ownerLogin)}</a> /
        <a href="/${escapeAttr(r.ownerLogin)}/${escapeAttr(r.repoName)}"><strong>${escapeText(r.repoName)}</strong></a>
        ${r.isPrivate ? `<span class="oldgh-search__tag">Private</span>` : ""}
        ${r.isFork ? `<span class="oldgh-search__tag">Fork</span>` : ""}
        ${r.isArchived ? `<span class="oldgh-search__tag oldgh-search__tag--warn">Archived</span>` : ""}
      </h2>
      ${r.description ? `<p class="oldgh-search__desc">${escapeText(r.description)}</p>` : ""}
      ${r.topics.length > 0 ? `<p class="oldgh-search__topics">${r.topics.slice(0, 6).map((t) => `<a class="oldgh-search__topic" href="/topics/${encodeURIComponent(t)}">${escapeText(t)}</a>`).join(" ")}</p>` : ""}
      <ul class="oldgh-search__meta">
        ${r.language ? `<li><span class="oldgh-search__lang-dot" style="background:${langColor}"></span>${escapeText(r.language)}</li>` : ""}
        <li>${octicon("star", { size: 12 })} ${formatCount(r.stargazers)}</li>
        <li>${octicon("repo-forked", { size: 12 })} ${formatCount(r.forks)}</li>
        ${r.license ? `<li>${octicon("law", { size: 12 })} ${escapeText(r.license)}</li>` : ""}
        <li>Updated ${relativeTimeSpan(r.updatedAt)}</li>
      </ul>
    </li>
  `;
}

function renderIssueResults(summary: SearchSummary, items: IssueResult[], ctx: SortContext): string {
  if (items.length === 0) return renderEmpty(summary);
  return `
    ${renderResultBar(summary, ctx)}
    <ul class="oldgh-search__list">
      ${items.map((it) => renderIssueRow(it)).join("")}
    </ul>
  `;
}

function renderIssueRow(it: IssueResult): string {
  let stateIcon = octicon("issue-opened", { size: 14 });
  let stateClass = "oldgh-search__state--open";
  if (it.isPull) {
    if (it.merged) { stateIcon = octicon("git-merge", { size: 14 }); stateClass = "oldgh-search__state--merged"; }
    else if (it.state === "closed") { stateIcon = octicon("git-pull-request", { size: 14 }); stateClass = "oldgh-search__state--closed"; }
    else if (it.draft) { stateIcon = octicon("git-pull-request", { size: 14 }); stateClass = "oldgh-search__state--draft"; }
    else { stateIcon = octicon("git-pull-request", { size: 14 }); stateClass = "oldgh-search__state--open"; }
  } else if (it.state === "closed") {
    stateIcon = octicon("issue-closed", { size: 14 });
    stateClass = "oldgh-search__state--closed";
  }
  const labels = it.labels
    .map((l) => `<span class="oldgh-search__label" style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)};">${escapeText(emojify(l.name))}</span>`)
    .join(" ");
  return `
    <li class="oldgh-search__row oldgh-search__row--issue">
      <span class="oldgh-search__state ${stateClass}">${stateIcon}</span>
      <div class="oldgh-search__issue-main">
        <a class="oldgh-search__issue-title" href="/${escapeAttr(it.repoFullName)}/${it.isPull ? "pull" : "issues"}/${it.number}">${escapeText(it.title)}</a>
        ${labels ? `<div class="oldgh-search__labels">${labels}</div>` : ""}
        <div class="oldgh-search__issue-meta">
          ${escapeText(it.repoFullName)} #${it.number} opened ${relativeTimeSpan(it.createdAt)}
          ${it.user ? `by <a href="/${escapeAttr(it.user.login)}">${escapeText(it.user.login)}</a>` : ""}
          ${it.commentCount > 0 ? `· ${it.commentCount} comment${it.commentCount === 1 ? "" : "s"}` : ""}
        </div>
      </div>
    </li>
  `;
}

function renderUserResults(summary: SearchSummary, items: UserResult[], ctx: SortContext): string {
  if (items.length === 0) return renderEmpty(summary);
  return `
    ${renderResultBar(summary, ctx)}
    <ul class="oldgh-search__list oldgh-search__list--users">
      ${items.map((u) => `
        <li class="oldgh-search__row oldgh-search__row--user">
          <a href="/${escapeAttr(u.login)}" class="oldgh-search__user-avatar" aria-label="View ${escapeAttr(u.login)}'s profile">
            <img src="${escapeAttr(u.avatarUrl)}" width="48" height="48" alt="" />
          </a>
          <div class="oldgh-search__user-main">
            <a class="oldgh-search__user-name" href="/${escapeAttr(u.login)}"><strong>${escapeText(u.login)}</strong></a>
            <span class="oldgh-search__user-type">${escapeText(u.type)}</span>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

// keep the separator and "committed" verb attached so an unlinked author never leaves a dangling middot
function commitAuthorSegment(c: CommitResult): string {
  const author = c.authorLogin
    ? `<a href="/${escapeAttr(c.authorLogin)}">${escapeText(c.authorLogin)}</a> committed`
    : "committed";
  const date = c.date ? relativeTimeSpan(c.date) : "";
  if (!c.authorLogin && !date) return "";
  return ` · ${author}${date ? ` ${date}` : ""}`;
}

function renderCommitResults(summary: SearchSummary, items: CommitResult[], ctx: SortContext): string {
  if (items.length === 0) return renderEmpty(summary);
  return `
    ${renderResultBar(summary, ctx)}
    <ul class="oldgh-search__list">
      ${items.map((c) => `
        <li class="oldgh-search__row oldgh-search__row--commit">
          <div class="oldgh-search__commit-main">
            <a class="oldgh-search__commit-title" href="${c.htmlUrl.replace("https://github.com", "")}">${escapeText(c.messageHeadline)}</a>
            <div class="oldgh-search__commit-meta">
              ${escapeText(c.repoFullName)}${commitAuthorSegment(c)}
            </div>
          </div>
          <code class="oldgh-search__sha"><a href="${c.htmlUrl.replace("https://github.com", "")}">${escapeText(c.abbrevSha)}</a></code>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderTopicResults(summary: SearchSummary, items: TopicResult[], ctx: SortContext): string {
  if (items.length === 0) return renderEmpty(summary);
  return `
    ${renderResultBar(summary, ctx)}
    <ul class="oldgh-search__list">
      ${items.map((t) => `
        <li class="oldgh-search__row oldgh-search__row--topic">
          <h2 class="oldgh-search__name">
            <a href="/topics/${encodeURIComponent(t.name)}"><strong>${escapeText(t.displayName || t.name)}</strong></a>
            ${t.featured ? `<span class="oldgh-search__tag">Featured</span>` : ""}
          </h2>
          ${t.shortDescription ? `<p class="oldgh-search__desc">${escapeText(t.shortDescription)}</p>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

type SortContext = {
  query: string;
  type: SearchType;
  sort: string;
  order: SearchOrder;
};

const SORT_OPTIONS: Record<SearchType, Array<{ value: string; label: string }>> = {
  repositories: [
    { value: "best-match", label: "Best match" },
    { value: "stars", label: "Most stars" },
    { value: "forks", label: "Most forks" },
    { value: "updated", label: "Recently updated" },
  ],
  issues: [
    { value: "best-match", label: "Best match" },
    { value: "created", label: "Newest" },
    { value: "updated", label: "Recently updated" },
    { value: "comments", label: "Most commented" },
  ],
  pullrequests: [
    { value: "best-match", label: "Best match" },
    { value: "created", label: "Newest" },
    { value: "updated", label: "Recently updated" },
    { value: "comments", label: "Most commented" },
  ],
  users: [
    { value: "best-match", label: "Best match" },
    { value: "followers", label: "Most followers" },
    { value: "repositories", label: "Most repositories" },
    { value: "joined", label: "Recently joined" },
  ],
  code: [
    { value: "best-match", label: "Best match" },
    { value: "indexed", label: "Recently indexed" },
  ],
  commits: [
    { value: "best-match", label: "Best match" },
    { value: "author-date", label: "Author date" },
    { value: "committer-date", label: "Committer date" },
  ],
  topics: [
    { value: "best-match", label: "Best match" },
  ],
};

function renderResultBar(s: SearchSummary, ctx: SortContext): string {
  const count = formatCount(s.totalCount);
  const options = SORT_OPTIONS[ctx.type] || [{ value: "best-match", label: "Best match" }];
  const showSort = options.length > 1;
  return `
    <div class="oldgh-search__bar">
      <div class="oldgh-search__count"><strong>${count}</strong> ${s.totalCount === 1 ? "result" : "results"}${s.incompleteResults ? " (partial)" : ""}</div>
      ${showSort ? `
        <label class="oldgh-search__sort">
          <span>Sort:</span>
          <select data-oldgh-sort>
            ${options.map((o) => `<option value="${escapeAttr(o.value)}"${o.value === ctx.sort ? " selected" : ""}>${escapeText(o.label)}</option>`).join("")}
          </select>
        </label>` : ""}
    </div>
  `;
}

function bindSortControl(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("select[data-oldgh-sort]");
  if (!select) return;
  select.addEventListener("change", () => {
    const params = new URLSearchParams(window.location.search);
    const value = select.value;
    if (value === "best-match") {
      params.delete("s");
      params.delete("o");
    } else {
      params.set("s", value);
      params.set("o", "desc");
    }
    const href = `/search?${params.toString()}`;
    history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function renderEmpty(_s: SearchSummary): string {
  return `<div class="oldgh-search__empty">${octicon("search", { size: 36 })}<p>No matches found. Try a different query.</p></div>`;
}

function searchHref(query: string, type: SearchType): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("type", type);
  return `/search?${params.toString()}`;
}

function relativeTimeSpan(iso: string): string {
  if (!iso) return "";
  return `<span title="${escapeAttr(absoluteTime(iso))}">${escapeText(relativeTime(iso))}</span>`;
}

import { formatCount } from "@/util/format";

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
