import { AdapterFailure } from "./index";

const TTL_MS = 30_000;
const MAX_ENTRIES = 50;
const cache = new Map<string, { html: Promise<string>; expires: number }>();
let firstLoad: { url: string; html: string; expires: number } | null = null;

function normalizedUrl(url: string): string {
  const u = new URL(url, "https://github.com");
  u.hash = "";
  u.searchParams.sort();
  return u.href.toLowerCase();
}

// the hard-loaded document already is the html the first adapter would fetch for this url
export function keepFirstLoad(): void {
  firstLoad = { url: normalizedUrl(location.href), html: document.documentElement.outerHTML, expires: Date.now() + TTL_MS };
}

export function takeFirstLoad(url: string): string | null {
  if (!firstLoad || firstLoad.expires <= Date.now() || firstLoad.url !== normalizedUrl(url)) return null;
  const { html } = firstLoad;
  firstLoad = null;
  return html;
}

// concurrent callers share one request; a failed request is not kept
export function fetchRepoPage(owner: string, repo: string): Promise<string> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.html;
  for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);

  const html = loadRepoPage(owner, repo);
  cache.set(key, { html, expires: now + TTL_MS });
  html.catch(() => cache.get(key)?.html === html && cache.delete(key));
  return html;
}

export function forgetRepoPage(owner: string, repo: string): void {
  cache.delete(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
}

async function loadRepoPage(owner: string, repo: string): Promise<string> {
  const url = `https://github.com/${owner}/${repo}`;
  const kept = takeFirstLoad(url);
  if (kept) return kept;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("fetchRepoPage", `${owner}/${repo} responded ${resp.status}`);
  }
  return resp.text();
}

export function parseRepoPage(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function extractEmbeddedPayload(doc: Document): unknown {
  const script = doc.querySelector<HTMLScriptElement>(
    'script[type="application/json"][data-target="react-app.embeddedData"]',
  );
  if (!script || !script.textContent) {
    throw new AdapterFailure("extractEmbeddedPayload", "react-app.embeddedData script not found");
  }
  try {
    return JSON.parse(script.textContent) as unknown;
  } catch (err) {
    throw new AdapterFailure("extractEmbeddedPayload", "invalid JSON in embeddedData", { cause: err });
  }
}
