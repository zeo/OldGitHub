import assert from "node:assert/strict";
import test from "node:test";
import { withDom } from "./dom-helper.mjs";
import {
  askDataConfirm,
  cleanScrapedPage,
  encodePathSegments,
  escapeAttr,
  escapeRegExp,
  escapeText,
  isSafeUrl,
  labelTextColor,
  relativizeGithubUrl,
  safeCssColor,
  safeDecodeURIComponent,
  safeHexColor,
  safeHref,
  sanitizeHtml,
  sanitizeTree,
} from "../src/util/html.ts";

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

test("safeHexColor, safeCssColor, and labelTextColor validate colors strictly", () => {
  assert.equal(safeHexColor("abc"), "#aabbcc");
  assert.equal(safeHexColor("#1f2e3d"), "#1f2e3d");
  assert.equal(safeHexColor("red; background:url(x)"), null);

  assert.equal(safeCssColor("#09f"), "#09f");
  assert.equal(safeCssColor("rgb(10, 20, 30)"), "rgb(10, 20, 30)");
  assert.equal(safeCssColor("var(--color-accent)"), "var(--color-accent)");
  assert.equal(safeCssColor("red;position:fixed"), null);

  assert.equal(labelTextColor("ffffff"), "#333");
  assert.equal(labelTextColor("#000000"), "#fff");
  assert.equal(labelTextColor("invalid"), "#fff");
});

test("relativizeGithubUrl strips origin without enabling protocol-relative redirects", () => {
  assert.equal(relativizeGithubUrl("https://github.com/octocat/repo?tab=1#top"), "/octocat/repo?tab=1#top");
  assert.equal(relativizeGithubUrl("https://github.com//evil.example"), "#");
  assert.equal(relativizeGithubUrl("https://example.com/foo"), "https://example.com/foo");
});

test("path and regexp utilities handle special inputs safely", () => {
  assert.equal(escapeRegExp("a.b+c?"), "a\\.b\\+c\\?");
  assert.equal(encodePathSegments("feat/a b/c"), "feat/a%20b/c");
  assert.equal(safeDecodeURIComponent("%E0%A4%A"), "%E0%A4%A");
  assert.equal(safeDecodeURIComponent("hello%20world"), "hello world");
});

test("sanitizeHtml enforces strict GFM allowlist and blocks spoofing vectors", (t) => {
  t.after(withDom());

  const out = sanitizeHtml([
    `<p data-oldgh-open-options onclick="alert(1)">hi</p>`,
    `<script>alert(1)</script>`,
    `<svg><use href="#x"></use></svg>`,
    `<style>body{display:none}</style>`,
    `<form action="/steal"><input type="text"></form>`,
    `<input type="text"><input type="checkbox" disabled checked>`,
    `<a href="https://github.com/octocat/repo" data-oldgh-show-native>ok</a>`,
    `<a href="https://github.com//evil.example">double</a>`,
    `<img src="data:image/svg+xml,<svg></svg>">`,
    `<img src="data:image/png;base64,AAAA" srcset="https://example.com/1.png 1x, javascript:alert(1) 2x">`,
  ].join(""));

  const wrap = document.createElement("div");
  wrap.innerHTML = out;
  assert.equal(wrap.querySelector("script, svg, style, form"), null);
  assert.equal(wrap.querySelectorAll("input").length, 1);
  assert.equal(wrap.querySelector("[data-oldgh-open-options], [data-oldgh-show-native]"), null);
  assert.equal(wrap.querySelector("p")?.getAttribute("onclick"), null);

  const links = wrap.querySelectorAll("a");
  assert.equal(links[0]?.getAttribute("href"), "/octocat/repo");
  assert.equal(links[1]?.getAttribute("href"), "#");

  const imgs = wrap.querySelectorAll("img");
  assert.equal(imgs[0]?.hasAttribute("src"), false);
  assert.equal(imgs[1]?.getAttribute("src"), "data:image/png;base64,AAAA");
  assert.equal(imgs[1]?.hasAttribute("srcset"), false);
});

test("sanitizeTree allows safe forms while dropping cross-origin actions and dangerous attributes", (t) => {
  t.after(withDom());

  const root = document.createElement("div");
  root.innerHTML = `
    <form action="/settings/profile" method="post">
      <button formaction="https://evil.example/phish" onclick="x()">Bad</button>
      <button formaction="https://github.com/settings/save">Good</button>
    </form>
    <div style="color:red" ping="https://tracker.example" data-oldgh-open-options>ok</div>
    <div style="background:url(https://evil.example/track)">css</div>
    <svg><use href="#bad"></use><path d="M0 0"></path></svg>
    <tool-tip data-date="2026-01-01" data-level="2">2 contributions</tool-tip>
  `;
  sanitizeTree(root);

  assert.equal(root.querySelector("form")?.getAttribute("action"), "/settings/profile");
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[0]?.hasAttribute("formaction"), false);
  assert.equal(buttons[0]?.hasAttribute("onclick"), false);
  assert.equal(buttons[1]?.getAttribute("formaction"), "https://github.com/settings/save");

  const divs = root.querySelectorAll("div");
  assert.equal(divs[0]?.getAttribute("style"), "color:red");
  assert.equal(divs[0]?.hasAttribute("ping"), false);
  assert.equal(divs[0]?.hasAttribute("data-oldgh-open-options"), false);
  assert.equal(divs[1]?.hasAttribute("style"), false);
  assert.equal(root.querySelector("use"), null);
  assert.ok(root.querySelector("path"));
  assert.equal(root.querySelector("tool-tip")?.getAttribute("data-date"), "2026-01-01");
});

test("cleanScrapedPage removes GitHub chrome and React hydration errors", (t) => {
  t.after(withDom());

  const root = document.createElement("div");
  root.innerHTML = `
    <header class="AppHeader">nav</header>
    <div>Uh oh! There was an error while loading.</div>
    <main><p>Kept</p></main>
    <footer>foot</footer>
  `;
  cleanScrapedPage(root);

  assert.equal(root.querySelector("header, footer"), null);
  assert.equal(root.textContent?.includes("Uh oh!"), false);
  assert.equal(root.querySelector("main p")?.textContent, "Kept");
});

test("askDataConfirm aborts click propagation when confirm is declined", (t) => {
  t.after(withDom());

  const root = document.createElement("div");
  root.innerHTML = `<button type="button" data-confirm="Delete?">Delete</button>`;
  document.body.appendChild(root);

  let downstreamCalls = 0;
  askDataConfirm(root);
  root.addEventListener("click", () => { downstreamCalls++; });

  const btn = root.querySelector("button");
  assert.ok(btn);

  window.confirm = () => false;
  btn.click();
  assert.equal(downstreamCalls, 0);

  window.confirm = () => true;
  btn.click();
  assert.equal(downstreamCalls, 1);
});
