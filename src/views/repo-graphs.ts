import {
  getRepoContributors,
  getRepoCommitActivity,
  getRepoCodeFrequency,
  getCommunityProfile,
  getRepoForks,
  type ContributorsView,
  type ContributorEntry,
  type CommitActivityView,
  type CodeFrequencyView,
  type CommunityView,
  type CommunityFile,
  type NetworkView,
  type NetworkFork,
} from "@/adapters/repo-graphs";
import { octicon } from "@/icons";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { renderInsightsNav } from "./repo-pulse";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-graphs";

export type GraphsSubkind = "contributors" | "commit-activity" | "code-frequency" | "traffic" | "community" | "network";

export async function mountRepoGraphs(owner: string, repo: string, subkind: GraphsSubkind): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${subkind}`;
  root.innerHTML = renderShell(subkind);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-graphs__main");
  if (!main) return;
  try {
    if (subkind === "contributors") {
      const view = await getRepoContributors(owner, repo);
      main.innerHTML = renderContributors(view);
    } else if (subkind === "commit-activity") {
      const view = await getRepoCommitActivity(owner, repo);
      main.innerHTML = renderCommitActivity(view);
    } else if (subkind === "code-frequency") {
      const view = await getRepoCodeFrequency(owner, repo);
      main.innerHTML = renderCodeFrequency(view);
    } else if (subkind === "community") {
      const view = await getCommunityProfile(owner, repo);
      main.innerHTML = renderCommunity(owner, repo, view);
    } else if (subkind === "network") {
      const view = await getRepoForks(owner, repo);
      main.innerHTML = renderNetwork(view);
    } else {
      main.innerHTML = `<div class="oldgh-graphs__empty">${escapeText(graphTitle(subkind))} view isn't built natively yet — open the modern GitHub page <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/graphs/${escapeAttr(subkind)}">here</a>.</div>`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/422/.test(msg)) {
      main.innerHTML = `<div class="oldgh-graphs__empty">This repository is too large for the stats endpoint to return — open the modern view <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/graphs/${escapeAttr(subkind)}">here</a>.</div>`;
    } else {
      main.innerHTML = `<div class="oldgh-graphs__empty">Couldn't load: ${escapeText(msg)}</div>`;
    }
  }
}

function renderShell(subkind: GraphsSubkind): string {
  return `
    <div class="oldgh-page">
      <div class="oldgh-pulse__layout">
        <aside class="oldgh-pulse__sidebar">
          ${renderInsightsNav(subkind)}
        </aside>
        <main class="oldgh-graphs__main oldgh-pulse__main">
          <div class="oldgh-graphs__loading">Loading ${escapeText(graphTitle(subkind).toLowerCase())}…</div>
        </main>
      </div>
    </div>
  `;
}

function renderContributors(v: ContributorsView): string {
  if (v.status === "computing") {
    return `
      <div class="oldgh-graphs__empty">
        <p>GitHub is computing contributor stats for this repo. Refresh the page in a moment to see them.</p>
      </div>
    `;
  }
  if (v.entries.length === 0) {
    return `<div class="oldgh-graphs__empty">No contributors recorded for this repository.</div>`;
  }
  const maxCommits = Math.max(1, ...v.entries.map((e) => e.totalCommits));
  return `
    <header class="oldgh-graphs__header">
      <h1>Contributors</h1>
      <p class="oldgh-graphs__sub"><strong>${v.entries.length}</strong> ${v.entries.length === 1 ? "contributor" : "contributors"} ranked by commits</p>
    </header>
    <ol class="oldgh-graphs__contributors">
      ${v.entries.slice(0, 100).map((c, i) => renderContributor(c, i + 1, maxCommits)).join("")}
    </ol>
  `;
}

function renderContributor(c: ContributorEntry, rank: number, maxCommits: number): string {
  const sparkline = renderSparkline(c.weeks);
  return `
    <li class="oldgh-graphs__contrib">
      <span class="oldgh-graphs__rank">#${rank}</span>
      <a class="oldgh-graphs__avatar" href="/${escapeAttr(c.login)}" aria-label="View ${escapeAttr(c.login)}'s profile">
        <img src="${escapeAttr(c.avatarUrl)}" width="40" height="40" alt="" />
      </a>
      <div class="oldgh-graphs__contrib-main">
        <a class="oldgh-graphs__name" href="/${escapeAttr(c.login)}"><strong>${escapeText(c.login)}</strong></a>
        <div class="oldgh-graphs__contrib-meta">
          <strong>${c.totalCommits.toLocaleString()}</strong> ${c.totalCommits === 1 ? "commit" : "commits"}
          · <span class="oldgh-graphs__add">+${c.totalAdditions.toLocaleString()}</span>
          · <span class="oldgh-graphs__del">−${c.totalDeletions.toLocaleString()}</span>
        </div>
      </div>
      <div class="oldgh-graphs__bar-wrap">
        <div class="oldgh-graphs__bar" style="width:${Math.round((c.totalCommits / maxCommits) * 100)}%"></div>
      </div>
      <div class="oldgh-graphs__spark">${sparkline}</div>
    </li>
  `;
}

function renderSparkline(weeks: Array<{ ts: number; commits: number }>): string {
  if (weeks.length === 0) return "";
  const tail = weeks.slice(-52);
  const max = Math.max(1, ...tail.map((w) => w.commits));
  const bars = tail
    .map((w) => `<span class="oldgh-spark-bar" style="height:${Math.max(2, Math.round((w.commits / max) * 24))}px" title="${w.commits} ${w.commits === 1 ? "commit" : "commits"} week of ${new Date(w.ts * 1000).toISOString().slice(0, 10)}"></span>`)
    .join("");
  return `<div class="oldgh-spark">${bars}</div>`;
}

function renderCommitActivity(v: CommitActivityView): string {
  if (v.status === "computing") {
    return `<div class="oldgh-graphs__empty"><p>GitHub is computing commit activity stats. Refresh the page in a moment.</p></div>`;
  }
  if (v.weeks.length === 0) {
    return `<div class="oldgh-graphs__empty">No commit activity recorded.</div>`;
  }
  const max = Math.max(1, ...v.weeks.map((w) => w.total));
  const total = v.weeks.reduce((s, w) => s + w.total, 0);
  const avg = Math.round(total / Math.max(1, v.weeks.length));
  return `
    <header class="oldgh-graphs__header">
      <h1>Commit activity</h1>
      <p class="oldgh-graphs__sub">
        <strong>${total.toLocaleString()}</strong> ${total === 1 ? "commit" : "commits"} over the last 52 weeks
        · average <strong>${avg}</strong> per week
      </p>
    </header>
    <div class="oldgh-graphs__activity">
      ${renderActivityChart(v.weeks, max)}
      <ol class="oldgh-graphs__week-list">
        ${v.weeks.slice().reverse().slice(0, 12).map(renderWeekRow).join("")}
      </ol>
    </div>
  `;
}

function renderActivityChart(weeks: CommitActivityView["weeks"], max: number): string {
  const bars = weeks
    .map((w) => `<span class="oldgh-activity-bar" style="height:${Math.max(2, Math.round((w.total / max) * 110))}px" title="${w.total} ${w.total === 1 ? "commit" : "commits"} — week of ${formatWeek(w.ts)}"></span>`)
    .join("");
  return `<div class="oldgh-activity-chart">${bars}</div>`;
}

function renderWeekRow(w: CommitActivityView["weeks"][number]): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peak = Math.max(0, ...w.days);
  const days = w.days
    .map((c, i) => `<span class="oldgh-week-day" title="${escapeText(dayNames[i] ?? "")}: ${c} commits"><span class="oldgh-week-day-bar" style="height:${peak > 0 ? Math.max(2, Math.round((c / peak) * 18)) : 2}px"></span></span>`)
    .join("");
  return `
    <li class="oldgh-graphs__week-row">
      <span class="oldgh-graphs__week-date">Week of ${escapeText(formatWeek(w.ts))}</span>
      <span class="oldgh-graphs__week-count">${w.total} ${w.total === 1 ? "commit" : "commits"}</span>
      <div class="oldgh-week-days">${days}</div>
    </li>
  `;
}

function renderCodeFrequency(v: CodeFrequencyView): string {
  if (v.status === "computing") {
    return `<div class="oldgh-graphs__empty"><p>GitHub is computing code frequency stats. Refresh the page in a moment.</p></div>`;
  }
  if (v.points.length === 0) {
    return `<div class="oldgh-graphs__empty">No code frequency data recorded.</div>`;
  }
  const totalAdd = v.points.reduce((s, p) => s + p.additions, 0);
  const totalDel = v.points.reduce((s, p) => s + Math.abs(p.deletions), 0);
  const maxAbs = Math.max(1, ...v.points.map((p) => Math.max(p.additions, Math.abs(p.deletions))));
  return `
    <header class="oldgh-graphs__header">
      <h1>Code frequency</h1>
      <p class="oldgh-graphs__sub">
        Total <span class="oldgh-graphs__add">+${totalAdd.toLocaleString()}</span>
        / <span class="oldgh-graphs__del">−${totalDel.toLocaleString()}</span>
        across <strong>${v.points.length}</strong> weeks
      </p>
    </header>
    <div class="oldgh-codefreq">
      ${renderCodeFreqChart(v.points, maxAbs)}
      <div class="oldgh-codefreq__legend">
        <span><span class="oldgh-codefreq__swatch oldgh-codefreq__swatch--add"></span> Additions</span>
        <span><span class="oldgh-codefreq__swatch oldgh-codefreq__swatch--del"></span> Deletions</span>
      </div>
    </div>
  `;
}

function renderCodeFreqChart(points: CodeFrequencyView["points"], maxAbs: number): string {
  const tail = points.slice(-104); // up to 2 years
  return `
    <div class="oldgh-codefreq__chart">
      ${tail.map((p) => `
        <div class="oldgh-codefreq__col" title="Week of ${formatWeek(p.ts)} — +${p.additions} / −${Math.abs(p.deletions)}">
          <span class="oldgh-codefreq__add" style="height:${Math.round((p.additions / maxAbs) * 60)}px"></span>
          <span class="oldgh-codefreq__zero"></span>
          <span class="oldgh-codefreq__del" style="height:${Math.round((Math.abs(p.deletions) / maxAbs) * 60)}px"></span>
        </div>
      `).join("")}
    </div>
  `;
}

function formatWeek(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function graphTitle(subkind: GraphsSubkind): string {
  switch (subkind) {
    case "contributors": return "Contributors";
    case "commit-activity": return "Commit activity";
    case "code-frequency": return "Code frequency";
    case "traffic": return "Traffic";
    case "community": return "Community";
    case "network": return "Network";
  }
}

function renderCommunity(owner: string, repo: string, v: CommunityView): string {
  const present = v.files.filter((f) => f.present).length;
  const total = v.files.length;
  const pct = v.healthPercentage || Math.round((present / Math.max(1, total)) * 100);
  const grade = pct >= 90 ? "A" : pct >= 70 ? "B" : pct >= 50 ? "C" : "D";
  const gradeClass = pct >= 90 ? "a" : pct >= 70 ? "b" : pct >= 50 ? "c" : "d";
  return `
    <header class="oldgh-graphs__header">
      <h1>Community Standards</h1>
      <p class="oldgh-graphs__sub">How this repository compares to <a href="https://opensource.guide/" rel="noreferrer">recommended community standards</a>.</p>
    </header>
    <div class="oldgh-community">
      <div class="oldgh-community__score">
        <div class="oldgh-community__grade oldgh-community__grade--${gradeClass}">
          <span class="oldgh-community__grade-letter">${grade}</span>
          <span class="oldgh-community__grade-pct">${pct}%</span>
        </div>
        <div class="oldgh-community__score-text">
          <strong>${present} of ${total}</strong> recommended items present.
          <p>Maintainers ship faster when a repo is welcoming to new contributors. Each item below is a small but real lift.</p>
        </div>
      </div>
      <ul class="oldgh-community__checklist">
        ${v.files.map((f) => renderCommunityRow(owner, repo, f)).join("")}
      </ul>
      ${v.updatedAt ? `<p class="oldgh-community__updated">Updated <time datetime="${escapeAttr(v.updatedAt)}" title="${escapeAttr(absoluteTime(v.updatedAt))}">${escapeText(relativeTime(v.updatedAt))}</time></p>` : ""}
    </div>
  `;
}

function renderCommunityRow(owner: string, repo: string, f: CommunityFile): string {
  const icon = f.present
    ? `<span class="oldgh-community__check oldgh-community__check--on">${octicon("check", { size: 14 })}</span>`
    : `<span class="oldgh-community__check oldgh-community__check--off">${octicon("primitive-dot", { size: 14 })}</span>`;
  const setupHref = communitySetupHref(owner, repo, f.key);
  const link = f.htmlUrl
    ? `<a class="oldgh-community__link" href="${escapeAttr(f.htmlUrl.replace("https://github.com", ""))}">${escapeText(f.label)}</a>`
    : `<span class="oldgh-community__label">${escapeText(f.label)}</span>`;
  return `
    <li class="oldgh-community__row ${f.present ? "is-present" : "is-missing"}">
      ${icon}
      ${link}
      ${!f.present && setupHref
        ? `<a class="oldgh-btn oldgh-community__add" href="${escapeAttr(setupHref)}">Add</a>`
        : ""}
    </li>
  `;
}

function communitySetupHref(owner: string, repo: string, key: string): string | null {
  switch (key) {
    case "description":
      return `/${owner}/${repo}/settings`;
    case "readme":
      return `/${owner}/${repo}/new/HEAD?filename=README.md`;
    case "license":
      return `/${owner}/${repo}/community/license/new?branch=HEAD`;
    case "contributing":
      return `/${owner}/${repo}/new/HEAD?filename=CONTRIBUTING.md`;
    case "code_of_conduct":
    case "code_of_conduct_file":
      return `/${owner}/${repo}/community/code-of-conduct/new?branch=HEAD`;
    case "issue_template":
      return `/${owner}/${repo}/issues/templates/edit`;
    case "pull_request_template":
      return `/${owner}/${repo}/new/HEAD?filename=.github/PULL_REQUEST_TEMPLATE.md`;
    case "security":
      return `/${owner}/${repo}/security/policy/edit`;
    default:
      return null;
  }
}

function renderNetwork(v: NetworkView): string {
  if (v.totalForks === 0 && v.forks.length === 0) {
    return `
      <header class="oldgh-graphs__header">
        <h1>Network</h1>
        <p class="oldgh-graphs__sub">No one has forked this repository yet.</p>
      </header>
    `;
  }
  return `
    <header class="oldgh-graphs__header">
      <h1>Network</h1>
      <p class="oldgh-graphs__sub">
        Showing <strong>${v.forks.length}</strong> of <strong>${v.totalForks.toLocaleString()}</strong>
        ${v.totalForks === 1 ? "fork" : "forks"} of <strong>${escapeText(v.owner)}/${escapeText(v.repo)}</strong>.
      </p>
    </header>
    <ul class="oldgh-network">
      ${v.forks.map(renderNetworkRow).join("")}
    </ul>
  `;
}

function renderNetworkRow(f: NetworkFork): string {
  return `
    <li class="oldgh-network__row">
      <a class="oldgh-network__avatar" href="/${escapeAttr(f.ownerLogin)}" aria-label="View ${escapeAttr(f.ownerLogin)}'s profile">
        <img src="${escapeAttr(f.ownerAvatar)}" width="32" height="32" alt="" />
      </a>
      <div class="oldgh-network__main">
        <h3 class="oldgh-network__title">
          <a href="/${escapeAttr(f.ownerLogin)}/${escapeAttr(f.repoName)}">${escapeText(f.ownerLogin)}/<strong>${escapeText(f.repoName)}</strong></a>
        </h3>
        ${f.description ? `<p class="oldgh-network__desc">${escapeText(f.description)}</p>` : ""}
        <ul class="oldgh-network__meta">
          <li>${octicon("star", { size: 12 })} ${f.stars.toLocaleString()}</li>
          <li>${octicon("repo-forked", { size: 12 })} ${f.forks.toLocaleString()}</li>
          <li>${octicon("git-branch", { size: 12 })} ${escapeText(f.defaultBranch)}</li>
          ${f.pushedAt ? `<li>Pushed <time datetime="${escapeAttr(f.pushedAt)}" title="${escapeAttr(absoluteTime(f.pushedAt))}">${escapeText(relativeTime(f.pushedAt))}</time></li>` : ""}
        </ul>
      </div>
    </li>
  `;
}
