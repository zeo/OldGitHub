import { octicon } from "@/icons";
import { getRunPage, type JobDetail, type JobStep, type RunDetail, type RunPage } from "@/adapters/repo-actions-run";
import type { WorkflowRunStatus } from "@/adapters/repo-actions";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-actions-run";

export async function mountRepoActionsRun(owner: string, repo: string, runId: string): Promise<void> {
  const nav = navigationToken();
  const page = await getRunPage(owner, repo, runId);
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(page);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;
  attachToggleHandlers(root);
}

export function unmountRepoActionsRun(): void {
  removeAllBodyRoots();
}

function renderShell(p: RunPage): string {
  return `
    <div class="oldgh-page oldgh-actions-run-page">
      ${renderRunHeader(p.run, p.owner, p.repo)}
      <div class="oldgh-actions-run__layout">
        <aside class="oldgh-actions-run__sidebar">
          <h3>${octicon("list-unordered", { size: 12 })} Jobs</h3>
          <ul class="oldgh-actions-run__job-nav">
            ${p.jobs.map((j) => `
              <li>
                <a href="#job-${j.id}">
                  <span class="oldgh-actions-run__job-nav-status oldgh-actions-run__status--${j.status}">${statusIcon(j.status)}</span>
                  <span class="oldgh-actions-run__job-nav-name">${escapeText(j.name)}</span>
                  ${j.duration ? `<span class="oldgh-actions-run__job-nav-time">${escapeText(j.duration)}</span>` : ""}
                </a>
              </li>
            `).join("")}
            ${p.jobs.length === 0 ? `<li class="oldgh-actions-run__empty">No jobs found.</li>` : ""}
          </ul>
        </aside>
        <div class="oldgh-actions-run__main">
          ${p.jobs.map((j) => renderJob(j)).join("")}
          ${p.jobs.length === 0 ? `<p class="oldgh-actions-run__empty">This run has no recorded jobs.</p>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderRunHeader(r: RunDetail, owner: string, repo: string): string {
  const titleLink = r.workflowUrl
    ? `<a href="${escapeAttr(r.workflowUrl)}">${escapeText(r.workflowName)}</a>`
    : escapeText(r.workflowName);
  return `
    <header class="oldgh-actions-run__header">
      <div class="oldgh-actions-run__title-row">
        <span class="oldgh-actions-run__status oldgh-actions-run__status--${r.status}" title="${escapeAttr(statusLabel(r.status))}">${statusIcon(r.status, 18)}</span>
        <h1 class="oldgh-actions-run__title">
          <span class="oldgh-actions-run__workflow">${titleLink}</span>
          ${r.displayTitle && r.displayTitle !== r.workflowName ? `<span class="oldgh-actions-run__separator">·</span><span class="oldgh-actions-run__display">${escapeText(r.displayTitle)}</span>` : ""}
          ${r.runNumber ? `<span class="oldgh-actions-run__run-num">#${r.runNumber}</span>` : ""}
        </h1>
      </div>
      <div class="oldgh-actions-run__meta">
        <span class="oldgh-actions-run__state-pill oldgh-actions-run__state-pill--${r.status}">
          ${statusIcon(r.status)} ${escapeText(statusLabel(r.status))}
        </span>
        ${r.triggeringActor ? `
          <span class="oldgh-actions-run__meta-item">
            <a href="/${escapeAttr(r.triggeringActor.login)}">
              <img src="${escapeAttr(r.triggeringActor.avatarUrl)}" width="16" height="16" alt="" class="oldgh-actions-run__avatar"/>
              ${escapeText(r.triggeringActor.login)}
            </a>
            ${r.event ? `triggered via ${escapeText(prettyEvent(r.event))}` : ""}
            ${r.startedAt && relativeTime(r.startedAt) ? `<span title="${escapeAttr(absoluteTime(r.startedAt))}">${escapeText(relativeTime(r.startedAt))}</span>` : ""}
          </span>
        ` : ""}
        ${r.runAttempt && r.runAttempt > 1 ? `<span class="oldgh-actions-run__meta-item">attempt #${r.runAttempt}</span>` : ""}
      </div>
      <div class="oldgh-actions-run__meta">
        ${r.branch ? `
          <span class="oldgh-actions-run__meta-item">
            ${octicon("git-branch", { size: 12 })}
            <a href="${escapeAttr(r.branchUrl || "#")}"><code>${escapeText(r.branch)}</code></a>
          </span>
        ` : ""}
        ${r.commitShortSha ? `
          <span class="oldgh-actions-run__meta-item">
            ${octicon("git-commit", { size: 12 })}
            <a href="${escapeAttr(r.commitUrl || "#")}"><code>${escapeText(r.commitShortSha)}</code></a>
            ${r.commitMessage ? `<span class="oldgh-actions-run__commit-msg">${escapeText(r.commitMessage)}</span>` : ""}
          </span>
        ` : ""}
        ${r.duration ? `
          <span class="oldgh-actions-run__meta-item">
            ${octicon("clock", { size: 12 })}
            ${escapeText(r.duration)}
          </span>
        ` : ""}
        <span class="oldgh-actions-run__meta-spacer"></span>
        <a class="oldgh-actions-run__external" href="${escapeAttr(r.htmlUrl)}" title="View on github.com">
          ${octicon("link-external", { size: 12 })} github.com
        </a>
      </div>
    </header>
  `;
}

function renderJob(j: JobDetail): string {
  const stepsHtml = j.steps.length
    ? `<ol class="oldgh-actions-run__steps">${j.steps.map((s) => renderStep(s)).join("")}</ol>`
    : `<p class="oldgh-actions-run__empty">No steps recorded for this job.</p>`;
  return `
    <section class="oldgh-actions-run__job" id="job-${j.id}" data-job-status="${j.status}">
      <button type="button" class="oldgh-actions-run__job-header" data-toggle="job">
        <span class="oldgh-actions-run__job-chev">${octicon("chevron-down", { size: 12 })}</span>
        <span class="oldgh-actions-run__status oldgh-actions-run__status--${j.status}" title="${escapeAttr(statusLabel(j.status))}">${statusIcon(j.status)}</span>
        <span class="oldgh-actions-run__job-name">${escapeText(j.name)}</span>
        ${j.duration ? `<span class="oldgh-actions-run__job-time">${escapeText(j.duration)}</span>` : ""}
      </button>
      <div class="oldgh-actions-run__job-body">
        <div class="oldgh-actions-run__job-meta">
          ${j.runnerName ? `<span><strong>Runner:</strong> ${escapeText(j.runnerName)}</span>` : ""}
          ${j.labels.length ? `<span><strong>Labels:</strong> ${j.labels.map(escapeText).join(", ")}</span>` : ""}
          ${j.startedAt ? `<span><strong>Started:</strong> <span title="${escapeAttr(absoluteTime(j.startedAt))}">${escapeText(relativeTime(j.startedAt))}</span></span>` : ""}
        </div>
        ${stepsHtml}
      </div>
    </section>
  `;
}

function renderStep(s: JobStep): string {
  return `
    <li class="oldgh-actions-run__step" data-step-status="${s.status}">
      <span class="oldgh-actions-run__step-num">${s.number}</span>
      <span class="oldgh-actions-run__status oldgh-actions-run__status--${s.status}" title="${escapeAttr(statusLabel(s.status))}">${statusIcon(s.status)}</span>
      <span class="oldgh-actions-run__step-name">${escapeText(s.name)}</span>
      ${s.duration ? `<span class="oldgh-actions-run__step-time">${escapeText(s.duration)}</span>` : ""}
    </li>
  `;
}

function attachToggleHandlers(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest('[data-toggle="job"]') as HTMLElement | null;
    if (!btn) return;
    const section = btn.closest(".oldgh-actions-run__job") as HTMLElement | null;
    if (!section) return;
    section.classList.toggle("oldgh-actions-run__job--collapsed");
  });
}

function statusIcon(s: WorkflowRunStatus, size: number = 14): string {
  switch (s) {
    case "success": return octicon("check", { size });
    case "failure":
    case "timed_out": return octicon("x", { size });
    case "in_progress": return octicon("sync", { size });
    case "queued":
    case "pending": return octicon("primitive-dot", { size });
    case "cancelled": return octicon("primitive-square", { size });
    case "skipped": return octicon("dash", { size });
    case "action_required": return octicon("alert", { size });
    case "neutral":
    case "stale": return octicon("dash", { size });
    default: return octicon("primitive-dot", { size });
  }
}

function statusLabel(s: WorkflowRunStatus): string {
  switch (s) {
    case "success": return "Success";
    case "failure": return "Failure";
    case "in_progress": return "In progress";
    case "queued": return "Queued";
    case "pending": return "Pending";
    case "cancelled": return "Cancelled";
    case "skipped": return "Skipped";
    case "neutral": return "Neutral";
    case "timed_out": return "Timed out";
    case "stale": return "Stale";
    case "action_required": return "Action required";
    default: return "Unknown";
  }
}

function prettyEvent(e: string): string {
  switch (e) {
    case "push": return "push";
    case "pull_request": return "pull request";
    case "pull_request_target": return "pull request target";
    case "workflow_dispatch": return "manual dispatch";
    case "schedule": return "schedule";
    case "release": return "release";
    case "issues": return "issue event";
    default: return e.replace(/_/g, " ");
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
