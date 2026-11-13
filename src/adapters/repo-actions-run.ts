import { AdapterFailure } from "./index";
import { fetchPageDoc } from "./_page";
import { computeDuration, resolveStatus, type WorkflowRunStatus } from "./repo-actions";

export type RunDetail = {
  workflowName: string;
  workflowUrl: string | null;
  displayTitle: string;
  runNumber: number | null;
  runAttempt: number | null;
  event: string;
  status: WorkflowRunStatus;
  branch: string | null;
  branchUrl: string | null;
  commitShortSha: string | null;
  commitUrl: string | null;
  actor: { login: string; url: string; avatarUrl: string } | null;
  startedAt: string | null;
  duration: string | null;
  htmlUrl: string;
};

export type JobStep = {
  name: string;
  status: WorkflowRunStatus;
  number: number;
  duration: string | null;
};

export type JobDetail = {
  id: number;
  name: string;
  status: WorkflowRunStatus;
  href: string;
};

export type RunPage = {
  owner: string;
  repo: string;
  run: RunDetail;
  jobs: JobDetail[];
};

// the run page is server-rendered; jobs come from the same json endpoint github's own sidebar pages through
export async function getRunPage(owner: string, repo: string, runId: string): Promise<RunPage> {
  const htmlUrl = `https://github.com/${owner}/${repo}/actions/runs/${encodeURIComponent(runId)}`;
  const doc = await fetchPageDoc(htmlUrl);
  const summary = doc.querySelector('[aria-label="Workflow run summary"]');
  const title = doc.querySelector("h1.PageHeader-title");
  if (!summary || !title) throw new AdapterFailure("getRunPage", `run ${runId} not found on the page`);

  const jobsUrl = Array.from(doc.querySelectorAll('script[type="application/json"]'))
    .map((s) => s.textContent?.match(/"jobGroupsFetchUrl":"([^"]+)"/)?.[1])
    .find(Boolean) ?? `/${owner}/${repo}/actions/runs/${encodeURIComponent(runId)}/job_groups_batch?attempt=1`;
  const trigger = summary.querySelector(".col-triggered-content");
  const actorLink = trigger?.querySelector<HTMLAnchorElement>("a:has(img.avatar)");
  const commit = trigger?.querySelector('a[href*="/commit/"]')?.getAttribute("href") ?? "";
  const branch = trigger?.querySelector("a.branch-name");
  const parent = doc.querySelector(".PageHeader-parentLink a");
  const startedAt = summary.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? null;
  const triggerLabel = summary.querySelector("relative-time")?.parentElement;
  const attempt = Number(new URLSearchParams(jobsUrl.split("?")[1] ?? "").get("attempt")) || null;

  const run: RunDetail = {
    workflowName: text(parent?.querySelector(".PageHeader-parentLink-label")) || "Workflow",
    workflowUrl: parent?.getAttribute("href") ?? null,
    displayTitle: text(title.querySelector(".markdown-title")),
    runNumber: Number(text(title.querySelector(".color-fg-muted")).replace("#", "")) || null,
    runAttempt: attempt,
    event: triggerLabel ? ownText(triggerLabel).replace(/^Triggered via\s*/, "") : "",
    status: statusFromLabel(statValue(summary, "Status")),
    branch: text(branch) || null,
    branchUrl: branch?.getAttribute("href") ?? null,
    commitShortSha: commit ? (commit.split("/commit/")[1] ?? "").slice(0, 7) || null : null,
    commitUrl: commit || null,
    actor: actorLink ? {
      login: text(actorLink),
      url: actorLink.getAttribute("href") ?? "",
      avatarUrl: actorLink.querySelector("img")?.getAttribute("src") ?? "",
    } : null,
    startedAt,
    duration: statValue(summary, "Total duration") || null,
    htmlUrl,
  };
  return { owner, repo, run, jobs: await getRunJobs(jobsUrl) };
}

async function getRunJobs(jobsUrl: string): Promise<JobDetail[]> {
  const jobs: JobDetail[] = [];
  // same batch size github's own sidebar asks for; the cap stops a runaway loop
  for (let batch = 0; batch < 20; batch++) {
    const resp = await fetch(new URL(`${jobsUrl}&batch=${batch}&size=200`, "https://github.com").href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new AdapterFailure("getRunPage", `job list responded ${resp.status}`);
    const data = (await resp.json()) as { jobGroups?: unknown; hasMore?: unknown };
    collectJobs(data.jobGroups, jobs);
    if (data.hasMore !== true) break;
  }
  return jobs;
}

// matrix groups nest their jobs a level deeper than plain ones, so walk the whole group
function collectJobs(node: unknown, into: JobDetail[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectJobs(n, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o["id"] === "number" && typeof o["displayName"] === "string" && typeof o["href"] === "string") {
    const status = typeof o["status"] === "string" ? o["status"] : "";
    into.push({ id: o["id"], name: o["displayName"], href: o["href"], status: resolveStatus(status, typeof o["conclusion"] === "string" ? o["conclusion"] : null) });
    return;
  }
  for (const v of Object.values(o)) collectJobs(v, into);
}

export async function getJobSteps(href: string): Promise<{ steps: JobStep[]; duration: string | null }> {
  const doc = await fetchPageDoc(new URL(href, "https://github.com").href);
  const nodes = Array.from(doc.querySelectorAll("check-step[data-name]"));
  const steps = nodes.map((s) => {
    const conclusion = s.getAttribute("data-conclusion") ?? "";
    const startedAt = s.getAttribute("data-started-at") || null;
    return {
      name: s.getAttribute("data-name") ?? "",
      number: Number(s.getAttribute("data-number")) || 0,
      status: conclusion ? resolveStatus("completed", conclusion) : startedAt ? "in_progress" : "queued",
      duration: computeDuration(startedAt, s.getAttribute("data-completed-at") || null),
    };
  });
  const starts = nodes.map((s) => s.getAttribute("data-started-at")).filter(Boolean).sort();
  const ends = nodes.map((s) => s.getAttribute("data-completed-at")).filter(Boolean).sort();
  return { steps, duration: computeDuration(starts[0] ?? null, ends.at(-1) ?? null) };
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function ownText(el: Element): string {
  return Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
}

// each summary stat is a muted label span followed by its value
function statValue(summary: Element, label: string): string {
  const name = Array.from(summary.querySelectorAll("span.text-small")).find((s) => text(s) === label);
  return text(name?.nextElementSibling);
}

function statusFromLabel(label: string): WorkflowRunStatus {
  const key = label.toLowerCase().replace(/\s+/g, "_");
  if (key === "in_progress" || key === "queued") return key;
  if (key === "waiting" || key === "pending" || key === "requested") return "pending";
  return resolveStatus("completed", key);
}
