import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/background/proxy-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const policy = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("allows only raw GitHub file requests", () => {
  assert.equal(
    policy.allowedProxyUrl("https://raw.githubusercontent.com/octocat/Hello-World/main/README.md", "omit"),
    "https://raw.githubusercontent.com/octocat/Hello-World/main/README.md",
  );
  assert.equal(
    policy.allowedProxyUrl("https://github.com/octocat/Hello-World/raw/refs/heads/main/README.md", "include"),
    "https://github.com/octocat/Hello-World/raw/refs/heads/main/README.md",
  );

  for (const [url, credentials] of [
    ["https://api.github.com/user", "include"],
    ["https://github.com/settings/profile", "include"],
    ["https://raw.githubusercontent.com/octocat/Hello-World/main/README.md", "include"],
    ["http://raw.githubusercontent.com/octocat/Hello-World/main/README.md", "omit"],
    ["not a url", "omit"],
  ]) {
    assert.equal(policy.allowedProxyUrl(url, credentials), null, url);
  }
});

test("follows redirects only to github raw hosts", () => {
  assert.equal(policy.allowedRedirectTarget("https://raw.githubusercontent.com/o/r/main/a.txt?token=x"), true);
  assert.equal(policy.allowedRedirectTarget("https://github.com/o/r/raw/refs/heads/main/a.txt"), true);
  for (const url of ["https://evil.example/a.txt", "http://raw.githubusercontent.com/a", "https://raw.githubusercontent.com.evil.example/a", "nope"]) {
    assert.equal(policy.allowedRedirectTarget(url), false, url);
  }
});

test("reads streamed UTF-8 within the size limit", async () => {
  const bytes = new TextEncoder().encode("one π two");
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 5));
      controller.enqueue(bytes.slice(5));
      controller.close();
    },
  }));
  assert.equal(await policy.readProxyText(response), "one π two");
});

test("rejects declared and streamed oversized responses", async () => {
  const declared = new Response("", { headers: { "content-length": String(policy.MAX_PROXY_BYTES + 1) } });
  await assert.rejects(policy.readProxyText(declared), /exceeds 5 MiB/);

  const streamed = new Response(new Uint8Array(policy.MAX_PROXY_BYTES + 1));
  await assert.rejects(policy.readProxyText(streamed), /exceeds 5 MiB/);
});
