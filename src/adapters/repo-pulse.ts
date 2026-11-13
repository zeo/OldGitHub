import { AdapterFailure } from "./index";

export type PulseItem = {
  ref: string;
  title: string;
  path: string;
  date: string;
};

export type PulseList = {
  items: PulseItem[];
  authors: number;
};

export type PulseCommitter = {
  login: string;
  name: string;
  avatarUrl: string;
  commits: number;
};

export type PulseDiffstat = {
  authors: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  branchCommits: number;
  totalCommits: number;
  branch: string;
};

export type PulseView = {
  rangeLabel: string;
  mergedPrs: PulseList;
  newPrs: PulseList;
  closedIssues: PulseList;
  newIssues: PulseList;
  releases: PulseList;
  committers: PulseCommitter[];
  diffstat: PulseDiffstat | null;
};

// the json github's own pulse page reads; cookie-authed, so it covers private repos and spends no api quota
export async function getRepoPulse(owner: string, repo: string): Promise<PulseView> {
  const [overview, committers, diffstat] = await Promise.all(
    ["pulse-overview-data", "pulse-committer-data", "pulse-diffstat-summary"].map((p) => pulseJson(owner, repo, p)),
  );
  const o = readObj(overview);
  if (!o) throw new AdapterFailure("getRepoPulse", `${owner}/${repo} pulse overview missing`);
  const list = (items: string, authors: string, dateKey: string): PulseList => ({
    items: readArray(o[items]).flatMap((raw) => {
      const r = readObj(raw);
      const ref = r && (typeof r["number"] === "number" || typeof r["number"] === "string") ? String(r["number"]) : "";
      if (!r || !ref || typeof r["title"] !== "string") return [];
      return [{ ref, title: r["title"], path: readString(r, "path"), date: readString(r, dateKey) || readString(r, "createdAt") }];
    }),
    authors: readNumber(o, authors),
  });
  const d = readObj(diffstat);
  return {
    rangeLabel: readString(o, "rangeLabel"),
    mergedPrs: list("mergedPulls", "numAuthorsMergedPulls", "mergedAt"),
    newPrs: list("newPulls", "numAuthorsNewPulls", "createdAt"),
    closedIssues: list("closedIssues", "numAuthorsClosedIssues", "closedAt"),
    newIssues: list("newIssues", "numAuthorsNewIssues", "createdAt"),
    releases: list("releases", "numAuthorsReleases", "createdAt"),
    committers: readArray(committers).flatMap((raw) => {
      const c = readObj(raw);
      const login = c ? readString(c, "login") : "";
      return c && login ? [{ login, name: readString(c, "name"), avatarUrl: readString(c, "gravatar"), commits: readNumber(c, "commits") }] : [];
    }),
    diffstat: d ? {
      authors: readNumber(d, "authorsWithCommits"),
      filesChanged: readNumber(d, "filesChanged"),
      additions: readNumber(d, "additions"),
      deletions: readNumber(d, "deletions"),
      branchCommits: readNumber(d, "masterCommits"),
      totalCommits: readNumber(d, "totalCommits"),
      branch: readString(d, "defaultBranch"),
    } : null,
  };
}

async function pulseJson(owner: string, repo: string, path: string): Promise<unknown> {
  const resp = await fetch(`https://github.com/${owner}/${repo}/pulse-new/${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new AdapterFailure("getRepoPulse", `${path} responded ${resp.status}`);
  return resp.json() as Promise<unknown>;
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

// the payloads leave out zero values
function readNumber(o: Record<string, unknown>, key: string): number {
  return typeof o[key] === "number" ? (o[key] as number) : 0;
}
