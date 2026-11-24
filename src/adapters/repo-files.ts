import { AdapterFailure } from "./index";
import { extractEmbeddedPayload, fetchRepoPage, parseRepoPage } from "./_page";
import { fetchApi } from "./rate-limit";

export type FileList = { ref: string; paths: string[] };

let last: { key: string; paths: Promise<string[]> } | null = null;

function readRefInfo(html: string): { name?: unknown; currentOid?: unknown } | null {
  try {
    const payload = extractEmbeddedPayload(parseRepoPage(html)) as { payload?: Record<string, unknown> };
    const p = payload?.payload;
    if (p && typeof p === "object") {
      const candidates = [p["refInfo"], (p["codeViewRepoRoute"] as Record<string, unknown> | undefined)?.["refInfo"], (p["codeViewTreeRoute"] as Record<string, unknown> | undefined)?.["refInfo"], (p["codeViewBlobLayoutRoute"] as Record<string, unknown> | undefined)?.["refInfo"]];
      for (const c of candidates) {
        if (c && typeof c === "object") return c as { name?: unknown; currentOid?: unknown };
      }
    }
  } catch {
    // fall back to direct pattern match if html has inline refInfo outside embeddedData
  }
  const raw = /"refInfo":(\{[^{}]*\})/.exec(html)?.[1];
  return raw ? (JSON.parse(raw) as { name?: unknown; currentOid?: unknown }) : null;
}

// tree and blob pages name the ref they show; any other repo page means the default branch
export async function getFileList(owner: string, repo: string, codePath: string | null): Promise<FileList> {
  const html = codePath ? await fetchCodePage(codePath) : await fetchRepoPage(owner, repo);
  const info = readRefInfo(html);
  if (typeof info?.name !== "string" || typeof info.currentOid !== "string") {
    throw new AdapterFailure("getFileList", "page has no refInfo");
  }
  const key = `${owner}/${repo}@${info.currentOid}`.toLowerCase();
  if (last?.key !== key) {
    const paths = loadPaths(owner, repo, info.currentOid);
    last = { key, paths };
    paths.catch(() => last?.paths === paths && (last = null));
  }
  return { ref: info.name, paths: await last.paths };
}

async function fetchCodePage(path: string): Promise<string> {
  const resp = await fetch(`https://github.com${path}`, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) throw new AdapterFailure("getFileList", `${path} responded ${resp.status}`);
  return resp.text();
}

async function loadPaths(owner: string, repo: string, oid: string): Promise<string[]> {
  const resp = await fetch(`https://github.com/${owner}/${repo}/tree-list/${oid}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (resp.ok) {
    const data = (await resp.json()) as { paths?: unknown };
    if (Array.isArray(data.paths)) return data.paths.filter((p): p is string => typeof p === "string");
  }
  // tree-list is the endpoint github's own finder uses and is undocumented, so the public api backs it up
  const api = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/git/trees/${oid}?recursive=1`, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!api.ok) throw new AdapterFailure("getFileList", `git/trees responded ${api.status}`);
  const data = (await api.json()) as { tree?: Array<{ path?: unknown; type?: unknown }> };
  return (data.tree ?? []).flatMap((e) => (e.type === "blob" && typeof e.path === "string" ? [e.path] : []));
}
