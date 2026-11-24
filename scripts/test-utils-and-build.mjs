import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { withDom } from "./dom-helper.mjs";
import { splitOnNewlinesPreservingSpans } from "../src/highlight/index.ts";
import { copyToClipboard } from "../src/util/clipboard.ts";
import { OCTICON_SVGS } from "../src/icons/generated.ts";
import { buildManifest } from "../src/manifest.config.ts";

test("splitOnNewlinesPreservingSpans closes and reopens nested highlight spans per line", () => {
  const html = `<span class="hljs-string"><span class="hljs-subst">line 1\nline 2</span>\nline 3</span>`;
  assert.deepEqual(splitOnNewlinesPreservingSpans(html), [
    `<span class="hljs-string"><span class="hljs-subst">line 1</span></span>`,
    `<span class="hljs-string"><span class="hljs-subst">line 2</span></span>`,
    `<span class="hljs-string">line 3</span>`,
  ]);
  assert.deepEqual(splitOnNewlinesPreservingSpans("plain"), ["plain"]);
});

test("copyToClipboard updates button feedback on success and triggers fallback on error", async (t) => {
  t.after(withDom());

  const prevClip = navigator.clipboard;
  t.after(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: prevClip }));

  const btn = document.createElement("button");
  btn.innerHTML = "<span>Copy</span>";

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => undefined },
  });
  assert.equal(await copyToClipboard("git clone https://github.com/o/r.git", btn), true);
  assert.equal(btn.classList.contains("is-copied"), true);
  assert.ok(btn.querySelector("svg.octicon-check"));

  let fallbackCalled = false;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => { throw new Error("denied"); } },
  });
  assert.equal(await copyToClipboard("secret", btn, () => { fallbackCalled = true; }), false);
  assert.equal(fallbackCalled, true);
});

test("every static octicon name in src/ is present in generated icons", () => {
  const missing = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/\bocticon\(\s*"([a-z0-9-]+)"/g)) {
          if (!(m[1] in OCTICON_SVGS)) missing.push(`${full}:${m[1]}`);
        }
      }
    }
  };
  walk(path.resolve("src"));
  assert.deepEqual(missing, []);
});

test("manifest config and built dist artifacts are coherent", () => {
  const manifest = buildManifest("production");
  assert.ok(manifest.web_accessible_resources?.[0]?.resources.includes("styles/2013.css"));

  const distManifestPath = path.resolve("dist/manifest.json");
  if (!fs.existsSync(distManifestPath)) return;
  const built = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));
  assert.equal(built.manifest_version, 3);
  assert.ok(fs.existsSync(path.resolve("dist", built.background.service_worker)));
  for (const js of built.content_scripts[0].js) {
    assert.ok(fs.existsSync(path.resolve("dist", js)), `missing content script ${js}`);
  }
  const cssPath = path.resolve("dist/styles/2013.css");
  assert.ok(fs.existsSync(cssPath));
  assert.ok(fs.statSync(cssPath).size > 50_000);
});
