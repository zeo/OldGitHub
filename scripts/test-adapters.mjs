import assert from "node:assert/strict";
import test from "node:test";
import { withDom } from "./dom-helper.mjs";
import { clearFirstLoad, clearPageCache, extractEmbeddedPayload, fetchPageDoc } from "../src/adapters/_page.ts";
import { forgetRepoSummary, getRepoSummary } from "../src/adapters/repo.ts";
import { getFileList } from "../src/adapters/repo-files.ts";
import { getIssueList } from "../src/adapters/repo-issues.ts";

test("fetchPageDoc enforces origin, shares network fetches, and isolates DOM mutations", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; clearPageCache(); clearFirstLoad(); });

  clearFirstLoad();
  clearPageCache();
  await assert.rejects(fetchPageDoc("https://evil.example/x"), /cross-origin/);

  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(`<html><body><main><p id="keep">hi</p><header class="AppHeader">chrome</header></main></body></html>`);
  };

  const doc1 = await fetchPageDoc("/octocat/hello");
  doc1.querySelector("header.AppHeader")?.remove();
  const doc2 = await fetchPageDoc("https://github.com/octocat/hello");

  assert.equal(calls, 1);
  assert.ok(doc2.querySelector("header.AppHeader"));
  assert.equal(doc2.querySelector("#keep")?.textContent, "hi");
});

test("extractEmbeddedPayload throws clear failure when missing or malformed", (t) => {
  t.after(withDom());
  const emptyDoc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
  assert.throws(() => extractEmbeddedPayload(emptyDoc), /not found/);

  const badDoc = new DOMParser().parseFromString(
    `<script type="application/json" data-target="react-app.embeddedData">{bad</script>`,
    "text/html",
  );
  assert.throws(() => extractEmbeddedPayload(badDoc), /invalid JSON/);
});

test("getRepoSummary detects hasSettings and forgetRepoSummary clears cache", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; clearPageCache(); forgetRepoSummary("octocat", "app"); });

  clearPageCache();
  forgetRepoSummary("octocat", "app");
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    const settingsLink = fetches === 1 ? `<a href="/octocat/app/settings">Settings</a>` : "";
    const stars = fetches === 1 ? 10 : 11;
    const embedded = JSON.stringify({
      payload: { codeViewRepoRoute: { overview: { sidebarAboutData: { stargazerCount: stars, forksCount: 2, watcherCount: 1 } } } },
    });
    return new Response(`<html><body>${settingsLink}<script type="application/json" data-target="react-app.embeddedData">${embedded}</script></body></html>`);
  };

  const first = await getRepoSummary("octocat", "app");
  assert.equal(first.hasSettings, true);
  assert.equal(first.stars, 10);

  const cached = await getRepoSummary("octocat", "app");
  assert.equal(cached.stars, 10);
  assert.equal(fetches, 1);

  forgetRepoSummary("octocat", "app");
  clearPageCache();
  const refreshed = await getRepoSummary("octocat", "app");
  assert.equal(refreshed.hasSettings, false);
  assert.equal(refreshed.stars, 11);
});

test("getFileList reads refInfo from embeddedData", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; });

  const embedded = JSON.stringify({ payload: { codeViewRepoRoute: { refInfo: { name: "feat/x", currentOid: "abc123def" } } } });
  globalThis.fetch = async (url) => {
    if (String(url).includes("/tree-list/")) {
      return new Response(JSON.stringify({ paths: ["README.md", "src/a.ts"] }), { status: 200 });
    }
    return new Response(`<html><body><script type="application/json" data-target="react-app.embeddedData">${embedded}</script></body></html>`);
  };

  const result = await getFileList("octocat", "embed-test", "/octocat/embed-test/tree/feat/x");
  assert.equal(result.ref, "feat/x");
  assert.deepEqual(result.paths, ["README.md", "src/a.ts"]);
});

test("getIssueList loads open and closed issue counts in parallel and honors ?state=closed", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; clearPageCache(); });

  clearPageCache();
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const isClosedReq = String(url).includes("is%3Aclosed");
    const embedded = JSON.stringify({
      payload: {
        issuesIndexContentRoute: {
          pageInfo: { totalCount: isClosedReq ? 7 : 3, currentPage: 1, totalPages: 1 },
          results: [{ issue: { number: isClosedReq ? 99 : 1, title: "Bug", state: isClosedReq ? "CLOSED" : "OPEN", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", commentCount: 0, labels: [] } }],
        },
      },
    });
    return new Response(`<html><body><script type="application/json" data-target="react-app.embeddedData">${embedded}</script></body></html>`);
  };

  const list = await getIssueList("octocat", "Hello-World", "state=closed", "issues");
  assert.equal(requested.length, 2);
  assert.equal(list.closedCount, 7);
  assert.equal(list.openCount, 3);
  assert.equal(list.rows[0]?.number, 99);
});
