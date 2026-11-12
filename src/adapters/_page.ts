import { AdapterFailure } from "./index";

const TTL_MS = 30_000;
const MAX_ENTRIES = 50;
const cache = new Map<string, { html: Promise<string>; expires: number }>();

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

async function loadRepoPage(owner: string, repo: string): Promise<string> {
  const resp = await fetch(`https://github.com/${owner}/${repo}`, {
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
