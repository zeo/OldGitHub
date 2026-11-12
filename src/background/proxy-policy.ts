export const MAX_PROXY_BYTES = 5 * 1024 * 1024;

export function allowedProxyUrl(url: string, credentials: "include" | "omit"): string | null {
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
  if (parsed.hostname === "github.com" && /^\/[^/]+\/[^/]+\/raw\/refs\/heads\//.test(parsed.pathname)) {
    return parsed.toString();
  }
  return null;
}

// github.com raw urls redirect to raw.githubusercontent.com; anything else after a redirect is refused
export function allowedRedirectTarget(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && (parsed.hostname === "raw.githubusercontent.com" || parsed.hostname === "github.com");
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
