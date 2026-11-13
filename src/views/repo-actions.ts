import { octicon } from "@/icons";
import { getActions, type ActionsView, type WorkflowRun } from "@/adapters/repo-actions";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-actions";

export async function mountRepoActions(owner: string, repo: string, query: string, workflowPath: string | null = null): Promise<void> {
  const nav = navigationToken();
  const view = await getActions(owner, repo, query, workflowPath);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, query);
  adoptBodyRoot(root, ".oldgh-repo-header", nav);
}

function renderShell(v: ActionsView, query: string): string {
  return `
    <div class="oldgh-page oldgh-actions">
      <div class="oldgh-actions__layout">
        <aside class="oldgh-actions__sidebar">
          <h3>${octicon("github-action", { size: 12 })} Workflows</h3>
          <ul class="oldgh-actions__workflows">
            <li><a href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/actions" class="oldgh-actions__wf-all${v.selectedWorkflowFilePath ? "" : " oldgh-actions__wf--selected"}"><strong>All workflows</strong></a></li>
            ${v.workflows.map((w) => `
              <li><a href="${escapeAttr(w.href)}" title="${escapeAttr(w.filePath)}" class="${w.filePath === v.selectedWorkflowFilePath ? "oldgh-actions__wf--selected" : ""}">${escapeText(w.name)}</a></li>
            `).join("")}
          </ul>
        </aside>
        <div class="oldgh-actions__main">
          <header class="oldgh-actions__header">
            ${v.selectedWorkflowFilePath ? `
              <h2>${escapeText(v.selectedWorkflowName || basename(v.selectedWorkflowFilePath))}</h2>
              <p class="oldgh-actions__sub">
                <a href="/${escapeAttr(v.owner)}/${escapeAttr(v.repo)}/blob/HEAD/${escapeAttr(v.selectedWorkflowFilePath)}"><code>${escapeText(v.selectedWorkflowFilePath)}</code></a> ·
                ${runCount(v)}
              </p>
            ` : `
              <h2>${runCount(v)}</h2>
            `}
          </header>
          ${v.runs.length === 0 ? `<p class="oldgh-actions__empty">No workflow runs match the current filter.</p>` : `
            <ul class="oldgh-actions__runs">
              ${v.runs.map((r) => renderRun(r)).join("")}
            </ul>
            ${renderPager(v, query)}
          `}
        </div>
      </div>
    </div>
  `;
}

function renderRun(r: WorkflowRun): string {
  return `
    <li class="oldgh-actions__run">
      <span class="oldgh-actions__run-status oldgh-actions__run-status--${r.status}" title="${escapeAttr(r.status)}">${statusIcon(r.status)}</span>
      <div class="oldgh-actions__run-body">
        <div class="oldgh-actions__run-title">
          <a href="${escapeAttr(r.url)}">${escapeText(r.title || r.workflowName)}</a>
          ${r.runNumber ? `<span class="oldgh-actions__run-number">#${r.runNumber}</span>` : ""}
        </div>
        <div class="oldgh-actions__run-meta">
          <span>${escapeText(r.workflowName)}</span>
          ${r.branch ? `· <a href="${escapeAttr(r.branchUrl || "#")}"><code>${escapeText(r.branch)}</code></a>` : ""}
          ${r.event ? `· ${escapeText(r.event)}${r.eventLink ? ` <a href="${escapeAttr(r.eventLink.url)}">${escapeText(r.eventLink.text)}</a>` : ""}` : ""}
          ${r.actor ? `· <a href="${escapeAttr(r.actor.url)}">${escapeText(r.actor.login)}</a>` : ""}
          ${r.startedAt ? `· <span title="${escapeAttr(absoluteTime(r.startedAt))}">${escapeText(relativeTime(r.startedAt))}</span>` : ""}
          ${r.duration ? `· ${escapeText(r.duration)}` : ""}
        </div>
      </div>
    </li>
  `;
}

function statusIcon(s: WorkflowRun["status"]): string {
  switch (s) {
    case "success": return octicon("check", { size: 14 });
    case "failure":
    case "timed_out": return octicon("x", { size: 14 });
    case "in_progress": return octicon("sync", { size: 14 });
    case "queued":
    case "pending": return octicon("primitive-dot", { size: 14 });
    case "cancelled": return octicon("primitive-square", { size: 14 });
    case "skipped": return octicon("dash", { size: 14 });
    case "action_required": return octicon("alert", { size: 14 });
    case "neutral":
    case "stale": return octicon("dash", { size: 14 });
    default: return octicon("primitive-dot", { size: 14 });
  }
}

function runCount(v: ActionsView): string {
  return `${new Intl.NumberFormat().format(v.totalCount)}${v.countIsCapped ? "+" : ""} workflow ${v.totalCount === 1 ? "run" : "runs"}`;
}

function renderPager(v: ActionsView, query: string): string {
  if (v.totalPages <= 1) return "";
  const href = (page: number) => {
    const params = new URLSearchParams(query);
    params.set("page", String(page));
    return `?${escapeAttr(params.toString())}`;
  };
  return `
    <nav class="oldgh-actions__pager">
      ${v.page > 1 ? `<a href="${href(v.page - 1)}">‹ Newer</a>` : "<span></span>"}
      <span>Page ${v.page} of ${v.totalPages}</span>
      ${v.page < v.totalPages ? `<a href="${href(v.page + 1)}">Older ›</a>` : "<span></span>"}
    </nav>
  `;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
