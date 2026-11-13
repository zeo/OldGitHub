import { AdapterFailure } from "./index";
import { fetchPageDoc } from "./_page";

export type ContributorEntry = {
  login: string;
  avatarUrl: string;
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  weeks: Array<{ ts: number; commits: number; additions: number; deletions: number }>;
};

export type ContributorsView = {
  owner: string;
  repo: string;
  status: "ok" | "computing";
  entries: ContributorEntry[];
};

export type CommitActivityWeek = {
  ts: number;
  total: number;
  days: number[]; // Sun..Sat
};

export type CommitActivityView = {
  owner: string;
  repo: string;
  status: "ok" | "computing";
  weeks: CommitActivityWeek[];
};

export type CodeFrequencyPoint = {
  ts: number;
  additions: number;
  deletions: number;
};

export type CodeFrequencyView = {
  owner: string;
  repo: string;
  status: "ok" | "computing";
  points: CodeFrequencyPoint[];
};

// the insights graphs read these same-origin json files, shaped like the stats api, without spending api quota
async function fetchGraphData(owner: string, repo: string, kind: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(`https://github.com/${owner}/${repo}/graphs/${kind}-data`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (resp.status === 202) {
      if (attempt < 2) await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!resp.ok) throw new AdapterFailure(kind, `responded ${resp.status}`);
    const data = (await resp.json()) as unknown;
    if (readObj(data)?.["tooLarge"] === true) throw new AdapterFailure(kind, "too large");
    return data;
  }
  return null;
}

export async function getRepoCommitActivity(owner: string, repo: string): Promise<CommitActivityView> {
  const data = await fetchGraphData(owner, repo, "commit-activity");
  if (data === null) return { owner, repo, status: "computing", weeks: [] };
  const weeks: CommitActivityWeek[] = [];
  for (const w of Array.isArray(data) ? data : []) {
    const o = readObj(w);
    if (!o) continue;
    const ts = typeof o["week"] === "number" ? o["week"] : 0;
    const total = typeof o["total"] === "number" ? o["total"] : 0;
    const days = Array.isArray(o["days"]) ? (o["days"] as unknown[]).map((x) => (typeof x === "number" ? x : 0)) : [];
    weeks.push({ ts, total, days });
  }
  return { owner, repo, status: "ok", weeks };
}

export async function getRepoCodeFrequency(owner: string, repo: string): Promise<CodeFrequencyView> {
  const data = await fetchGraphData(owner, repo, "code-frequency");
  if (data === null) return { owner, repo, status: "computing", points: [] };
  const points: CodeFrequencyPoint[] = [];
  for (const p of Array.isArray(data) ? data : []) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const [ts, additions, deletions] = p.map((x: unknown) => (typeof x === "number" ? x : 0));
    points.push({ ts: ts!, additions: additions!, deletions: deletions! });
  }
  return { owner, repo, status: "ok", points };
}

export async function getRepoContributors(owner: string, repo: string): Promise<ContributorsView> {
  const data = await fetchGraphData(owner, repo, "contributors");
  if (data === null) return { owner, repo, status: "computing", entries: [] };
  const entries = (Array.isArray(data) ? data : []).map(parseContributor).filter((c): c is ContributorEntry => c !== null);
  entries.sort((a, b) => b.totalCommits - a.totalCommits);
  return { owner, repo, status: "ok", entries };
}

function parseContributor(raw: unknown): ContributorEntry | null {
  const r = readObj(raw);
  const author = readObj(r?.["author"]);
  const login = typeof author?.["login"] === "string" ? author["login"] : null;
  if (!r || !login) return null;
  let adds = 0;
  let dels = 0;
  const weeks = (Array.isArray(r["weeks"]) ? r["weeks"] : []).flatMap((w: unknown) => {
    const o = readObj(w);
    if (!o) return [];
    const num = (k: string): number => (typeof o[k] === "number" ? (o[k] as number) : 0);
    adds += num("a");
    dels += num("d");
    return [{ ts: num("w"), commits: num("c"), additions: num("a"), deletions: num("d") }];
  });
  return {
    login,
    avatarUrl: typeof author?.["avatar"] === "string" ? author["avatar"] : `https://github.com/${login}.png?size=40`,
    totalCommits: typeof r["total"] === "number" ? r["total"] : weeks.reduce((s, w) => s + w.commits, 0),
    totalAdditions: adds,
    totalDeletions: dels,
    weeks,
  };
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type CommunityFile = {
  key: string;
  label: string;
  present: boolean;
  href: string | null;
};

export type CommunityView = {
  owner: string;
  repo: string;
  files: CommunityFile[];
};

// keys pick the setup link for a missing item; github's own row labels are shown as is
const COMMUNITY_KEYS: Record<string, string> = {
  Description: "description",
  README: "readme",
  "Code of conduct": "code_of_conduct",
  Contributing: "contributing",
  License: "license",
  "Security policy": "security",
  "Issue templates": "issue_template",
  "Pull request template": "pull_request_template",
};

export async function getCommunityProfile(owner: string, repo: string): Promise<CommunityView> {
  const doc = await fetchPageDoc(`https://github.com/${owner}/${repo}/community`);
  const files = Array.from(doc.querySelectorAll("main ul.Box > li.Box-row:has(svg[aria-label])"), (li) => {
    // the icon's parent holds just the label and, once added, the file link; docs and setup links sit outside it
    const item = li.querySelector("svg[aria-label]")!.parentElement!;
    const present = item.querySelector(".octicon-check") !== null;
    const label = item.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const href = present ? item.querySelector("a[href]")?.getAttribute("href") ?? null : null;
    return { key: COMMUNITY_KEYS[label] ?? "", label, present, href };
  }).filter((f) => f.label);
  if (files.length === 0) throw new AdapterFailure("getCommunityProfile", "community page has no checklist");
  return { owner, repo, files };
}
