import { AdapterFailure } from "./index";
import { loadPagePayload } from "./_page";

export type WorkflowRunStatus = "success" | "failure" | "pending" | "queued" | "in_progress" | "cancelled" | "skipped" | "neutral" | "action_required" | "timed_out" | "stale" | "unknown";

export type WorkflowRun = {
  url: string;
  title: string;
  workflowName: string;
  runNumber: number | null;
  status: WorkflowRunStatus;
  event: string;
  eventLink: { text: string; url: string } | null;
  branch: string | null;
  branchUrl: string | null;
  actor: { login: string; url: string } | null;
  startedAt: string | null;
  duration: string | null;
};

export type WorkflowFile = {
  name: string;
  filePath: string;
  href: string;
};

export type ActionsView = {
  owner: string;
  repo: string;
  workflows: WorkflowFile[];
  runs: WorkflowRun[];
  totalCount: number;
  countIsCapped: boolean;
  page: number;
  totalPages: number;
  selectedWorkflowName: string | null;
  selectedWorkflowFilePath: string | null;
};

// github's own actions page carries the runs and the workflow list in its react payload
export async function getActions(owner: string, repo: string, query: string, workflowPath: string | null = null): Promise<ActionsView> {
  const file = workflowPath?.replace(/^\.github\/workflows\//, "") ?? "";
  const base = `https://github.com/${owner}/${repo}/actions${file ? `/workflows/${file}` : ""}`;
  const payload = readObj(readObj(await loadPagePayload(query ? `${base}?${query}` : base))?.["payload"]);
  const runsRoute = payload && Object.values(payload).map(readObj).find((r) => Array.isArray(r?.["workflowRuns"]));
  if (!runsRoute) throw new AdapterFailure("getActions", `${owner}/${repo} actions payload missing`);

  const workflows = readArray(readObj(payload["workflowsLayoutRoute"])?.["workflows"]).flatMap((raw) => {
    const w = readObj(raw);
    const filePath = w ? readString(w, "path") : "";
    if (!w || !filePath) return [];
    return [{ name: readString(w, "name") || filePath, filePath, href: `/${owner}/${repo}/actions/workflows/${filePath.replace(/^\.github\/workflows\//, "")}` }];
  });
  const selectedWorkflowFilePath = file ? `.github/workflows/${file}` : null;
  const header = readObj(runsRoute["header"]);
  const runs = readArray(runsRoute["workflowRuns"]).flatMap((raw) => {
    const r = readObj(raw);
    return r ? [parseRun(r)] : [];
  });

  return {
    owner,
    repo,
    workflows,
    runs,
    totalCount: readNumber(runsRoute, "totalCount") ?? runs.length,
    countIsCapped: runsRoute["countIsCapped"] === true,
    page: Math.max(1, parseInt(new URLSearchParams(query).get("page") ?? "1", 10) || 1),
    totalPages: readNumber(runsRoute, "totalPages") ?? 1,
    selectedWorkflowName: selectedWorkflowFilePath
      ? (workflows.find((w) => w.filePath === selectedWorkflowFilePath)?.name ?? (header ? readString(header, "title") : "")) || null
      : null,
    selectedWorkflowFilePath,
  };
}

function parseRun(r: Record<string, unknown>): WorkflowRun {
  const state = readObj(r["state"]);
  const branch = readObj(r["branch"]);
  const desc = readObj(r["description"]);
  const actorName = desc ? readString(desc, "actorName") : "";
  const linkText = desc ? readString(desc, "linkText") : "";
  const startedAt = readString(readObj(r["createdAt"]) ?? {}, "timestamp");
  return {
    url: readString(r, "runUrl").replace(/^https:\/\/github\.com/, ""),
    title: readString(r, "title"),
    workflowName: readString(r, "workflowName") || readString(r, "name") || "Workflow",
    runNumber: readNumber(r, "runNumber"),
    status: state ? resolveStatus(enumTail(readString(state, "status")), enumTail(readString(state, "conclusion")) || null) : "unknown",
    event: desc ? readString(desc, "primaryText") : "",
    eventLink: desc && linkText ? { text: linkText, url: readString(desc, "linkUrl") } : null,
    branch: branch ? readString(branch, "title") || null : null,
    branchUrl: branch ? readString(branch, "url") || null : null,
    actor: desc && actorName ? { login: actorName, url: readString(desc, "actorUrl") || `/${actorName}` } : null,
    startedAt: startedAt || null,
    duration: readString(readObj(r["timing"]) ?? {}, "text") || null,
  };
}

// the payload spells states as WORKFLOW_RUN_STATUS_IN_PROGRESS and WORKFLOW_RUN_CONCLUSION_TIMED_OUT
function enumTail(value: string): string {
  return value.replace(/^WORKFLOW_RUN_(STATUS|CONCLUSION)_/, "").toLowerCase();
}

export function resolveStatus(status: string, conclusion: string | null): WorkflowRunStatus {
  if (status !== "completed") {
    if (status === "queued") return "queued";
    if (status === "in_progress") return "in_progress";
    if (status === "") return "unknown";
    return "pending";
  }
  switch (conclusion) {
    case "success": return "success";
    case "failure": return "failure";
    case "timed_out": return "timed_out";
    case "action_required": return "action_required";
    case "cancelled": return "cancelled";
    case "skipped": return "skipped";
    case "neutral": return "neutral";
    case "stale": return "stale";
    default: return "unknown";
  }
}

export function computeDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return `${min}m ${rest}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function readString(o: Record<string, unknown>, key: string): string {
  return typeof o[key] === "string" ? (o[key] as string) : "";
}

function readNumber(o: Record<string, unknown>, key: string): number | null {
  return typeof o[key] === "number" ? (o[key] as number) : null;
}
