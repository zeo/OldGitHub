import assert from "node:assert/strict";
import test from "node:test";
import { escapeAttr, escapeText, isSafeUrl, safeHref } from "../src/util/html.ts";

test("escapeText neutralizes markup", () => {
  assert.equal(escapeText(`<img src=x onerror="a&b">`), "&lt;img src=x onerror=\"a&amp;b\"&gt;");
});

test("escapeAttr covers both quote styles", () => {
  assert.equal(escapeAttr(`"x' <y> &`), "&quot;x&#39; &lt;y&gt; &amp;");
});

test("only http, https, mailto and relative urls are safe", () => {
  for (const url of ["https://example.com", "http://a.b/c", "mailto:a@b.c", "/owner/repo", "repo/blob/main/a.md", "#readme", "?q=1", "//cdn.example/x"]) {
    assert.equal(isSafeUrl(url), true, url);
  }
  for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:x", "\u0001javascript:x", "data:text/html,<b>", "vbscript:x"]) {
    assert.equal(isSafeUrl(url), false, JSON.stringify(url));
  }
});

test("safeHref swaps unsafe urls for an inert anchor", () => {
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("https://example.com/a?b=c"), "https://example.com/a?b=c");
});
