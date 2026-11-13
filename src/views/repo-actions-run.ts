import { octicon } from "@/icons";
import { getJobSteps, getRunPage, type JobDetail, type JobStep, type RunDetail, type RunPage } from "@/adapters/repo-actions-run";
import type { WorkflowRunStatus } from "@/adapters/repo-actions";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-actions-run";

export async function mountRepoActionsRun(owner: string, repo: string, runId: string): Promise<void> {
  const nav = navigationToken();
  const page = await getRunPage(owner, repo, runId);
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(page);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;
  attachToggleHandlers(root);
  // a /job/<id> link opens that job; otherwise show what failed, or the only job there is
  const linked = location.pathname.match(/\/job\/(\d+)/)?.[1];
  const opening = linked
    ? page.jobs.filter((j) => String(j.id) === linked)
    : page.jobs.length === 1 ? page.jobs : page.jobs.filter((j) => j.status === "failure" || j.status === "timed_out").slice(0, 5);
  for (const job of opening) {
    const section = root.querySelector<HTMLElement>(`#job-${job.id}`);
    if (section) openJob(section);
  }
  if (linked) root.querySelector(`#job-${linked}`)?.scrollIntoView();
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
        ${r.actor ? `
          <span class="oldgh-actions-run__meta-item">
            <a href="${escapeAttr(r.actor.url)}">
              ${r.actor.avatarUrl ? `<img src="${escapeAttr(r.actor.avatarUrl)}" width="16" height="16" alt="" class="oldgh-actions-run__avatar"/>` : ""}
              ${escapeText(r.actor.login)}
            </a>
            ${r.event ? `triggered via ${escapeText(r.event)}` : ""}
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
  return `
    <section class="oldgh-actions-run__job oldgh-actions-run__job--collapsed" id="job-${j.id}" data-job-status="${j.status}" data-steps-href="${escapeAttr(j.href)}">
      <button type="button" class="oldgh-actions-run__job-header" data-toggle="job">
        <span class="oldgh-actions-run__job-chev">${octicon("chevron-down", { size: 12 })}</span>
        <span class="oldgh-actions-run__status oldgh-actions-run__status--${j.status}" title="${escapeAttr(statusLabel(j.status))}">${statusIcon(j.status)}</span>
        <span class="oldgh-actions-run__job-name">${escapeText(j.name)}</span>
        <span class="oldgh-actions-run__job-time"></span>
      </button>
      <div class="oldgh-actions-run__job-body">
        <p class="oldgh-actions-run__empty">Loading steps…</p>
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
    const navLink = target.closest<HTMLAnchorElement>('.oldgh-actions-run__job-nav a[href^="#job-"]');
    if (navLink) {
      const section = root.querySelector<HTMLElement>(navLink.getAttribute("href") ?? "");
      if (section) openJob(section);
      return;
    }
    const btn = target.closest('[data-toggle="job"]') as HTMLElement | null;
    if (!btn) return;
    const section = btn.closest(".oldgh-actions-run__job") as HTMLElement | null;
    if (!section) return;
    if (section.classList.contains("oldgh-actions-run__job--collapsed")) openJob(section);
    else section.classList.add("oldgh-actions-run__job--collapsed");
  });
}

function openJob(section: HTMLElement): void {
  section.classList.remove("oldgh-actions-run__job--collapsed");
  const href = section.dataset.stepsHref;
  const body = section.querySelector(".oldgh-actions-run__job-body");
  if (!href || !body) return;
  delete section.dataset.stepsHref;
  getJobSteps(href).then(({ steps, duration }) => {
    body.innerHTML = steps.length
      ? `<ol class="oldgh-actions-run__steps">${steps.map((s) => renderStep(s)).join("")}</ol>`
      : `<p class="oldgh-actions-run__empty">No steps recorded for this job.</p>`;
    const time = section.querySelector(".oldgh-actions-run__job-time");
    if (time && duration) time.textContent = duration;
  }, (err: unknown) => {
    body.innerHTML = `<p class="oldgh-actions-run__empty">Couldn't load steps: ${escapeText(err instanceof Error ? err.message : String(err))}</p>`;
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
