export const MAX_PROXY_BYTES = 5 * 1024 * 1024;

function isGithubRawPath(pathname: string): boolean {
  return /^\/[^/]+\/[^/]+\/raw\/.+/.test(pathname);
}

// check dot segments before URL parsing normalizes them away
function hasDotSegment(rawUrl: string): boolean {
  const schemeEnd = rawUrl.indexOf("://");
  const pathStart = schemeEnd === -1 ? -1 : rawUrl.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) return false;
  const rawPath = rawUrl.slice(pathStart).split(/[?#]/, 1)[0] ?? "";
  return /(?:^|\/|%2f)(?:\.|%2e){1,2}(?=$|\/|%2f)/i.test(rawPath);
}

export function allowedProxyUrl(url: string, credentials: "include" | "omit"): string | null {
  if (hasDotSegment(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;

  if (parsed.hostname === "raw.githubusercontent.com") {
    return credentials === "omit" ? parsed.toString() : null;
  }
  if (parsed.hostname === "github.com" && isGithubRawPath(parsed.pathname)) {
    return parsed.toString();
  }
  return null;
}

// github.com raw urls redirect to raw.githubusercontent.com; anything else after a redirect is refused
export function allowedRedirectTarget(url: string): boolean {
  if (hasDotSegment(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  if (parsed.hostname === "raw.githubusercontent.com") return true;
  return parsed.hostname === "github.com" && isGithubRawPath(parsed.pathname);
}

export async function readProxyText(response: Response): Promise<string> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PROXY_BYTES) {
    throw new RangeError("raw file exceeds 5 MiB");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PROXY_BYTES) {
      await reader.cancel();
      throw new RangeError("raw file exceeds 5 MiB");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
