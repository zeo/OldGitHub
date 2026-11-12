import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/adapters/rate-limit.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const store = {};
const listeners = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
      set: async (patch) => {
        Object.assign(store, patch);
        for (const l of listeners) l(Object.fromEntries(Object.keys(patch).map((k) => [k, { newValue: patch[k] }])), "local");
      },
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  },
};
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("deduplicates concurrent requests and caches successful responses", async () => {
  api.clearApiCache();
  api.clearRateLimit();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ call: calls }), { headers: { "content-type": "application/json" } });
  };

  const [first, second] = await Promise.all([
    api.fetchApi("https://api.github.com/repos/octocat/Hello-World"),
    api.fetchApi("https://api.github.com/repos/octocat/Hello-World"),
  ]);
  const third = await api.fetchApi("https://api.github.com/repos/octocat/Hello-World");

  assert.equal(calls, 1);
  assert.deepEqual(await first.json(), { call: 1 });
  assert.deepEqual(await second.json(), { call: 1 });
  assert.deepEqual(await third.json(), { call: 1 });
});

test("blocks locally until GitHub's reset time", async () => {
  api.clearApiCache();
  api.clearRateLimit();
  let calls = 0;
  const reset = Math.ceil(Date.now() / 1000) + 60;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    });
  };

  assert.equal((await api.fetchApi("https://api.github.com/rate_limit")).status, 403);
  const blocked = await api.fetchApi("https://api.github.com/users/octocat");
  assert.equal(blocked.status, 429);
  assert.equal(calls, 1);
  assert.equal(api.isApiRateLimited(), true);
});

test("serves cached data after the final allowed request", async () => {
  api.clearApiCache();
  api.clearRateLimit();
  let calls = 0;
  const reset = Math.ceil(Date.now() / 1000) + 60;
  globalThis.fetch = async () => {
    calls++;
    return new Response("cached", {
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    });
  };

  assert.equal(await (await api.fetchApi("https://api.github.com/users/octocat")).text(), "cached");
  assert.equal(await (await api.fetchApi("https://api.github.com/users/octocat")).text(), "cached");
  assert.equal((await api.fetchApi("https://api.github.com/users/hubot")).status, 429);
  assert.equal(calls, 1);
});

test("does not cache 202 accepted responses", async () => {
  api.clearApiCache();
  api.clearRateLimit();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(calls === 1 ? null : "[]", { status: calls === 1 ? 202 : 200 });
  };

  assert.equal((await api.fetchApi("https://api.github.com/repos/o/r/stats/contributors")).status, 202);
  assert.equal((await api.fetchApi("https://api.github.com/repos/o/r/stats/contributors")).status, 200);
  assert.equal(calls, 2);
});

test("sends the saved token only to api.github.com and drops it after a 401", async () => {
  api.clearRateLimit();
  await chrome.storage.local.set({ apiToken: "tok", apiTokenInvalid: false });
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization");
    seen.push([url, auth]);
    return new Response("{}", { status: auth && url.includes("revoked") ? 401 : 200 });
  };

  await api.fetchApi("https://api.github.com/users/octocat");
  await api.fetchApi("https://github.com/octocat");
  assert.deepEqual(seen, [["https://api.github.com/users/octocat", "Bearer tok"], ["https://github.com/octocat", null]]);

  seen.length = 0;
  assert.equal((await api.fetchApi("https://api.github.com/revoked")).status, 200);
  assert.deepEqual(seen, [["https://api.github.com/revoked", "Bearer tok"], ["https://api.github.com/revoked", null]]);
  assert.equal(store.apiTokenInvalid, true);

  seen.length = 0;
  await api.fetchApi("https://api.github.com/users/hubot");
  assert.deepEqual(seen, [["https://api.github.com/users/hubot", null]]);
});
