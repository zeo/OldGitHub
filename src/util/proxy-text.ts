export const MAX_PROXY_BYTES = 5 * 1024 * 1024;

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
