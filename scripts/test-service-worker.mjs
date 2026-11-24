import assert from "node:assert/strict";
import test from "node:test";

const localStore = { enabled: true };
const sessionStore = {};
let sessionRules = [];
const dnrCalls = [];
const messageListeners = [];

const prevChrome = globalThis.chrome;
globalThis.chrome = {
  runtime: {
    id: "oldgh-test-id",
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    openOptionsPage: async () => undefined,
  },
  storage: {
    local: {
      get: async (k) => (typeof k === "string" ? (k in localStore ? { [k]: localStore[k] } : {}) : { ...localStore }),
      set: async (patch) => Object.assign(localStore, patch),
    },
    session: {
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in sessionStore).map((k) => [k, sessionStore[k]])),
      set: async (patch) => Object.assign(sessionStore, patch),
    },
  },
  action: {
    setBadgeText: async () => undefined,
    setBadgeBackgroundColor: async () => undefined,
    setTitle: async () => undefined,
    onClicked: { addListener() {} },
  },
  declarativeNetRequest: {
    getSessionRules: async () => sessionRules,
    updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
      dnrCalls.push({ removeRuleIds, addRules });
      const removeSet = new Set(removeRuleIds);
      sessionRules = [...sessionRules.filter((r) => !removeSet.has(r.id)), ...addRules];
    },
  },
  tabs: {
    onUpdated: { addListener() {} },
    onRemoved: { addListener() {} },
    onReplaced: { addListener() {} },
    query: async () => [],
    sendMessage: async () => undefined,
    reload: async () => undefined,
  },
};

await import("../src/background/service-worker.ts");
// let wakeup queue settle before assertions
await new Promise((r) => setTimeout(r, 20));

test.after(() => {
  if (prevChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = prevChrome;
});

function sendMessage(msg, sender) {
  return new Promise((resolve) => {
    let asyncHandled = false;
    for (const listener of messageListeners) {
      const ret = listener(msg, sender, (resp) => {
        asyncHandled = true;
        resolve(resp);
      });
      if (ret === true) asyncHandled = true;
    }
    if (!asyncHandled) resolve(undefined);
  });
}

test("skips rewriting DNR rules on wakeup when existing rules already match", () => {
  assert.equal(dnrCalls.length, 0);
});

test("rejects messages from untrusted extension ids or non-GitHub origins", async () => {
  const fromForeignExt = await sendMessage(
    { type: "oldgh:route-change", pathname: "/octocat/repo", search: "" },
    { id: "evil-ext", origin: "https://github.com", tab: { id: 1 } },
  );
  assert.equal(fromForeignExt, undefined);

  const fromEvilOrigin = await sendMessage(
    { type: "oldgh:route-change", pathname: "/octocat/repo", search: "" },
    { id: "oldgh-test-id", origin: "https://evil.example", tab: { id: 1 } },
  );
  assert.equal(fromEvilOrigin, undefined);

  const gistRouteChange = await sendMessage(
    { type: "oldgh:route-change", pathname: "/octocat/repo", search: "" },
    { id: "oldgh-test-id", origin: "https://gist.github.com", tab: { id: 1 } },
  );
  assert.equal(gistRouteChange, undefined);
});

test("route-change updates DNR rules cleanly and skips redundant no-op updates", async () => {
  const before = dnrCalls.length;
  const sender = { id: "oldgh-test-id", origin: "https://github.com", tab: { id: 42 } };
  await sendMessage({ type: "oldgh:route-change", pathname: "/octocat/Hello-World", search: "" }, sender);
  assert.equal(dnrCalls.length, before + 1);
  assert.deepEqual(sessionRules[0]?.condition?.tabIds, [42]);

  // duplicate route-change for same covered tab must not rewrite rules
  await sendMessage({ type: "oldgh:route-change", pathname: "/octocat/Hello-World/issues", search: "" }, sender);
  assert.equal(dnrCalls.length, before + 1);

  await sendMessage({ type: "oldgh:pre-navigate-uncovered" }, sender);
  assert.equal(sessionRules.length, 0);
});

test("proxyFetch drops credentials on cross-origin redirect and enforces hop limit", async (t) => {
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; });

  const sender = { id: "oldgh-test-id", origin: "https://github.com", tab: { id: 7 } };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init?.credentials, init?.redirect]);
    if (String(url).startsWith("https://github.com/")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://raw.githubusercontent.com/octocat/repo/main/README.md?token=abc" },
      });
    }
    return new Response("hello raw", { status: 200, headers: { "content-type": "text/plain" } });
  };

  const res = await sendMessage(
    { type: "oldgh:fetch", url: "https://github.com/octocat/repo/raw/refs/heads/main/README.md", credentials: "include" },
    sender,
  );
  assert.deepEqual(res, { ok: true, status: 200, contentType: "text/plain", text: "hello raw" });
  assert.deepEqual(calls, [
    ["https://github.com/octocat/repo/raw/refs/heads/main/README.md", "include", "manual"],
    ["https://raw.githubusercontent.com/octocat/repo/main/README.md?token=abc", "omit", "manual"],
  ]);

  // >5 hops rejected
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://raw.githubusercontent.com/octocat/repo/main/README.md" },
  });
  const tooManyHops = await sendMessage(
    { type: "oldgh:fetch", url: "https://github.com/octocat/repo/raw/refs/heads/main/README.md", credentials: "include" },
    sender,
  );
  assert.equal(tooManyHops.ok, false);
  assert.equal(tooManyHops.status, 400);
});
