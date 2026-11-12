import { AdapterFailure } from "./index";
import { extractEmbeddedPayload, fetchRepoPage, parseRepoPage } from "./_page";
import { fetchApi, isApiRateLimited } from "./rate-limit";

export type TreeItem = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type CloneUrls = {
  https: string | null;
  ssh: string | null;
  ghCli: string | null;
  zip: string | null;
};

export type ReadmeFile = {
  path: string;
  html: string;
};

export type RepoOverview = {
  owner: string;
  repo: string;
  branch: string;
  commitCount: string | null;
  tree: TreeItem[];
  readme: ReadmeFile | null;
  clone: CloneUrls;
  isEmpty?: boolean;
};

export type CommitInfo = {
  oid: string;
  url: string;
  date: string;
  shortMessageHtmlLink: string;
};

export type RepoTreeView = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  items: TreeItem[];
};

export async function getRepoTree(owner: string, repo: string, refAndPath: string): Promise<RepoTreeView> {
  const url = `https://github.com/${owner}/${repo}/tree/${refAndPath}`;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getRepoTree", `${owner}/${repo}/tree/${refAndPath} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);
  const payload = extractEmbeddedPayload(doc);

  const route = read<{ payload?: unknown }>(payload, "payload");
  const treeRoute = read<{ codeViewTreeRoute?: unknown }>(route, "codeViewTreeRoute");
  if (!treeRoute) {
    throw new AdapterFailure("getRepoTree", "missing codeViewTreeRoute in payload");
  }

  const refInfo = read<{ name?: unknown }>(treeRoute, "refInfo");
  const branch = typeof refInfo?.name === "string" ? refInfo.name : null;
  const path = (treeRoute as { path?: unknown }).path;
  if (!branch || typeof path !== "string") {
    throw new AdapterFailure("getRepoTree", "missing refInfo.name or path");
  }

  return {
    owner,
    repo,
    branch,
    path,
    items: readTree(treeRoute),
  };
}

export type RepoBlobView = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  displayName: string;
  language: string | null;
  rawLines: string[];
  size: number;
  rawBlobUrl: string | null;
  truncated: boolean;
  isBinary: boolean;
};

export async function getRepoBlob(owner: string, repo: string, refAndPath: string): Promise<RepoBlobView> {
  const { branch, path } = await resolveBranchAndPath(owner, repo, refAndPath);

  if (isApiRateLimited()) {
    return loadBlobViaScrape(owner, repo, branch, path);
  }
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
  const resp = await fetchApi(contentsUrl, {
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    // 404 on private repos (anon API hides them), 401/403 on auth issues,
    // 429 on rate limit — fall back to scraping the github.com blob page.
    return loadBlobViaScrape(owner, repo, branch, path);
  }
  const meta = (await resp.json()) as Record<string, unknown>;
  if (Array.isArray(meta)) {
    throw new AdapterFailure("getRepoBlob", `${path} is a directory, not a file`);
  }

  const encoding = typeof meta["encoding"] === "string" ? (meta["encoding"] as string) : "";
  const sizeRaw = meta["size"];
  const size = typeof sizeRaw === "number" ? sizeRaw : 0;
  const downloadUrlRaw = meta["download_url"];
  const rawBlobUrl = typeof downloadUrlRaw === "string" ? downloadUrlRaw : null;
  const displayName = pathBasename(path);
  const language = guessLanguage(path);

  let rawLines: string[] = [];
  let isBinary = false;
  let truncated = false;

  if (encoding === "base64" && typeof meta["content"] === "string") {
    const decoded = decodeBase64Utf8((meta["content"] as string).replace(/\n/g, ""));
    if (decoded === null) {
      isBinary = true;
    } else {
      rawLines = splitLines(decoded);
    }
  } else if (encoding === "none" || size > 1_000_000) {
    truncated = true;
    if (rawBlobUrl) {
      try {
        const r = await fetch(rawBlobUrl, { credentials: "omit" });
        if (r.ok) {
          const text = await r.text();
          rawLines = splitLines(text);
          truncated = false;
        }
      } catch {
        // keep truncated
      }
    }
  }

  return {
    owner,
    repo,
    branch,
    path,
    displayName,
    language,
    rawLines,
    size,
    rawBlobUrl,
    truncated,
    isBinary,
  };
}

async function loadBlobViaScrape(owner: string, repo: string, branch: string, path: string): Promise<RepoBlobView> {
  // public repos: raw.githubusercontent.com works anonymously
  // private repos: github.com/raw redirects to a signed url and needs the session cookie
  // both go through the background service worker to bypass cross-origin cors
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
  let proxy = await proxyFetchViaBackground(rawUrl, "omit");
  if (!proxy.ok) {
    const ghRawUrl = `https://github.com/${owner}/${repo}/raw/refs/heads/${encodeURIComponent(branch)}/${encodedPath}`;
    proxy = await proxyFetchViaBackground(ghRawUrl, "include");
    if (!proxy.ok) {
      throw new AdapterFailure("getRepoBlob", `raw ${owner}/${repo}/${path}@${branch} responded ${proxy.status || "network error"}`);
    }
  }
  const isText = /^text\b|^application\/(json|xml|x-yaml|javascript|sh|toml)|json|yaml|markdown|html|svg/i.test(proxy.contentType);
  if (!isText) {
    return {
      owner, repo, branch, path,
      displayName: pathBasename(path),
      language: guessLanguage(path),
      rawLines: [],
      size: 0,
      rawBlobUrl: rawUrl,
      truncated: false,
      isBinary: true,
    };
  }
  return {
    owner, repo, branch, path,
    displayName: pathBasename(path),
    language: guessLanguage(path),
    rawLines: splitLines(proxy.text),
    size: new TextEncoder().encode(proxy.text).length,
    rawBlobUrl: rawUrl,
    truncated: false,
    isBinary: false,
  };
}

type ProxyFetchOk = { ok: true; status: number; contentType: string; text: string };
type ProxyFetchErr = { ok: false; status: number; error?: string };
type ProxyFetchResult = ProxyFetchOk | ProxyFetchErr;

async function proxyFetchViaBackground(url: string, credentials: "include" | "omit"): Promise<ProxyFetchResult> {
  try {
    const res = await chrome.runtime.sendMessage({ type: "oldgh:fetch", url, credentials });
    if (res && typeof res === "object" && "ok" in res) return res as ProxyFetchResult;
    return { ok: false, status: 0, error: "bad response" };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

async function resolveBranchAndPath(owner: string, repo: string, refAndPath: string): Promise<{ branch: string; path: string }> {
  const segs = refAndPath.split("/").filter(Boolean);
  if (segs.length === 0) {
    throw new AdapterFailure("getRepoBlob", "empty refAndPath");
  }
  if (segs.length === 1) {
    return { branch: decodeURIComponent(segs[0]!), path: "" };
  }
  try {
    const refsUrl = `https://api.github.com/repos/${owner}/${repo}/git/matching-refs/heads/${encodeURIComponent(decodeURIComponent(segs[0]!))}`;
    const r = await fetchApi(refsUrl, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
    if (r.ok) {
      const refs = (await r.json()) as Array<{ ref?: string }>;
      const names = refs.map((x) => (x.ref || "").replace(/^refs\/heads\//, "")).filter(Boolean);
      let best = "";
      for (const name of names) {
        const enc = name.split("/").map(encodeURIComponent).join("/");
        if (refAndPath === enc || refAndPath.startsWith(enc + "/")) {
          if (name.length > best.length) best = name;
        }
      }
      if (best) {
        const enc = best.split("/").map(encodeURIComponent).join("/");
        const rest = refAndPath === enc ? "" : refAndPath.slice(enc.length + 1);
        return { branch: best, path: rest.split("/").map(decodeURIComponent).join("/") };
      }
    }
  } catch {
    // fall through
  }
  const branch = decodeURIComponent(segs[0]!);
  const path = segs.slice(1).map(decodeURIComponent).join("/");
  return { branch, path };
}

function decodeBase64Utf8(b64: string): string | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
      const b = bytes[i]!;
      if (b === 0) return null;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function guessLanguage(path: string): string | null {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!ext) {
    const base = pathBasename(path).toLowerCase();
    const byName: Record<string, string> = {
      "dockerfile": "Dockerfile",
      "makefile": "Makefile",
      "rakefile": "Ruby",
      "gemfile": "Ruby",
    };
    return byName[base] ?? null;
  }
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
    mjs: "JavaScript", cjs: "JavaScript", json: "JSON", md: "Markdown",
    py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java",
    c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", cs: "C#",
    php: "PHP", swift: "Swift", kt: "Kotlin", scala: "Scala",
    sh: "Shell", bash: "Shell", zsh: "Shell", ps1: "PowerShell",
    yml: "YAML", yaml: "YAML", toml: "TOML", ini: "INI",
    html: "HTML", css: "CSS", scss: "SCSS", less: "Less",
    xml: "XML", svg: "XML", sql: "SQL", lua: "Lua", vim: "VimL",
    pl: "Perl", r: "R", dart: "Dart", ex: "Elixir", exs: "Elixir",
    erl: "Erlang", elm: "Elm", clj: "Clojure", hs: "Haskell",
    objc: "Objective-C", m: "Objective-C", diff: "Diff", patch: "Diff",
  };
  return map[ext[1]!] ?? null;
}

function pathBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// split into lines but drop the phantom trailing element produced by a file's
// final newline so the line count and rendered rows don't gain a blank tail
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export async function getRepoOverview(owner: string, repo: string): Promise<RepoOverview> {
  const html = await fetchRepoPage(owner, repo);
  const doc = parseRepoPage(html);
  const payload = extractEmbeddedPayload(doc);

  const route = read<{ payload?: unknown }>(payload, "payload");
  const routeData = read<{ codeViewRepoRoute?: unknown }>(route, "codeViewRepoRoute");
  if (!routeData) {
    // a brand-new repo with no commits has no tree route. before treating this
    // as a failure, check whether it's simply empty and show a quick-setup view.
    const empty = await detectEmptyRepo(owner, repo);
    if (empty) return emptyOverview(owner, repo, empty.branch);
    throw new AdapterFailure("getRepoOverview", "missing codeViewRepoRoute in payload");
  }

  const refInfo = read<{ name?: unknown }>(routeData, "refInfo");
  const branch = typeof refInfo?.name === "string" ? refInfo.name : null;
  if (!branch) {
    const empty = await detectEmptyRepo(owner, repo);
    if (empty) return emptyOverview(owner, repo, empty.branch);
    throw new AdapterFailure("getRepoOverview", "missing refInfo.name");
  }

  const tree = readTree(routeData);

  const overview = read<Record<string, unknown>>(routeData, "overview") ?? {};
  const commitCountRaw = (overview as { commitCount?: unknown }).commitCount;
  const commitCount = typeof commitCountRaw === "string" ? commitCountRaw : null;
  const clone = readClone(overview);
  const readme = readReadme(overview);

  return { owner, repo, branch, commitCount, tree, readme, clone };
}

// the commits API returns 409 "Git Repository is empty" for a repo with no
// commits — the unambiguous empty-repo signal. resolve the default branch so
// the quick-setup instructions name the right branch.
async function detectEmptyRepo(owner: string, repo: string): Promise<{ branch: string } | null> {
  try {
    const res = await fetchApi(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
      { credentials: "omit", headers: { Accept: "application/vnd.github+json" } },
    );
    if (res.status !== 409) return null;
    let branch = "main";
    try {
      const repoRes = await fetchApi(`https://api.github.com/repos/${owner}/${repo}`, {
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (repoRes.ok) {
        const data = (await repoRes.json()) as { default_branch?: unknown };
        if (typeof data.default_branch === "string") branch = data.default_branch;
      }
    } catch {
      // keep the "main" default
    }
    return { branch };
  } catch {
    return null;
  }
}

function emptyOverview(owner: string, repo: string, branch: string): RepoOverview {
  return {
    owner,
    repo,
    branch,
    commitCount: null,
    tree: [],
    readme: null,
    clone: {
      https: `https://github.com/${owner}/${repo}.git`,
      ssh: `git@github.com:${owner}/${repo}.git`,
      ghCli: `gh repo clone ${owner}/${repo}`,
      zip: null,
    },
    isEmpty: true,
  };
}

export async function getTreeCommitInfo(
  owner: string,
  repo: string,
  branch: string,
): Promise<Record<string, CommitInfo>> {
  const resp = await fetch(
    `https://github.com/${owner}/${repo}/tree-commit-info/${encodeBranch(branch)}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  if (!resp.ok) {
    throw new AdapterFailure("getTreeCommitInfo", `tree-commit-info responded ${resp.status}`);
  }
  const data = (await resp.json()) as unknown;
  if (!data || typeof data !== "object") {
    throw new AdapterFailure("getTreeCommitInfo", "unexpected payload shape");
  }
  // current shape: { entries: { "<path>": { oid, url, date, shortMessageHtmlLink: { value } } } }
  // older shape was a flat map keyed by path with shortMessageHtmlLink as a string.
  const root = data as Record<string, unknown>;
  const entries = (root["entries"] && typeof root["entries"] === "object")
    ? (root["entries"] as Record<string, unknown>)
    : root;
  const out: Record<string, CommitInfo> = {};
  for (const [key, raw] of Object.entries(entries)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const link = e["shortMessageHtmlLink"];
    const linkHtml = typeof link === "string"
      ? link
      : (link && typeof link === "object" && typeof (link as Record<string, unknown>)["value"] === "string")
        ? ((link as Record<string, unknown>)["value"] as string)
        : "";
    out[key] = {
      oid: typeof e["oid"] === "string" ? (e["oid"] as string) : "",
      url: typeof e["url"] === "string" ? (e["url"] as string) : "",
      date: typeof e["date"] === "string" ? (e["date"] as string) : "",
      shortMessageHtmlLink: linkHtml,
    };
  }
  return out;
}

function encodeBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function readTree(routeData: unknown): TreeItem[] {
  const tree = read<{ items?: unknown }>(routeData, "tree");
  if (!tree || !Array.isArray(tree.items)) return [];
  const items: TreeItem[] = [];
  for (const raw of tree.items) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const name = obj["name"];
    const path = obj["path"];
    const contentType = obj["contentType"];
    if (typeof name !== "string" || typeof path !== "string" || typeof contentType !== "string") continue;
    items.push({
      name,
      path,
      isDirectory: contentType === "directory",
    });
  }
  return items;
}

function readClone(overview: Record<string, unknown>): CloneUrls {
  const codeButton = (overview["codeButton"] ?? {}) as Record<string, unknown>;
  const local = (codeButton["local"] ?? {}) as Record<string, unknown>;
  const proto = (local["protocolInfo"] ?? {}) as Record<string, unknown>;
  const platform = (local["platformInfo"] ?? {}) as Record<string, unknown>;
  return {
    https: typeof proto["httpUrl"] === "string" ? (proto["httpUrl"] as string) : null,
    ssh: typeof proto["sshUrl"] === "string" ? (proto["sshUrl"] as string) : null,
    ghCli: typeof proto["ghCliUrl"] === "string" ? (proto["ghCliUrl"] as string) : null,
    zip: typeof platform["zipballUrl"] === "string" ? (platform["zipballUrl"] as string) : null,
  };
}

function readReadme(overview: Record<string, unknown>): ReadmeFile | null {
  const files = overview["overviewFiles"];
  if (!Array.isArray(files)) return null;
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const obj = f as Record<string, unknown>;
    if (obj["preferredFileType"] !== "readme") continue;
    const path = obj["path"];
    const html = obj["richText"];
    if (typeof path !== "string" || typeof html !== "string") continue;
    return { path, html };
  }
  return null;
}

function read<T>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key] as T | undefined;
}
