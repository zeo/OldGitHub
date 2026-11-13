import { octicon } from "@/icons";
import { getRepoPulse, type PulseItem, type PulseList, type PulseView } from "@/adapters/repo-pulse";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

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
    main.innerHTML = renderBody(owner, repo, view);
  } catch (err) {
    main.innerHTML = `<div class="oldgh-pulse__empty">Couldn't load pulse data: ${escapeText(err instanceof Error ? err.message : String(err))}</div>`;
  }
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

function renderBody(owner: string, repo: string, v: PulseView): string {
  const prTotal = v.mergedPrs.items.length + v.newPrs.items.length;
  const issueTotal = v.closedIssues.items.length + v.newIssues.items.length;
  const d = v.diffstat;
  const maxCommits = Math.max(1, ...v.committers.map((c) => c.commits));
  return `
    <header class="oldgh-pulse__header">
      <h1>Pulse</h1>
      <p class="oldgh-pulse__period">Period: <strong>1 week</strong>${v.rangeLabel ? `  ·  ${escapeText(v.rangeLabel)}` : ""}</p>
    </header>

    <section class="oldgh-pulse__overview">
      <h2>Overview</h2>
      <div class="oldgh-pulse__columns">
        <section class="oldgh-pulse__col">
          <h3>${octicon("git-pull-request", { size: 14 })} ${prTotal} Active ${prTotal === 1 ? "Pull Request" : "Pull Requests"}</h3>
          <div class="oldgh-pulse__split">
            <div class="oldgh-pulse__split-num oldgh-pulse__split-num--merged">${v.mergedPrs.items.length}<small>Merged</small></div>
            <div class="oldgh-pulse__split-num oldgh-pulse__split-num--open">${v.newPrs.items.length}<small>Proposed</small></div>
          </div>
        </section>
        <section class="oldgh-pulse__col">
          <h3>${octicon("issue-opened", { size: 14 })} ${issueTotal} Active ${issueTotal === 1 ? "Issue" : "Issues"}</h3>
          <div class="oldgh-pulse__split">
            <div class="oldgh-pulse__split-num oldgh-pulse__split-num--closed">${v.closedIssues.items.length}<small>Closed</small></div>
            <div class="oldgh-pulse__split-num oldgh-pulse__split-num--open">${v.newIssues.items.length}<small>New</small></div>
          </div>
        </section>
      </div>
      ${d ? `
        <p class="oldgh-pulse__summary">
          Excluding merges, <strong>${d.authors}</strong> ${d.authors === 1 ? "author has" : "authors have"} pushed
          <strong>${d.branchCommits}</strong> ${d.branchCommits === 1 ? "commit" : "commits"} to ${escapeText(d.branch)}
          and <strong>${d.totalCommits}</strong> ${d.totalCommits === 1 ? "commit" : "commits"} to all branches.
          On ${escapeText(d.branch)}, <strong>${d.filesChanged}</strong> ${d.filesChanged === 1 ? "file has" : "files have"} changed
          and there have been <strong class="oldgh-graphs__add">${d.additions.toLocaleString()}</strong> additions
          and <strong class="oldgh-graphs__del">${d.deletions.toLocaleString()}</strong> deletions.
        </p>` : ""}
      ${v.committers.length ? `
        <ul class="oldgh-pulse__committers">
          ${v.committers.map((c) => `
            <li class="oldgh-pulse__committer">
              ${c.avatarUrl ? `<img src="${escapeAttr(c.avatarUrl)}" width="20" height="20" alt="" />` : ""}
              <a class="oldgh-pulse__committer-name" href="/${escapeAttr(c.login)}">${escapeText(c.login)}</a>
              <div class="oldgh-graphs__bar-wrap"><div class="oldgh-graphs__bar" style="width:${Math.round((c.commits / maxCommits) * 100)}%"></div></div>
              <span class="oldgh-pulse__committer-meta">${c.commits} ${c.commits === 1 ? "commit" : "commits"}</span>
            </li>`).join("")}
        </ul>` : ""}
    </section>

    ${renderList(owner, repo, v.releases, "Release", "Releases", "published", "Published", "merged")}
    ${renderList(owner, repo, v.mergedPrs, "Pull request", "Pull requests", "merged", "Merged", "merged")}
    ${renderList(owner, repo, v.newPrs, "Pull request", "Pull requests", "proposed", "Proposed", "open")}
    ${renderList(owner, repo, v.closedIssues, "Issue", "Issues", "closed", "Closed", "closed")}
    ${renderList(owner, repo, v.newIssues, "Issue", "Issues", "created", "New", "open")}
  `;
}

function renderList(owner: string, repo: string, list: PulseList, one: string, many: string, verb: string, badge: string, tone: string): string {
  const n = list.items.length;
  if (n === 0) return "";
  const by = list.authors ? ` by ${list.authors} ${list.authors === 1 ? "person" : "people"}` : "";
  return `
    <div class="oldgh-pulse__sublist">
      <h4>${n} ${escapeText(n === 1 ? one : many)} ${escapeText(verb)}${by}</h4>
      <ul>
        ${list.items.map((it) => `
          <li>
            <span class="oldgh-pulse__badge oldgh-pulse__split-num--${tone}">${escapeText(badge)}</span>
            <a href="${escapeAttr(localPath(owner, repo, it))}">${escapeText(it.title)}</a>
            <span class="oldgh-pulse__sublist-meta">${/^\d+$/.test(it.ref) ? `#${escapeText(it.ref)}` : escapeText(it.ref)}${it.date ? ` · <span title="${escapeAttr(absoluteTime(it.date))}">${escapeText(relativeTime(it.date))}</span>` : ""}</span>
          </li>
        `).join("")}
      </ul>
    </div>
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

// some paths come back absolute, and a missing one falls back to the item's own number
function localPath(owner: string, repo: string, it: PulseItem): string {
  if (it.path) return it.path.replace(/^https:\/\/github\.com/, "");
  return `/${owner}/${repo}/${/^\d+$/.test(it.ref) ? `issues/${it.ref}` : `releases/tag/${encodeURIComponent(it.ref)}`}`;
}
