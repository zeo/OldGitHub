import { AdapterFailure } from "./index";
import { extractEmbeddedPayload, parseRepoPage } from "./_page";
import { parseUnifiedDiff, type DiffFile } from "@/util/diff";

export type PersonRef = {
  login: string;
  displayName: string;
  avatarUrl: string;
  path: string;
};

export type CommitView = {
  owner: string;
  repo: string;
  oid: string;
  url: string;
  authoredDate: string;
  committedDate: string;
  shortMessage: string;
  bodyMessageHtml: string | null;
  authors: PersonRef[];
  committer: PersonRef | null;
  parents: string[];
  files: DiffFile[];
};

export async function getCommit(owner: string, repo: string, sha: string): Promise<CommitView> {
  const [meta, diff] = await Promise.all([
    fetchCommitMeta(owner, repo, sha),
    fetchCommitDiff(owner, repo, sha),
  ]);
  return { ...meta, owner, repo, files: parseUnifiedDiff(diff) };
}

async function fetchCommitMeta(
  owner: string,
  repo: string,
  sha: string,
): Promise<Omit<CommitView, "owner" | "repo" | "files">> {
  const resp = await fetch(`https://github.com/${owner}/${repo}/commit/${sha}`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getCommit", `commit page responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);
  const payload = extractEmbeddedPayload(doc);

  const page = read<Record<string, unknown>>(payload, "payload");
  const commit = read<Record<string, unknown>>(read(page, "commitRoute") ?? page, "commit");
  if (!commit) {
    throw new AdapterFailure("getCommit", "missing commit in payload");
  }

  const oid = commit["oid"];
  const url = commit["url"];
  const authoredDate = commit["authoredDate"];
  const committedDate = commit["committedDate"];
  const shortMessageRaw = commit["shortMessage"];
  const messageMarkdown = commit["shortMessageMarkdown"];
  if (
    typeof oid !== "string" ||
    typeof url !== "string" ||
    typeof authoredDate !== "string" ||
    typeof committedDate !== "string"
  ) {
    throw new AdapterFailure("getCommit", "commit payload missing core fields");
  }

  const shortMessage = typeof shortMessageRaw === "string"
    ? shortMessageRaw
    : typeof messageMarkdown === "string"
      ? stripHtml(messageMarkdown).trim()
      : "";

  return {
    oid,
    url,
    authoredDate,
    committedDate,
    shortMessage,
    bodyMessageHtml: typeof commit["bodyMessageHtml"] === "string" ? (commit["bodyMessageHtml"] as string) : null,
    authors: readPersonArray(commit["authors"]),
    committer: readPerson(commit["committer"]),
    parents: readParents(commit["parents"]),
  };
}

async function fetchCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
  const resp = await fetch(`https://github.com/${owner}/${repo}/commit/${sha}.diff`, {
    credentials: "include",
    headers: { Accept: "text/plain" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getCommit", `.diff responded ${resp.status}`);
  }
  return resp.text();
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

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function readParents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    // parents may be bare oid strings or objects like {oid,url}
    if (typeof entry === "string") {
      out.push(entry);
    } else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)["oid"] === "string") {
      out.push((entry as Record<string, unknown>)["oid"] as string);
    }
  }
  return out;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function read<T>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key] as T | undefined;
}
