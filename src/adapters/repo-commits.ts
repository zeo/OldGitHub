import { AdapterFailure } from "./index";
import { extractEmbeddedPayload, parseRepoPage } from "./_page";

export type PersonRef = {
  login: string;
  displayName: string;
  avatarUrl: string;
  path: string;
};

export type CommitEntry = {
  oid: string;
  url: string;
  authoredDate: string;
  committedDate: string;
  shortMessage: string;
  shortMessageMarkdownLink: string | null;
  authors: PersonRef[];
  committer: PersonRef | null;
};

export type CommitGroup = {
  title: string;
  commits: CommitEntry[];
};

export type CommitsView = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  groups: CommitGroup[];
  pagination: {
    hasNext: boolean;
    hasPrevious: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};

export async function getRepoCommits(
  owner: string,
  repo: string,
  refAndPath: string,
  query: string,
): Promise<CommitsView> {
  const url = `https://github.com/${owner}/${repo}/commits/${refAndPath}${query ? "?" + query : ""}`;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getRepoCommits", `commits responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);
  const payload = extractEmbeddedPayload(doc);

  // github's data router nests the page under commitsRefRoute; older rollouts put it at the top
  const page = read<Record<string, unknown>>(payload, "payload");
  const root = read<Record<string, unknown>>(page, "commitsRefRoute") ?? page;
  if (!root) {
    throw new AdapterFailure("getRepoCommits", "missing payload");
  }

  const groups = readGroups(root["commitGroups"]);
  if (groups === null) {
    throw new AdapterFailure("getRepoCommits", "missing or invalid commitGroups");
  }

  const refInfo = read<{ name?: unknown }>(root, "refInfo");
  const branch = typeof refInfo?.name === "string" ? refInfo.name : extractRefFromPath(refAndPath);
  const filters = read<Record<string, unknown>>(root, "filters");
  const rawPath = root["path"] ?? filters?.["currentBlobPath"];
  const path = typeof rawPath === "string" ? rawPath : "";

  return {
    owner,
    repo,
    branch,
    path,
    groups,
    pagination: readPagination(root),
  };
}

function readGroups(raw: unknown): CommitGroup[] | null {
  if (!Array.isArray(raw)) return null;
  const groups: CommitGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") return null;
    const obj = g as Record<string, unknown>;
    const title = obj["title"];
    const commitsRaw = obj["commits"];
    if (typeof title !== "string" || !Array.isArray(commitsRaw)) return null;
    const commits: CommitEntry[] = [];
    for (const c of commitsRaw) {
      const parsed = readCommit(c);
      if (parsed) commits.push(parsed);
    }
    groups.push({ title, commits });
  }
  return groups;
}

function readCommit(raw: unknown): CommitEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const oid = c["oid"];
  const url = c["url"];
  const authoredDate = c["authoredDate"];
  const committedDate = c["committedDate"];
  const shortMessage = c["shortMessage"];
  if (
    typeof oid !== "string" ||
    typeof url !== "string" ||
    typeof authoredDate !== "string" ||
    typeof committedDate !== "string" ||
    typeof shortMessage !== "string"
  ) {
    return null;
  }
  const link = c["shortMessageMarkdownLink"];
  return {
    oid,
    url,
    authoredDate,
    committedDate,
    shortMessage,
    shortMessageMarkdownLink: typeof link === "string" ? link : null,
    authors: readPersonArray(c["authors"]),
    committer: readPerson(c["committer"]),
  };
}

function readPersonArray(raw: unknown): PersonRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonRef[] = [];
  for (const p of raw) {
    const parsed = readPerson(p);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readPerson(raw: unknown): PersonRef | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const login = p["login"];
  const displayName = p["displayName"];
  const avatarUrl = p["avatarUrl"];
  const path = p["path"];
  if (
    typeof login !== "string" ||
    typeof displayName !== "string" ||
    typeof avatarUrl !== "string" ||
    typeof path !== "string"
  ) {
    return null;
  }
  return { login, displayName, avatarUrl, path };
}

function readPagination(root: Record<string, unknown>): CommitsView["pagination"] {
  const pag = read<Record<string, unknown>>(root, "paginationParameters")
    ?? read<Record<string, unknown>>(read(root, "filters"), "pagination")
    ?? root;
  return {
    hasNext: pag["hasNextPage"] === true,
    hasPrevious: pag["hasPreviousPage"] === true,
    startCursor: typeof pag["startCursor"] === "string" ? (pag["startCursor"] as string) : null,
    endCursor: typeof pag["endCursor"] === "string" ? (pag["endCursor"] as string) : null,
  };
}

function extractRefFromPath(refAndPath: string): string {
  return refAndPath.split("/")[0] ?? "";
}

function read<T>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key] as T | undefined;
}
