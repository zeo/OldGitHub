import { AdapterFailure } from "./index";
import { fetchApi } from "./rate-limit";
import { parsePatch, type DiffFile } from "@/util/diff";

export type CompareView = {
  owner: string;
  repo: string;
  base: string;
  head: string;
  threeDot: boolean;
  files: DiffFile[];
};

export async function getCompare(owner: string, repo: string, range: string): Promise<CompareView> {
  const { base, head, threeDot } = parseRange(range);
  const basehead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const resp = await fetchApi(
    `https://api.github.com/repos/${owner}/${repo}/compare/${basehead}`,
    { credentials: "omit", headers: { Accept: "application/vnd.github+json" } },
  );
  if (!resp.ok) {
    throw new AdapterFailure("getCompare", `REST compare ${owner}/${repo}/${basehead} responded ${resp.status}`);
  }
  const data = (await resp.json()) as { files?: unknown };
  const restFiles = Array.isArray(data.files) ? data.files : [];
  const files: DiffFile[] = [];
  for (const f of restFiles) {
    if (!f || typeof f !== "object") continue;
    const obj = f as Record<string, unknown>;
    const filename = typeof obj["filename"] === "string" ? (obj["filename"] as string) : "";
    if (!filename) continue;
    const patch = typeof obj["patch"] === "string" ? (obj["patch"] as string) : "";
    // github omits the patch for large files; its counts still drive the head and the large-diff placeholder
    files.push({
      path: filename,
      oldPath: typeof obj["previous_filename"] === "string" ? (obj["previous_filename"] as string) : filename,
      newPath: filename,
      status: obj["status"] === "added" ? "added" : obj["status"] === "removed" ? "deleted" : obj["status"] === "renamed" ? "renamed" : "modified",
      oldMode: null,
      newMode: null,
      hunks: patch ? parsePatch(patch) : [],
      additions: typeof obj["additions"] === "number" ? (obj["additions"] as number) : 0,
      deletions: typeof obj["deletions"] === "number" ? (obj["deletions"] as number) : 0,
      isBinary: false,
      binaryNote: null,
    });
  }
  return { owner, repo, base, head, threeDot, files };
}

function parseRange(range: string): { base: string; head: string; threeDot: boolean } {
  const threeDotIdx = range.indexOf("...");
  if (threeDotIdx >= 0) {
    const base = range.slice(0, threeDotIdx);
    const head = range.slice(threeDotIdx + 3);
    // a blank side (e.g. "main...") would render an empty ref link; let native handle it
    if (!base || !head) {
      throw new AdapterFailure("getCompare", `compare range missing a side: ${range}`);
    }
    return { base, head, threeDot: true };
  }
  const twoDotIdx = range.indexOf("..");
  if (twoDotIdx >= 0) {
    const base = range.slice(0, twoDotIdx);
    const head = range.slice(twoDotIdx + 2);
    if (!base || !head) {
      throw new AdapterFailure("getCompare", `compare range missing a side: ${range}`);
    }
    return { base, head, threeDot: false };
  }
  throw new AdapterFailure("getCompare", `unrecognized compare range: ${range}`);
}
