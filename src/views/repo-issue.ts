import { octicon } from "@/icons";
import {
  getIssue,
  getIssueFromPage,
  fillTimelineGap,
  getPull,
  getPullFromPage,
  getPullFiles,
  getPullCommits,
  getPullChecks,
  getReviewThreads,
  type IssueDetail,
  type PullDetail,
  type PullFile,
  type PullCommit,
  type CheckRun,
  type ReviewThread,
} from "@/adapters/repo-issue";
import { AdapterFailure } from "@/adapters";
import { isApiRateLimited } from "@/adapters/rate-limit";
import { adoptBodyRoot, navigationToken } from "./_body";
import { renderHunks } from "./_diff-table";
import { relativeTimeLink, renderReviewThread, renderSidebar, renderTimelineGroup } from "./_repo-issue-timeline";
import { type DiffLine } from "@/util/diff";
import { escapeAttr, escapeText, safeAttrHref, sanitizeHtml } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-issue";

export type IssueTab = "conversation" | "files" | "commits" | "checks";

export async function mountRepoIssue(
  owner: string,
  repo: string,
  number: number,
  kind: "issue" | "pull",
  tab: IssueTab = "conversation",
): Promise<void> {
  const nav = navigationToken();
  const view = kind === "pull" ? await loadPull(owner, repo, number, tab) : await loadIssue(owner, repo, number);
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, kind, tab);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;
  if (kind === "pull" && tab !== "conversation") {
    void hydrateSubTab(root, view as PullDetail, tab);
  }
}

// the page also covers private repos, where the anonymous api answers 404
async function loadIssue(owner: string, repo: string, number: number): Promise<IssueDetail> {
  try {
    return await fillTimelineGap(await getIssueFromPage(owner, repo, number));
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    return getIssue(owner, repo, number);
  }
}

// only the conversation needs the api's labels, comments and reviews; the other tabs' headers come from the page
async function loadPull(owner: string, repo: string, number: number, tab: IssueTab): Promise<PullDetail> {
  if (tab !== "conversation") {
    try {
      return await getPullFromPage(owner, repo, number, tab);
    } catch (err) {
      if (!(err instanceof AdapterFailure)) throw err;
      return getPull(owner, repo, number);
    }
  }
  try {
    return await getPull(owner, repo, number);
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    return getPullFromPage(owner, repo, number).catch(() => Promise.reject(err));
  }
}

async function hydrateSubTab(root: HTMLElement, pull: PullDetail, tab: IssueTab): Promise<void> {
  const { owner, repo, number } = pull;
  const container = root.querySelector<HTMLElement>(".oldgh-issue__subtab");
  if (!container) return;
  try {
    if (tab === "files") {
      const [files, threads] = await Promise.all([
        getPullFiles(pull),
        pull.threadsMissing ? getReviewThreads(owner, repo, number).catch((err: unknown) => {
          if (err instanceof AdapterFailure) return pull.reviewThreads;
          throw err;
        }) : pull.reviewThreads,
      ]);
      container.innerHTML = renderPullFiles(files, threads, `/${owner}/${repo}/pull/${number}`);
      if (pull.changedFiles == null) {
        root.querySelector(".oldgh-issue__pr-tabs .is-active a")?.insertAdjacentHTML("beforeend", `<span class="oldgh-issue__pr-tab-count">${files.length}</span>`);
      }
      return;
    }
    if (tab === "commits") {
      const commits = await getPullCommits(owner, repo, number);
      container.innerHTML = renderPullCommits(owner, repo, commits);
      return;
    }
    if (tab === "checks") {
      const checks = await getPullChecks(owner, repo, pull.headSha);
      container.innerHTML = renderPullChecks(checks);
      return;
    }
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    container.innerHTML = `<p class="oldgh-issue__subtab-empty">Couldn't load this tab${isApiRateLimited() ? ": GitHub's API limit is used up" : ""}. <a href="#" data-oldgh-show-native>Show it on GitHub</a>.</p>`;
  }
}

function renderPullFiles(files: PullFile[], threads: ReviewThread[], pullPath: string): string {
  if (files.length === 0) {
    return `<p class="oldgh-issue__subtab-empty">No file changes.</p>`;
  }
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const summary = `
    <div class="oldgh-pr-files__summary">
      Showing <strong>${files.length}</strong> changed ${files.length === 1 ? "file" : "files"}
      with <strong class="oldgh-pr-files__add">${totalAdd}</strong> additions
      and <strong class="oldgh-pr-files__del">${totalDel}</strong> deletions
    </div>
  `;
  const byPath = groupBy(threads, (t) => t.path);
  const blocks = files.map((f) => renderPullFile(f, byPath.get(f.filename) ?? [], pullPath)).join("");
  return `<div class="oldgh-pr-files">${summary}${blocks}</div>`;
}

function renderPullFile(f: PullFile, threads: ReviewThread[], pullPath: string): string {
  const activeByAnchor = new Map<string, ReviewThread[]>();
  for (const t of threads) {
    if (t.outdated || t.line == null) continue;
    const key = `${t.side}:${t.line}`;
    const list = activeByAnchor.get(key) ?? [];
    list.push(t);
    activeByAnchor.set(key, list);
  }
  const placed = new Set<ReviewThread>();
  const threadsAfter = (l: DiffLine): string => {
    const here: ReviewThread[] = [];
    if (l.kind !== "add" && l.kind !== "no-newline" && l.old != null) {
      for (const t of activeByAnchor.get(`LEFT:${l.old}`) ?? []) {
        if (!placed.has(t)) { placed.add(t); here.push(t); }
      }
    }
    if (l.kind !== "del" && l.kind !== "no-newline" && l.new != null) {
      for (const t of activeByAnchor.get(`RIGHT:${l.new}`) ?? []) {
        if (!placed.has(t)) { placed.add(t); here.push(t); }
      }
    }
    return here.length ? `<tr class="oldgh-diff__threads"><td colspan="3">${here.map((t) => renderReviewThread(t, pullPath, false)).join("")}</td></tr>` : "";
  };
  const statusLabel = f.status === "renamed" && f.previousFilename
    ? `${escapeText(f.previousFilename)} → ${escapeText(f.filename)}`
    : escapeText(f.filename);
  const hunk = f.hunks.length
    ? renderHunks(f.hunks, threadsAfter)
    : `<div class="oldgh-pr-file__nopatch">Binary or large file, view on <a href="${safeAttrHref(f.blobUrl)}">GitHub</a>.</div>`;
  const unplaced = threads.filter((t) => !placed.has(t));
  return `
    <div class="oldgh-pr-file" data-status="${escapeAttr(f.status)}">
      <div class="oldgh-pr-file__header">
        <span class="oldgh-pr-file__name">${statusLabel}</span>
        <span class="oldgh-pr-file__counts">
          <span class="oldgh-pr-file__add">+${f.additions}</span>
          <span class="oldgh-pr-file__del">−${f.deletions}</span>
        </span>
      </div>
      ${unplaced.length ? `<div class="oldgh-pr-file__threads">${unplaced.map((t) => renderReviewThread(t, pullPath, true)).join("")}</div>` : ""}
      <div class="oldgh-pr-file__diff">${hunk}</div>
    </div>
  `;
}

function renderPullCommits(owner: string, repo: string, commits: PullCommit[]): string {
  if (commits.length === 0) {
    return `<p class="oldgh-issue__subtab-empty">No commits in this pull request.</p>`;
  }
  const groups = new Map<string, PullCommit[]>();
  for (const c of commits) {
    const day = c.committerDate ? c.committerDate.slice(0, 10) : "";
    const list = groups.get(day) ?? [];
    list.push(c);
    groups.set(day, list);
  }
  const sections: string[] = [];
  for (const [day, list] of groups) {
    const heading = day ? `Commits on ${escapeText(formatDateHeading(day))}` : "Commits";
    const rows = list.map((c) => renderPullCommitRow(owner, repo, c)).join("");
    sections.push(`
      <div class="oldgh-pr-commits__group">
        <h3 class="oldgh-pr-commits__day">${heading}</h3>
        <ul class="oldgh-pr-commits__list">${rows}</ul>
      </div>
    `);
  }
  return `<div class="oldgh-pr-commits">${sections.join("")}</div>`;
}

function renderPullCommitRow(owner: string, repo: string, c: PullCommit): string {
  const authorLink = c.authorLogin
    ? `<a href="/${escapeAttr(c.authorLogin)}" class="oldgh-pr-commits__author">${escapeText(c.authorLogin)}</a>`
    : `<span class="oldgh-pr-commits__author">${escapeText(c.authorName || "ghost")}</span>`;
  const avatar = c.authorAvatarUrl
    ? `<img class="oldgh-pr-commits__avatar" src="${escapeAttr(c.authorAvatarUrl)}" width="20" height="20" alt="" />`
    : "";
  const committed = relativeTimeLink(c.committerDate);
  return `
    <li class="oldgh-pr-commits__row">
      <div class="oldgh-pr-commits__main">
        <a class="oldgh-pr-commits__title" href="/${escapeAttr(owner)}/${escapeAttr(repo)}/commit/${escapeAttr(c.sha)}">${escapeText(c.headline)}</a>
        <div class="oldgh-pr-commits__byline">
          ${avatar}
          ${authorLink}
          ${committed ? `committed ${committed}` : ""}
        </div>
      </div>
      <div class="oldgh-pr-commits__meta">
        <code class="oldgh-pr-commits__sha"><a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/commit/${escapeAttr(c.sha)}">${escapeText(c.abbrevSha)}</a></code>
      </div>
    </li>
  `;
}

function renderPullChecks(checks: CheckRun[]): string {
  if (checks.length === 0) {
    return `<p class="oldgh-issue__subtab-empty">No checks ran for this pull request.</p>`;
  }
  const counts = countChecks(checks);
  const summary = `
    <div class="oldgh-pr-checks__summary">
      ${counts.success > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--success">${counts.success} passed</span>` : ""}
      ${counts.failure > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--failure">${counts.failure} failing</span>` : ""}
      ${counts.skipped > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--neutral">${counts.skipped} skipped</span>` : ""}
      ${counts.cancelled > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--neutral">${counts.cancelled} cancelled</span>` : ""}
      ${counts.pending > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--pending">${counts.pending} pending</span>` : ""}
      ${counts.other > 0 ? `<span class="oldgh-pr-checks__pill oldgh-pr-checks__pill--neutral">${counts.other} other</span>` : ""}
    </div>
  `;
  const groups = groupBy(checks, (c) => c.appName || "Unknown");
  const sections: string[] = [];
  for (const [appName, runs] of groups) {
    const rows = runs.map((r) => renderCheckRow(r)).join("");
    sections.push(`
      <div class="oldgh-pr-checks__group">
        <h3 class="oldgh-pr-checks__app">${escapeText(appName)}</h3>
        <ul class="oldgh-pr-checks__list">${rows}</ul>
      </div>
    `);
  }
  return `<div class="oldgh-pr-checks">${summary}${sections.join("")}</div>`;
}

function renderCheckRow(c: CheckRun): string {
  const { icon, label, cls } = checkStateView(c);
  const duration = checkDuration(c);
  return `
    <li class="oldgh-pr-checks__row ${cls}">
      <span class="oldgh-pr-checks__icon">${icon}</span>
      <div class="oldgh-pr-checks__main">
        <a class="oldgh-pr-checks__name" href="${safeAttrHref(c.htmlUrl || c.detailsUrl)}">${escapeText(c.name)}</a>
        ${c.outputTitle ? `<div class="oldgh-pr-checks__output">${escapeText(c.outputTitle)}</div>` : ""}
      </div>
      <div class="oldgh-pr-checks__meta">
        <span class="oldgh-pr-checks__state">${escapeText(label)}</span>
        ${duration ? `<span class="oldgh-pr-checks__duration">${escapeText(duration)}</span>` : ""}
      </div>
    </li>
  `;
}

function checkStateView(c: CheckRun): { icon: string; label: string; cls: string } {
  if (c.status !== "completed") {
    return { icon: octicon("primitive-dot", { size: 14 }), label: c.status.replace(/_/g, " "), cls: "oldgh-pr-checks__row--pending" };
  }
  switch (c.conclusion) {
    case "success":
      return { icon: octicon("check", { size: 14 }), label: "passed", cls: "oldgh-pr-checks__row--success" };
    case "failure":
    case "timed_out":
    case "action_required":
      return { icon: octicon("x", { size: 14 }), label: c.conclusion.replace(/_/g, " "), cls: "oldgh-pr-checks__row--failure" };
    case "cancelled":
      return { icon: octicon("primitive-square", { size: 14 }), label: "cancelled", cls: "oldgh-pr-checks__row--cancelled" };
    case "skipped":
      return { icon: octicon("dash", { size: 14 }), label: "skipped", cls: "oldgh-pr-checks__row--neutral" };
    case "neutral":
    case "stale":
      return { icon: octicon("primitive-dot", { size: 14 }), label: c.conclusion, cls: "oldgh-pr-checks__row--neutral" };
    default:
      return { icon: octicon("primitive-dot", { size: 14 }), label: "completed", cls: "oldgh-pr-checks__row--neutral" };
  }
}

function checkDuration(c: CheckRun): string | null {
  if (!c.startedAt || !c.completedAt) return null;
  const start = new Date(c.startedAt).getTime();
  const end = new Date(c.completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${min}m ${rest}s`;
}

function countChecks(checks: CheckRun[]): { success: number; failure: number; skipped: number; cancelled: number; pending: number; other: number } {
  let success = 0, failure = 0, skipped = 0, cancelled = 0, pending = 0, other = 0;
  for (const c of checks) {
    if (c.status !== "completed") { pending++; continue; }
    if (c.conclusion === "success") success++;
    else if (c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "action_required") failure++;
    else if (c.conclusion === "skipped") skipped++;
    else if (c.conclusion === "cancelled") cancelled++;
    else other++;
  }
  return { success, failure, skipped, cancelled, pending, other };
}

function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

function formatDateHeading(yyyyMmDd: string): string {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderShell(v: IssueDetail | PullDetail, kind: "issue" | "pull", tab: IssueTab): string {
  const isPull = kind === "pull";
  const pull = isPull ? (v as PullDetail) : null;

  return `
    <div class="oldgh-page oldgh-issue">
      <header class="oldgh-issue__header">
        <h1 class="oldgh-issue__title">
          ${sanitizeHtml(v.titleHtml)}
          <span class="oldgh-issue__number">#${v.number}</span>
        </h1>
        <div class="oldgh-issue__meta">
          ${renderStateBadge(v, isPull)}
          <span class="oldgh-issue__byline">
            <a href="/${escapeAttr(v.author?.login || "")}">${escapeText(v.author?.login || "ghost")}</a>
            opened this ${isPull ? "pull request" : "issue"} ${relativeTimeLink(v.createdAt)}
            ${pull ? renderPullRefs(pull) : ""}
            ${v.totalTimelineCount == null ? "" : `· ${v.totalTimelineCount} ${v.totalTimelineCount === 1 ? "comment" : "comments"}`}
          </span>
        </div>
        ${isPull && pull ? renderPrTabs(pull, tab) : ""}
      </header>

      ${tab !== "conversation" && isPull
        ? `<div class="oldgh-issue__subtab" data-tab="${escapeAttr(tab)}"><p class="oldgh-issue__subtab-empty">Loading…</p></div>`
        : `
        <div class="oldgh-issue__layout">
          <div class="oldgh-issue__main">
            ${renderTimelineGroup(v)}
          </div>
          <aside class="oldgh-issue__sidebar">
            ${"metadataHidden" in v && v.metadataHidden ? "" : renderSidebar(v)}
          </aside>
        </div>
      `}
    </div>
  `;
}

function renderPrTabs(p: PullDetail, active: IssueTab): string {
  const base = `/${escapeAttr(p.owner)}/${escapeAttr(p.repo)}/pull/${p.number}`;
  const tabs: { key: IssueTab; label: string; icon: string; count: number | null }[] = [
    { key: "conversation", label: "Conversation", icon: "comment-discussion", count: p.totalTimelineCount },
    { key: "commits", label: "Commits", icon: "git-commit", count: p.commitsCount },
    { key: "checks", label: "Checks", icon: "check", count: null },
    { key: "files", label: "Files changed", icon: "diff", count: p.changedFiles },
  ];
  return `
    <nav class="oldgh-issue__pr-tabs" aria-label="Pull request sections">
      <ul>
        ${tabs.map((t) => `
          <li class="${active === t.key ? "is-active" : ""}">
            <a href="${base}${t.key === "conversation" ? "" : "/" + t.key}">
              ${octicon(t.icon, { size: 14 })}
              <span>${escapeText(t.label)}</span>
              ${t.count != null ? `<span class="oldgh-issue__pr-tab-count">${escapeText(String(t.count))}</span>` : ""}
            </a>
          </li>
        `).join("")}
      </ul>
    </nav>
  `;
}

function renderStateBadge(v: IssueDetail | PullDetail, isPull: boolean): string {
  let cls = "oldgh-issue__state oldgh-issue__state--open";
  let icon = "issue-opened";
  let label = "Open";
  if (isPull) {
    const p = v as PullDetail;
    if (p.state === "MERGED") {
      cls = "oldgh-issue__state oldgh-issue__state--merged";
      icon = "git-merge";
      label = "Merged";
    } else if (p.state === "CLOSED") {
      cls = "oldgh-issue__state oldgh-issue__state--closed";
      icon = "git-pull-request";
      label = "Closed";
    } else if (p.isDraft) {
      cls = "oldgh-issue__state oldgh-issue__state--draft";
      icon = "git-pull-request";
      label = "Draft";
    } else {
      icon = "git-pull-request";
    }
  } else if (v.state === "CLOSED") {
    cls = "oldgh-issue__state oldgh-issue__state--closed";
    icon = "issue-closed";
    label = (v.stateReason || "").toUpperCase() === "NOT_PLANNED" ? "Closed (not planned)" : "Closed";
  }
  return `<span class="${cls}">${octicon(icon, { size: 14 })}<span>${label}</span></span>`;
}

function renderPullRefs(p: PullDetail): string {
  const fromLabel = p.headRepoOwner && p.headRepoOwner !== p.owner
    ? `${p.headRepoOwner}:${p.headRefName}`
    : p.headRefName;
  return `
    · <code class="oldgh-issue__ref">${escapeText(p.baseRefName)}</code>
    ${octicon("arrow-left", { size: 12 })}
    <code class="oldgh-issue__ref">${escapeText(fromLabel)}</code>
  `;
}
