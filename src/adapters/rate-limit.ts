export type RateResource = "core" | "search";

const blockedUntil: Record<RateResource, number> = { core: 0, search: 0 };
const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 100;
const responseCache = new Map<string, { response: Response; expires: number }>();
const inflight = new Map<string, Promise<Response>>();
const API_ORIGIN = "https://api.github.com/";
let savedToken: Promise<string> | null = null;

function resourceFor(url: string): RateResource {
  return url.startsWith(`${API_ORIGIN}search/`) ? "search" : "core";
}

function hasStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

function readToken(): Promise<string> {
  if (!hasStorage()) return Promise.resolve("");
  savedToken ??= chrome.storage.local.get(["apiToken", "apiTokenInvalid"]).then(
    (s) => (typeof s.apiToken === "string" && !s.apiTokenInvalid ? s.apiToken : ""),
    () => "",
  );
  return savedToken;
}

if (hasStorage()) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("apiToken" in changes || "apiTokenInvalid" in changes)) return;
    savedToken = null;
    responseCache.clear();
    clearRateLimit();
  });
}

const quotaListeners = new Set<(resetAt: number) => void>();

export function onAnonymousQuotaUsed(listener: (resetAt: number) => void): void {
  quotaListeners.add(listener);
}

export function noteApiRateLimited(until = Date.now() + RATE_LIMIT_PAUSE_MS, resource: RateResource = "core"): void {
  blockedUntil[resource] = Math.max(blockedUntil[resource], until);
}

export function isApiRateLimited(resource: RateResource = "core"): boolean {
  return Date.now() < blockedUntil[resource];
}

export function clearRateLimit(): void {
  blockedUntil.core = 0;
  blockedUntil.search = 0;
}

export function clearApiCache(): void {
  responseCache.clear();
}

export async function fetchApi(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const bypassCache = method !== "GET" || init?.cache === "no-store" || init?.cache === "no-cache" || init?.cache === "reload";
  const key = bypassCache ? null : cacheKey(url, init);
  const cached = key ? responseCache.get(key) : undefined;
  if (cached && cached.expires > Date.now()) return cached.response.clone();
  if (cached && key) responseCache.delete(key);

  const pending = key ? inflight.get(key) : undefined;
  if (pending) return (await pending).clone();
  const resource = resourceFor(url);
  if (isApiRateLimited(resource)) {
    const retryAfter = Math.max(1, Math.ceil((blockedUntil[resource] - Date.now()) / 1000));
    return new Response(null, {
      status: 429,
      statusText: "GitHub API rate limit",
      headers: { "retry-after": String(retryAfter), "x-ratelimit-remaining": "0" },
    });
  }

  const request = send(url, init).then((response) => {
    trackRateLimit(response, resource);
    if (key && response.status === 200) {
      responseCache.set(key, { response: response.clone(), expires: Date.now() + CACHE_TTL_MS });
      trimCache();
    }
    return response;
  });
  if (key) {
    inflight.set(key, request);
    void request.then(() => inflight.delete(key), () => inflight.delete(key));
  }
  return (await request).clone();
}

async function send(url: string, init: RequestInit | undefined): Promise<Response> {
  const token = url.startsWith(API_ORIGIN) ? await readToken() : "";
  if (!token) return fetch(url, init);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status !== 401) return response;
  // a revoked or expired token must not break browsing; options shows the notice
  await chrome.storage.local.set({ apiTokenInvalid: true });
  savedToken = Promise.resolve("");
  return fetch(url, init);
}

function cacheKey(url: string, init: RequestInit | undefined): string {
  const headers = new Headers(init?.headers);
  return `${url}\n${headers.get("accept") ?? ""}\n${headers.get("x-github-api-version") ?? ""}`;
}

function trackRateLimit(response: Response, fallbackResource: RateResource): void {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status !== 429 && remaining !== "0") return;
  const headerResource = response.headers.get("x-ratelimit-resource");
  const resource: RateResource = headerResource === "search" || fallbackResource === "search" ? "search" : "core";
  noteApiRateLimited(rateLimitEnd(response), resource);
  // only the anonymous core quota is worth a token prompt; search has its own per-minute limit
  if (resource !== "core" || response.headers.get("x-ratelimit-limit") !== "60") return;
  const resetAt = blockedUntil.core;
  void readToken().then((token) => {
    if (!token) for (const listener of quotaListeners) listener(resetAt);
  });
}

function rateLimitEnd(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return retryAt + 1000;
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 + 1000 : undefined;
}

function trimCache(): void {
  const now = Date.now();
  for (const [k, entry] of responseCache) {
    if (entry.expires <= now) responseCache.delete(k);
  }
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) return;
    responseCache.delete(oldest);
  }
}
