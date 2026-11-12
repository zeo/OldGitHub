import assert from "node:assert/strict";
import test from "node:test";
import { fetchRepoPage, keepFirstLoad, takeFirstLoad } from "../src/adapters/_page.ts";

const load = (href, html) => {
  globalThis.location = new URL(href);
  globalThis.document = { documentElement: { outerHTML: html } };
  keepFirstLoad();
};

test("hands the hard-loaded html to the first matching request only", () => {
  load("https://github.com/Octocat?tab=repositories&from=2025-12-01#top", "<html>profile</html>");
  assert.equal(takeFirstLoad("https://github.com/octocat?from=2025-12-01&tab=repositories"), "<html>profile</html>");
  assert.equal(takeFirstLoad("https://github.com/octocat?from=2025-12-01&tab=repositories"), null);
});

test("ignores requests for a different url", () => {
  load("https://github.com/octocat/hello", "<html>repo</html>");
  assert.equal(takeFirstLoad("https://github.com/octocat/hello/issues"), null);
  assert.equal(takeFirstLoad("https://github.com/octocat/hello"), "<html>repo</html>");
});

test("fetchRepoPage reuses the hard-loaded repo home without a request", async () => {
  load("https://github.com/octocat/spoon-knife", "<html>home</html>");
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response("<html>fetched</html>"); };
  assert.equal(await fetchRepoPage("octocat", "Spoon-Knife"), "<html>home</html>");
  assert.equal(requests, 0);
});
