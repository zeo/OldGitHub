import { octicon } from "@/icons";
import {
  getIssue,
  getPull,
  getPullFiles,
  getPullCommits,
  getPullChecks,
  type IssueDetail,
  type PullDetail,
  type TimelineNode,
  type Actor,
  type Label,
  type ReactionCount,
  type PullFile,
  type PullCommit,
  type CheckRun,
} from "@/adapters/repo-issue";
import { AdapterFailure } from "@/adapters";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, navigationToken } from "./_body";
import { renderHunks } from "./_diff-table";
import { parsePatch } from "@/util/diff";
import { escapeAttr, escapeText, sanitizeHtml, safeHref } from "@/util/html";

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
  let view: IssueDetail | PullDetail | null = null;
  try {
    view = kind === "pull"
      ? await getPull(owner, repo, number)
      : await getIssue(owner, repo, number);
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    // Don't re-throw on 404: the anonymous REST API returns 404 for any
    // private repo (regardless of whether the user can see it via cookie),
    // so we always fall through to the cookie-authed HTML scrape below.
    // hydrateScrapedBody surfaces a real "not found" message if even that
    // fails.
  }

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  if (view) {
    root.innerHTML = renderShell(view, kind, tab);
  } else {
    root.innerHTML = renderScrapedShell(owner, repo, number, kind, tab);
  }
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  if (!view) {
    void hydrateScrapedBody(root, owner, repo, number, kind, tab);
  } else if (kind === "pull" && tab !== "conversation") {
    void hydrateSubTab(root, owner, repo, number, tab);
  }
}

function renderScrapedShell(
  owner: string,
  repo: string,
  number: number,
  kind: "issue" | "pull",
  tab: IssueTab,
): string {
  const isPull = kind === "pull";
  const tabsNav = isPull ? renderScrapedPrTabs(owner, repo, number, tab) : "";
  return `
    <div class="oldgh-page oldgh-issue">
      <header class="oldgh-issue__header">
        <h1 class="oldgh-issue__title">
          ${escapeText(isPull ? "Pull request" : "Issue")}
          <span class="oldgh-issue__number">#${number}</span>
        </h1>
        ${tabsNav}
      </header>
      <div class="oldgh-issue__subtab" data-tab="${escapeAttr(tab)}">
        <p class="oldgh-issue__subtab-empty">Loading…</p>
      </div>
    </div>
  `;
}

function renderScrapedPrTabs(
  owner: string,
  repo: string,
  number: number,
  active: IssueTab,
): string {
  const base = `/${escapeAttr(owner)}/${escapeAttr(repo)}/pull/${number}`;
  const tabs: { key: IssueTab; label: string; icon: string }[] = [
    { key: "conversation", label: "Conversation", icon: "comment-discussion" },
    { key: "commits", label: "Commits", icon: "git-commit" },
    { key: "checks", label: "Checks", icon: "check" },
    { key: "files", label: "Files changed", icon: "diff" },
  ];
  return `
    <nav class="oldgh-issue__pr-tabs" aria-label="Pull request sections">
      <ul>
        ${tabs.map((t) => `
          <li class="${active === t.key ? "is-active" : ""}">
            <a href="${base}${t.key === "conversation" ? "" : "/" + t.key}">
              ${octicon(t.icon, { size: 14 })}
              <span>${escapeText(t.label)}</span>
            </a>
          </li>
        `).join("")}
      </ul>
    </nav>
  `;
}

async function hydrateScrapedBody(
  root: HTMLElement,
  owner: string,
  repo: string,
  number: number,
  kind: "issue" | "pull",
  tab: IssueTab,
): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-issue__subtab");
  if (!container) return;
  const segment = kind === "pull" ? "pull" : "issues";
  const sub = tab === "conversation" ? "" : "/" + tab;
  const url = `https://github.com/${owner}/${repo}/${segment}/${number}${sub}`;
  try {
    const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
    if (resp.status === 404) {
      container.innerHTML = `<p class="oldgh-issue__subtab-empty">This ${kind === "pull" ? "pull request" : "issue"} doesn't exist or you don't have access to it.</p>`;
      return;
    }
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const inner =
      doc.querySelector("turbo-frame#repo-content-turbo-frame") ||
      doc.querySelector("[data-pjax-container]") ||
      doc.querySelector(".application-main") ||
      doc.querySelector("main");
    if (!inner) {
      container.innerHTML = `<p class="oldgh-issue__subtab-empty">Couldn't load this view.</p>`;
      return;
    }
    // Update our placeholder title with the real one from GitHub's page.
    const pageTitle = (doc.querySelector("title")?.textContent || "").trim();
    const titleFromHead = pageTitle
      .replace(/\s*·\s*(Issue|Pull Request)\s*#\d+\s*·\s*[^\s]+\/[^\s]+\s*$/i, "")
      .replace(/^Issue\s+#\d+:\s*/i, "")
      .trim();
    const titleEl = root.querySelector<HTMLElement>(".oldgh-issue__title");
    if (titleEl && titleFromHead) {
      titleEl.innerHTML = `${escapeText(titleFromHead)} <span class="oldgh-issue__number">#${number}</span>`;
    }
    for (const sel of [
      "header.AppHeader",
      "header[role='banner']",
      "footer",
      "#repository-container-header",
      ".pagehead",
      ".UnderlineNav.js-repo-nav",
      "[class*='PageLayout-Header-']",
      "[class*='PageHeader-']",
      ".tabnav",
      ".UnderlineNav",
      ".gh-header",
      ".gh-header-actions",
      ".gh-header-meta",
      ".pull-discussion-timeline > header",
      "[data-component='HeaderMeta']",
      "[data-component='Page::Title']",
      "[aria-label*='error' i][role='alert']",
      "script",
      "style",
      "iframe",
      "object",
      "embed",
    ]) {
      inner.querySelectorAll(sel).forEach((n) => n.remove());
    }
    for (const node of Array.from(inner.querySelectorAll<HTMLElement>("*"))) {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      }
    }
    container.innerHTML = inner.innerHTML;
  } catch {
    container.innerHTML = `<p class="oldgh-issue__subtab-empty">Couldn't load this view.</p>`;
  }
}

async function hydrateSubTab(
  root: HTMLElement,
  owner: string,
  repo: string,
  number: number,
  tab: IssueTab,
): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-issue__subtab");
  if (!container) return;
  try {
    if (tab === "files") {
      const files = await getPullFiles(owner, repo, number);
      container.innerHTML = renderPullFiles(files);
      return;
    }
    if (tab === "commits") {
      const commits = await getPullCommits(owner, repo, number);
      container.innerHTML = renderPullCommits(owner, repo, commits);
      return;
    }
    if (tab === "checks") {
      const checks = await getPullChecks(owner, repo, number);
      container.innerHTML = renderPullChecks(checks);
      return;
    }
  } catch {
    container.innerHTML = `<p class="oldgh-issue__subtab-empty">Couldn't load this tab.</p>`;
  }
}

function renderPullFiles(files: PullFile[]): string {
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
  const blocks = files.map((f) => renderPullFile(f)).join("");
  return `<div class="oldgh-pr-files">${summary}${blocks}</div>`;
}

function renderPullFile(f: PullFile): string {
  const statusLabel = f.status === "renamed" && f.previousFilename
    ? `${escapeText(f.previousFilename)} → ${escapeText(f.filename)}`
    : escapeText(f.filename);
  const hunk = f.patch
    ? renderHunks(parsePatch(f.patch))
    : `<div class="oldgh-pr-file__nopatch">Binary or large file — view on <a href="${escapeAttr(f.blobUrl)}">GitHub</a>.</div>`;
  return `
    <div class="oldgh-pr-file" data-status="${escapeAttr(f.status)}">
      <div class="oldgh-pr-file__header">
        <span class="oldgh-pr-file__name">${statusLabel}</span>
        <span class="oldgh-pr-file__counts">
          <span class="oldgh-pr-file__add">+${f.additions}</span>
          <span class="oldgh-pr-file__del">−${f.deletions}</span>
        </span>
      </div>
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
        <a class="oldgh-pr-checks__name" href="${escapeAttr(safeHref(c.htmlUrl || c.detailsUrl))}">${escapeText(c.name)}</a>
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
            · ${v.totalTimelineCount} ${v.totalTimelineCount === 1 ? "comment" : "comments"}
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
            ${renderSidebar(v)}
          </aside>
        </div>
      `}
    </div>
  `;
}

function renderPrTabs(p: PullDetail, active: IssueTab): string {
  const base = `/${escapeAttr(p.owner)}/${escapeAttr(p.repo)}/pull/${p.number}`;
  const tabs: { key: IssueTab; label: string; icon: string; count?: number | string }[] = [
    { key: "conversation", label: "Conversation", icon: "comment-discussion", count: p.totalTimelineCount },
    { key: "commits", label: "Commits", icon: "git-commit", count: p.commitsCount ?? undefined },
    { key: "checks", label: "Checks", icon: "check" },
    { key: "files", label: "Files changed", icon: "diff", count: p.changedFiles ?? undefined },
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
  } else {
    if (v.state === "CLOSED") {
      cls = "oldgh-issue__state oldgh-issue__state--closed";
      icon = "issue-closed";
      label = (v.stateReason || "").toUpperCase() === "NOT_PLANNED" ? "Closed (not planned)" : "Closed";
    }
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

function renderTimelineGroup(v: IssueDetail | PullDetail): string {
  const opener = renderOpenerComment(v);
  const items = v.timeline.map((node) => renderTimelineItem(node)).join("");
  return `<div class="oldgh-issue__timeline">${opener}${items}</div>`;
}

function renderOpenerComment(v: IssueDetail | PullDetail): string {
  return renderCommentBlock({
    author: v.author,
    bodyHtml: v.bodyHtml,
    createdAt: v.createdAt,
    reactions: v.reactions,
    isOpener: true,
  });
}

function renderTimelineItem(node: TimelineNode): string {
  if (node.kind === "comment") {
    return renderCommentBlock({
      author: node.author,
      bodyHtml: node.bodyHtml,
      createdAt: node.createdAt,
      reactions: node.reactions,
      authorAssociation: node.authorAssociation,
      isOpener: false,
      commentId: node.id,
    });
  }
  return renderEvent(node);
}

type CommentInputs = {
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
  reactions: ReactionCount[];
  authorAssociation?: string | null;
  isOpener: boolean;
  commentId?: string;
};

function renderCommentBlock(c: CommentInputs): string {
  const login = c.author?.login || "ghost";
  const avatar = c.author?.avatarUrl || `https://github.com/${login}.png?size=64`;
  const association = c.authorAssociation && c.authorAssociation !== "NONE" && c.authorAssociation !== "MEMBER"
    ? `<span class="oldgh-issue__association">${escapeText(formatAssociation(c.authorAssociation))}</span>`
    : "";
  const anchor = c.commentId && /^\d+$/.test(c.commentId) ? ` id="issuecomment-${c.commentId}"` : "";
  return `
    <article${anchor} class="oldgh-issue__comment ${c.isOpener ? "oldgh-issue__comment--opener" : ""}">
      <a class="oldgh-issue__avatar" href="/${escapeAttr(login)}" aria-label="View ${escapeAttr(login)}'s profile">
        <img src="${escapeAttr(avatar)}" alt="" width="44" height="44" />
      </a>
      <div class="oldgh-issue__comment-card">
        <header class="oldgh-issue__comment-head">
          <a href="/${escapeAttr(login)}" class="oldgh-issue__comment-author">${escapeText(login)}</a>
          <span class="oldgh-issue__comment-time">commented ${relativeTimeLink(c.createdAt)}</span>
          ${association}
        </header>
        <div class="oldgh-issue__body markdown-body">
          ${sanitizeHtml(c.bodyHtml) || '<p class="oldgh-issue__empty">No description provided.</p>'}
        </div>
        ${renderReactionRow(c.reactions)}
      </div>
    </article>
  `;
}

function renderReactionRow(reactions: ReactionCount[]): string {
  if (!reactions || reactions.length === 0) return "";
  return `
    <div class="oldgh-issue__reactions">
      ${reactions.map((r) => `<span class="oldgh-issue__reaction" title="${escapeAttr(reactionLabel(r.content))}">${reactionEmoji(r.content)} ${r.count}</span>`).join("")}
    </div>
  `;
}

function renderEvent(e: Extract<TimelineNode, { kind: "event" }>): string {
  const actor = e.actor?.login || "someone";
  const when = relativeTimeLink(e.createdAt);
  let icon = "primitive-dot";
  let line = "";

  switch (e.type) {
    case "LabeledEvent":
      icon = "tag";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> added the ${e.label ? renderLabelInline(e.label) : "(unknown)"} label ${when}`;
      break;
    case "UnlabeledEvent":
      icon = "tag";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> removed the ${e.label ? renderLabelInline(e.label) : "(unknown)"} label ${when}`;
      break;
    case "AssignedEvent":
      icon = "person";
      line = e.assignee && e.assignee.login !== actor
        ? `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> assigned <a href="/${escapeAttr(e.assignee.login)}">${escapeText(e.assignee.login)}</a> ${when}`
        : `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> self-assigned this ${when}`;
      break;
    case "UnassignedEvent":
      icon = "person";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> unassigned ${e.assignee ? `<a href="/${escapeAttr(e.assignee.login)}">${escapeText(e.assignee.login)}</a>` : "someone"} ${when}`;
      break;
    case "MilestonedEvent":
      icon = "milestone";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> added this to a milestone ${when}`;
      break;
    case "ClosedEvent":
      icon = "issue-closed";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> closed this ${e.toState && (e.toState || "").toUpperCase() !== "COMPLETED" ? `as ${escapeText(e.toState.toLowerCase())}` : ""} ${when}`;
      break;
    case "ReopenedEvent":
      icon = "issue-reopened";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> reopened this ${when}`;
      break;
    case "MergedEvent":
      icon = "git-merge";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> merged commit ${e.commitOid ? `<code>${escapeText(e.commitOid)}</code>` : ""} ${when}`;
      break;
    case "RenamedTitleEvent":
      icon = "pencil";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> changed the title from <strong>${escapeText(e.fromState || "")}</strong> to <strong>${escapeText(e.toState || "")}</strong> ${when}`;
      break;
    case "ReferencedEvent":
    case "CrossReferencedEvent":
      icon = "bookmark";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> referenced this ${e.refUrl ? `in <a href="${escapeAttr(e.refUrl)}">${escapeText(e.refTitle || e.ref || "another item")}</a>` : ""} ${when}`;
      break;
    case "PullRequestCommit":
    case "Commit":
      icon = "git-commit";
      line = `${e.commitOid ? `<code>${escapeText(e.commitOid)}</code>` : ""} ${e.commitMessageHeadline ? sanitizeHtml(e.commitMessageHeadline) : ""} ${when}`;
      break;
    case "HeadRefForcePushedEvent":
    case "BaseRefForcePushedEvent":
      icon = "repo-force-push";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> force-pushed ${e.fromState ? `from <code>${escapeText(e.fromState)}</code>` : ""} ${e.toState ? `to <code>${escapeText(e.toState)}</code>` : ""} ${when}`;
      break;
    case "HeadRefDeletedEvent":
      icon = "trashcan";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> deleted the branch ${when}`;
      break;
    case "ReadyForReviewEvent":
      icon = "git-pull-request";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> marked this as ready for review ${when}`;
      break;
    case "PullRequestReview": {
      // bodyless reviews arrive here; reviews with a body become comment nodes
      const state = (e.toState || "").toLowerCase();
      if (state === "approved") {
        icon = "check";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> approved these changes ${when}`;
      } else if (state === "changes_requested") {
        icon = "request-changes";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> requested changes ${when}`;
      } else {
        icon = "eye";
        line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> reviewed ${when}`;
      }
      break;
    }
    case "SubscribedEvent":
    case "UnsubscribedEvent":
    case "MentionedEvent":
      return "";
    default:
      icon = "primitive-dot";
      line = `<a href="/${escapeAttr(actor)}">${escapeText(actor)}</a> ${escapeText(humanizeEventType(e.type))} ${when}`;
  }

  return `
    <div class="oldgh-issue__event">
      <span class="oldgh-issue__event-icon">${octicon(icon, { size: 14 })}</span>
      <span class="oldgh-issue__event-line">${line}</span>
    </div>
  `;
}

function renderSidebar(v: IssueDetail | PullDetail): string {
  return `
    ${renderSidebarSection("Assignees", v.assignees.length === 0 ? `<p class="oldgh-issue__sidebar-empty">No one assigned</p>` : `
      <ul class="oldgh-issue__assignees">
        ${v.assignees.map((a) => `
          <li>
            <a href="/${escapeAttr(a.login)}">
              <img src="${escapeAttr(a.avatarUrl)}" width="20" height="20" alt="" />
              ${escapeText(a.login)}
            </a>
          </li>`).join("")}
      </ul>
    `)}

    ${renderSidebarSection("Labels", v.labels.length === 0 ? `<p class="oldgh-issue__sidebar-empty">None yet</p>` : `
      <ul class="oldgh-issue__labels">
        ${v.labels.map((l) => `<li>${renderLabelInline(l)}</li>`).join("")}
      </ul>
    `)}

    ${renderSidebarSection("Milestone", v.milestone ? `
      <a href="${escapeAttr(v.milestone.url)}">${escapeText(v.milestone.title)}</a>
    ` : `<p class="oldgh-issue__sidebar-empty">No milestone</p>`)}
  `;
}

function renderSidebarSection(title: string, body: string): string {
  return `
    <div class="oldgh-issue__sidebar-section">
      <h3>${escapeText(title)}</h3>
      ${body}
    </div>
  `;
}

function renderLabelInline(l: Label): string {
  return `<span class="oldgh-issue__label" style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)};" title="${escapeAttr(l.description || "")}">${escapeText(emojify(l.name))}</span>`;
}

function relativeTimeLink(iso: string): string {
  if (!iso) return "";
  const rel = relativeTime(iso);
  const abs = absoluteTime(iso);
  return `<span title="${escapeAttr(abs)}">${escapeText(rel)}</span>`;
}

function labelTextColor(hex: string): string {
  // expand 3-digit shorthand (ccc) to 6 digits before luminance calc
  const short = /^#?([\da-f]{3})$/i.exec(hex);
  const normalized = short && short[1]
    ? short[1].split("").map((ch) => ch + ch).join("")
    : hex;
  const m = /^#?([\da-f]{6})$/i.exec(normalized);
  if (!m || !m[1]) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#333" : "#fff";
}

function reactionEmoji(content: string): string {
  switch (content) {
    case "THUMBS_UP": return "\u{1F44D}";
    case "THUMBS_DOWN": return "\u{1F44E}";
    case "LAUGH": return "\u{1F604}";
    case "HOORAY": return "\u{1F389}";
    case "CONFUSED": return "\u{1F615}";
    case "HEART": return "❤️";
    case "ROCKET": return "\u{1F680}";
    case "EYES": return "\u{1F440}";
    default: return "";
  }
}

function reactionLabel(content: string): string {
  return content.toLowerCase().replace(/_/g, " ");
}

function formatAssociation(a: string): string {
  switch (a) {
    case "OWNER": return "Owner";
    case "COLLABORATOR": return "Collaborator";
    case "MEMBER": return "Member";
    case "CONTRIBUTOR": return "Contributor";
    case "FIRST_TIME_CONTRIBUTOR": return "First-time contributor";
    case "FIRST_TIMER": return "First-timer";
    default: return a.toLowerCase();
  }
}

function humanizeEventType(t: string): string {
  return t
    .replace(/Event$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
