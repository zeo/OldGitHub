import { octicon } from "@/icons";
import { getRepoPulse, type PulseView, type PulseIssueRef, type PulseCommitRef } from "@/adapters/repo-pulse";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-pulse";

export async function mountRepoPulse(owner: string, repo: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(owner, repo);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-pulse__main");
  if (!main) return;
  try {
    const view = await getRepoPulse(owner, repo);
    main.innerHTML = renderBody(view);
  } catch (err) {
    main.innerHTML = `<div class="oldgh-pulse__empty">Couldn't load pulse data: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

export function unmountRepoPulse(): void {
  removeAllBodyRoots();
}

function renderShell(_owner: string, _repo: string): string {
  return `
    <div class="oldgh-page">
      <div class="oldgh-pulse__layout">
        <aside class="oldgh-pulse__sidebar">
          ${renderInsightsNav("pulse")}
        </aside>
        <main class="oldgh-pulse__main">
          <div class="oldgh-pulse__loading">Loading pulse for the last 7 days…</div>
        </main>
      </div>
    </div>
  `;
}

function renderBody(v: PulseView): string {
  const sinceLabel = formatDate(v.sinceIso);
  const todayLabel = formatDate(new Date().toISOString());
  // header must reconcile with the open/merged split shown below
  const totalPrActivity = v.openedPrs.length + v.mergedPrs.length;
  const authorCount = countCommitAuthors(v.commits);
  const totalIssueActivity = v.openedIssues.length + v.closedIssues.length;
  return `
    <header class="oldgh-pulse__header">
      <h1>Pulse</h1>
      <p class="oldgh-pulse__period">Period: <strong>1 week</strong>  ·  ${escapeText(sinceLabel)} – ${escapeText(todayLabel)}</p>
    </header>

    <section class="oldgh-pulse__overview">
      <h2>Overview</h2>
      <p class="oldgh-pulse__summary">
        Excluding merges, <strong>${authorCount}</strong>
        ${authorCount === 1 ? "author has" : "authors have"} pushed
        <strong>${v.commits.length}</strong> ${v.commits.length === 1 ? "commit" : "commits"} this week.
        <strong>${v.openedPrs.length}</strong> ${v.openedPrs.length === 1 ? "pull request" : "pull requests"} opened,
        <strong>${v.mergedPrs.length}</strong> merged,
        <strong>${v.openedIssues.length}</strong> ${v.openedIssues.length === 1 ? "issue" : "issues"} opened,
        <strong>${v.closedIssues.length}</strong> ${v.closedIssues.length === 1 ? "issue" : "issues"} closed.
      </p>
    </section>

    <div class="oldgh-pulse__columns">
      <section class="oldgh-pulse__col">
        <h3>${octicon("git-pull-request", { size: 14 })} ${totalPrActivity} Active Pull Requests</h3>
        <div class="oldgh-pulse__split">
          <div class="oldgh-pulse__split-num oldgh-pulse__split-num--open">${v.openedPrs.length}<small>Open</small></div>
          <div class="oldgh-pulse__split-num oldgh-pulse__split-num--merged">${v.mergedPrs.length}<small>Merged</small></div>
        </div>
        ${renderIssueList("Recently opened pull requests", v.openedPrs.slice(0, 5))}
        ${renderIssueList("Recently merged pull requests", v.mergedPrs.slice(0, 5))}
      </section>

      <section class="oldgh-pulse__col">
        <h3>${octicon("issue-opened", { size: 14 })} ${totalIssueActivity} Active Issues</h3>
        <div class="oldgh-pulse__split">
          <div class="oldgh-pulse__split-num oldgh-pulse__split-num--open">${v.openedIssues.length}<small>Opened</small></div>
          <div class="oldgh-pulse__split-num oldgh-pulse__split-num--closed">${v.closedIssues.length}<small>Closed</small></div>
        </div>
        ${renderIssueList("Recently opened issues", v.openedIssues.slice(0, 5))}
        ${renderIssueList("Recently closed issues", v.closedIssues.slice(0, 5))}
      </section>
    </div>

    <section class="oldgh-pulse__commits">
      <h3>${octicon("git-commit", { size: 14 })} ${v.commits.length} Commits in the last 7 days</h3>
      ${v.commits.length === 0
        ? `<p class="oldgh-pulse__empty">No commits in this period.</p>`
        : `<ul class="oldgh-pulse__commit-list">${v.commits.slice(0, 25).map(renderCommitRow).join("")}</ul>`}
    </section>
  `;
}

function renderIssueList(title: string, items: PulseIssueRef[]): string {
  if (items.length === 0) return "";
  return `
    <div class="oldgh-pulse__sublist">
      <h4>${escapeText(title)}</h4>
      <ul>
        ${items.map((it) => `
          <li>
            ${linkOrText(it.htmlUrl, it.title)}
            <span class="oldgh-pulse__sublist-meta">#${it.number} ${it.user ? `· ${escapeText(it.user.login)}` : ""}</span>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderCommitRow(c: PulseCommitRef): string {
  return `
    <li class="oldgh-pulse__commit">
      ${c.authorAvatar ? `<img src="${escapeAttr(c.authorAvatar)}" width="20" height="20" alt="" />` : ""}
      ${linkOrText(c.htmlUrl, c.headline, "oldgh-pulse__commit-msg")}
      <code class="oldgh-pulse__commit-sha">${linkOrText(c.htmlUrl, c.abbrevSha)}</code>
      <span class="oldgh-pulse__commit-meta">
        ${c.authorLogin ? `<a href="/${escapeAttr(c.authorLogin)}">${escapeText(c.authorLogin)}</a>` : ""}
        ${c.date ? `<span title="${escapeAttr(absoluteTime(c.date))}">${escapeText(relativeTime(c.date))}</span>` : ""}
      </span>
    </li>
  `;
}

export function renderInsightsNav(active: "pulse" | "contributors" | "commit-activity" | "code-frequency" | "traffic" | "network" | "forks" | "community" | "dependency-graph"): string {
  const items: Array<{ key: typeof active; label: string; href: (owner: string, repo: string) => string }> = [
    { key: "pulse", label: "Pulse", href: (o, r) => `/${o}/${r}/pulse` },
    { key: "contributors", label: "Contributors", href: (o, r) => `/${o}/${r}/graphs/contributors` },
    { key: "community", label: "Community standards", href: (o, r) => `/${o}/${r}/community` },
    { key: "commit-activity", label: "Commits", href: (o, r) => `/${o}/${r}/graphs/commit-activity` },
    { key: "code-frequency", label: "Code frequency", href: (o, r) => `/${o}/${r}/graphs/code-frequency` },
    { key: "traffic", label: "Traffic", href: (o, r) => `/${o}/${r}/graphs/traffic` },
    { key: "dependency-graph", label: "Dependency graph", href: (o, r) => `/${o}/${r}/network/dependencies` },
    { key: "network", label: "Network", href: (o, r) => `/${o}/${r}/network` },
    { key: "forks", label: "Forks", href: (o, r) => `/${o}/${r}/forks` },
  ];
  // owner/repo come from the URL — read from window
  const m = /^\/([^\/]+)\/([^\/]+)/.exec(window.location.pathname);
  const owner = m && m[1] ? m[1] : "";
  const repo = m && m[2] ? m[2] : "";
  return `
    <div class="oldgh-pulse__nav">
      <h3>Insights</h3>
      <ul>
        ${items.map((it) => `<li class="${active === it.key ? "is-active" : ""}"><a href="${escapeAttr(it.href(owner, repo))}">${escapeText(it.label)}</a></li>`).join("")}
      </ul>
    </div>
  `;
}

// emit an anchor only when the url is present; an empty href would navigate
// to the current page, so fall back to plain text in that case
function linkOrText(htmlUrl: string, text: string, className?: string): string {
  const cls = className ? ` class="${className}"` : "";
  if (!htmlUrl) return `<span${cls}>${escapeText(text)}</span>`;
  const href = htmlUrl.replace("https://github.com", "");
  return `<a${cls} href="${escapeAttr(href)}">${escapeText(text)}</a>`;
}

// count distinct authors by a stable identity so unlinked (bot/ci/noreply)
// commits still register an author and the count is never 0 while commits exist
function countCommitAuthors(commits: PulseCommitRef[]): number {
  const seen = new Set<string>();
  for (const c of commits) {
    seen.add(c.authorLogin || c.authorAvatar || c.sha);
  }
  return seen.size;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
