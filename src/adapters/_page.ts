import { AdapterFailure } from "./index";

const TTL_MS = 30_000;
const cache = new Map<string, { html: string; expires: number }>();

export async function fetchRepoPage(owner: string, repo: string): Promise<string> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.html;

  const resp = await fetch(`https://github.com/${owner}/${repo}`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("fetchRepoPage", `${owner}/${repo} responded ${resp.status}`);
  }
  const html = await resp.text();
  cache.set(key, { html, expires: now + TTL_MS });
  return html;
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
