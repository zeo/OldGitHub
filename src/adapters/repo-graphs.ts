import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";

const API = "https://api.github.com";

export type ContributorEntry = {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
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

export async function getRepoCommitActivity(owner: string, repo: string): Promise<CommitActivityView> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetchApi(`${API}/repos/${owner}/${repo}/stats/commit_activity`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.status === 202) {
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { owner, repo, status: "computing", weeks: [] };
    }
    if (!resp.ok) {
      throw new AdapterFailure("getRepoCommitActivity", `responded ${resp.status}`);
    }
    const data = (await resp.json()) as unknown;
    const arr = Array.isArray(data) ? data : [];
    const weeks: CommitActivityWeek[] = [];
    for (const w of arr) {
      if (!w || typeof w !== "object") continue;
      const o = w as Record<string, unknown>;
      const ts = typeof o["week"] === "number" ? (o["week"] as number) : 0;
      const total = typeof o["total"] === "number" ? (o["total"] as number) : 0;
      const days = Array.isArray(o["days"]) ? (o["days"] as unknown[]).map((x) => (typeof x === "number" ? x : 0)) : [];
      weeks.push({ ts, total, days });
    }
    return { owner, repo, status: "ok", weeks };
  }
  return { owner, repo, status: "computing", weeks: [] };
}

export async function getRepoCodeFrequency(owner: string, repo: string): Promise<CodeFrequencyView> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetchApi(`${API}/repos/${owner}/${repo}/stats/code_frequency`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.status === 202) {
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { owner, repo, status: "computing", points: [] };
    }
    if (!resp.ok) {
      throw new AdapterFailure("getRepoCodeFrequency", `responded ${resp.status}`);
    }
    const data = (await resp.json()) as unknown;
    const arr = Array.isArray(data) ? data : [];
    const points: CodeFrequencyPoint[] = [];
    for (const p of arr) {
      if (!Array.isArray(p) || p.length < 3) continue;
      const ts = typeof p[0] === "number" ? (p[0] as number) : 0;
      const additions = typeof p[1] === "number" ? (p[1] as number) : 0;
      const deletions = typeof p[2] === "number" ? (p[2] as number) : 0;
      points.push({ ts, additions, deletions });
    }
    return { owner, repo, status: "ok", points };
  }
  return { owner, repo, status: "computing", points: [] };
}

export async function getRepoContributors(owner: string, repo: string): Promise<ContributorsView> {
  // 202 = stats are being computed. Retry up to 3 times with backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetchApi(`${API}/repos/${owner}/${repo}/stats/contributors`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.status === 202) {
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { owner, repo, status: "computing", entries: [] };
    }
    if (!resp.ok) {
      throw new AdapterFailure("getRepoContributors", `stats/contributors responded ${resp.status}`);
    }
    const data = (await resp.json()) as unknown;
    const arr = Array.isArray(data) ? data : [];
    const entries = arr.map(parseContributor).filter((c): c is ContributorEntry => c !== null);
    entries.sort((a, b) => b.totalCommits - a.totalCommits);
    return { owner, repo, status: "ok", entries };
  }
  return { owner, repo, status: "computing", entries: [] };
}

function parseContributor(raw: unknown): ContributorEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const author = readObj(r["author"]);
  const login = author && typeof author["login"] === "string" ? (author["login"] as string) : null;
  if (!login) return null;
  const weeksRaw = Array.isArray(r["weeks"]) ? r["weeks"] : [];
  let adds = 0;
  let dels = 0;
  const weeks = weeksRaw
    .map((w) => {
      if (!w || typeof w !== "object") return null;
      const o = w as Record<string, unknown>;
      const ts = typeof o["w"] === "number" ? (o["w"] as number) : 0;
      const a = typeof o["a"] === "number" ? (o["a"] as number) : 0;
      const d = typeof o["d"] === "number" ? (o["d"] as number) : 0;
      const c = typeof o["c"] === "number" ? (o["c"] as number) : 0;
      adds += a;
      dels += d;
      return { ts, commits: c, additions: a, deletions: d };
    })
    .filter((w): w is { ts: number; commits: number; additions: number; deletions: number } => w !== null);

  const avatarUrl = author && typeof author["avatar_url"] === "string" ? (author["avatar_url"] as string) : `https://github.com/${login}.png?size=40`;
  const htmlUrl = author && typeof author["html_url"] === "string" ? (author["html_url"] as string) : `https://github.com/${login}`;
  return {
    login,
    avatarUrl,
    htmlUrl,
    totalCommits: typeof r["total"] === "number" ? (r["total"] as number) : weeks.reduce((s, w) => s + w.commits, 0),
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
  url: string | null;
  htmlUrl: string | null;
};

export type CommunityView = {
  owner: string;
  repo: string;
  healthPercentage: number;
  updatedAt: string | null;
  files: CommunityFile[];
  contentReportsEnabled: boolean;
};

const COMMUNITY_LABELS: Record<string, string> = {
  description: "Description",
  readme: "README",
  code_of_conduct: "Code of conduct",
  contributing: "Contributing",
  license: "License",
  pull_request_template: "Pull request template",
  issue_template: "Issue template",
};

const COMMUNITY_ORDER = [
  "description",
  "readme",
  "code_of_conduct",
  "contributing",
  "license",
  "pull_request_template",
  "issue_template",
];

// github returns both code_of_conduct (named coc) and code_of_conduct_file (the
// actual file); treat either as the single code_of_conduct entry to avoid a
// duplicate row and an inflated present/total count
const COMMUNITY_ALIASES: Record<string, string[]> = {
  code_of_conduct: ["code_of_conduct", "code_of_conduct_file"],
};

export async function getCommunityProfile(owner: string, repo: string): Promise<CommunityView> {
  const resp = await fetchApi(`${API}/repos/${owner}/${repo}/community/profile`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getCommunityProfile", `responded ${resp.status}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const healthPercentage = typeof data["health_percentage"] === "number" ? (data["health_percentage"] as number) : 0;
  const updatedAt = typeof data["updated_at"] === "string" ? (data["updated_at"] as string) : null;
  const contentReportsEnabled = data["content_reports_enabled"] === true;
  const filesObj = (data["files"] && typeof data["files"] === "object" ? (data["files"] as Record<string, unknown>) : {}) || {};
  const description = typeof data["description"] === "string" && (data["description"] as string).trim().length > 0;
  const files: CommunityFile[] = [];
  for (const key of COMMUNITY_ORDER) {
    if (key === "description") {
      files.push({ key, label: COMMUNITY_LABELS[key]!, present: description, url: null, htmlUrl: null });
      continue;
    }
    const aliasKeys = COMMUNITY_ALIASES[key] ?? [key];
    let entry: unknown = undefined;
    for (const ak of aliasKeys) {
      const candidate = filesObj[ak];
      if (candidate !== null && candidate !== undefined) {
        entry = candidate;
        break;
      }
    }
    if (entry === null || entry === undefined) {
      files.push({ key, label: COMMUNITY_LABELS[key]!, present: false, url: null, htmlUrl: null });
      continue;
    }
    if (typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const url = typeof e["url"] === "string" ? (e["url"] as string) : null;
      const htmlUrl = typeof e["html_url"] === "string" ? (e["html_url"] as string) : null;
      const name = typeof e["name"] === "string" ? (e["name"] as string) : null;
      const label = name ? `${COMMUNITY_LABELS[key]} (${name})` : COMMUNITY_LABELS[key]!;
      files.push({ key, label, present: !!(url || htmlUrl), url, htmlUrl });
    }
  }
  return { owner, repo, healthPercentage, updatedAt, files, contentReportsEnabled };
}
