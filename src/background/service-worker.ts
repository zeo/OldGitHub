import { isFullyCoveredUrl } from "@/router/resolve";
import { blockRules } from "./block-rules";
import { allowedProxyUrl, allowedRedirectTarget, readProxyText } from "./proxy-policy";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.storage.sync.set({ theme: "auto" });
  }
});

type BlockState = { enabled: boolean; signedOut: boolean; nativeTabs: number[]; blockedTabs: number[] };

const tabList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : []);

const stateReady: Promise<BlockState> = Promise.all([
  chrome.storage.local.get("enabled"),
  chrome.storage.session.get(["oldgh:signed-out", "oldgh:native-tabs", "oldgh:blocked-tabs"]),
]).then(([local, session]) => ({
  enabled: local["enabled"] !== false,
  signedOut: session["oldgh:signed-out"] === true,
  nativeTabs: tabList(session["oldgh:native-tabs"]),
  blockedTabs: tabList(session["oldgh:blocked-tabs"]),
}));

async function saveState(patch: Partial<BlockState>): Promise<BlockState> {
  const state = Object.assign(await stateReady, patch);
  if ("enabled" in patch) await chrome.storage.local.set({ enabled: state.enabled });
  if ("signedOut" in patch || "nativeTabs" in patch || "blockedTabs" in patch) {
    await chrome.storage.session.set({
      "oldgh:signed-out": state.signedOut,
      "oldgh:native-tabs": state.nativeTabs,
      "oldgh:blocked-tabs": state.blockedTabs,
    });
  }
  return state;
}

async function mayBlock(tabId: number): Promise<boolean> {
  const state = await stateReady;
  return state.enabled && !state.signedOut && !state.nativeTabs.includes(tabId);
}

function showBadge(enabled: boolean): void {
  void chrome.action.setBadgeText({ text: enabled ? "" : "off" });
  void chrome.action.setBadgeBackgroundColor({ color: "#777" });
  void chrome.action.setTitle({ title: enabled ? "OldGitHub is on. Click to turn it off." : "OldGitHub is off. Click to turn it on." });
}

void stateReady.then((s) => showBadge(s.enabled));
chrome.runtime.onStartup.addListener(() => {
  void stateReady.then((s) => showBadge(s.enabled));
});

chrome.action.onClicked.addListener(() => {
  void (async () => {
    const enabled = await runQueued(async () => {
      const state = await saveState({ enabled: !(await stateReady).enabled });
      showBadge(state.enabled);
      if (!state.enabled) await syncBlockedRules([]);
      return state.enabled;
    });
    const tabs = await chrome.tabs.query({ url: ["https://github.com/*", "https://gist.github.com/*"] });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      await chrome.tabs.sendMessage(tab.id, { type: "oldgh:set-enabled", enabled }).catch(() => undefined);
      void chrome.tabs.reload(tab.id);
    }
  })();
});

let stateQueue: Promise<unknown> = Promise.resolve();

// serialize every state and dnr transition so concurrent events cannot overwrite each other
function runQueued<T>(op: () => Promise<T>): Promise<T> {
  const next = stateQueue.then(op, op);
  stateQueue = next.catch((err: unknown) => {
    console.debug("[oldgh] worker state op failed:", err);
  });
  return next;
}

function rulesMatch(current: chrome.declarativeNetRequest.Rule[], expected: chrome.declarativeNetRequest.Rule[]): boolean {
  if (current.length !== expected.length) return false;
  for (let i = 0; i < current.length; i++) {
    const a = current[i]!;
    const b = expected[i]!;
    if (a.id !== b.id) return false;
    const at = a.condition?.tabIds ?? [];
    const bt = b.condition?.tabIds ?? [];
    if (at.length !== bt.length || at.some((id, idx) => id !== bt[idx])) return false;
  }
  return true;
}

async function syncBlockedRules(nextTabs: number[]): Promise<void> {
  const current = await chrome.declarativeNetRequest.getSessionRules();
  const desired = blockRules(nextTabs);
  if (!rulesMatch(current, desired)) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: current.map((r) => r.id),
      addRules: desired,
    });
  }
  await saveState({ blockedTabs: nextTabs });
}

function setBlocked(update: (tabs: number[]) => number[]): Promise<void> {
  return runQueued(async () => {
    const state = await stateReady;
    await syncBlockedRules(update(state.blockedTabs));
  });
}

// skip rewriting rules on wakeup if chrome already holds the matching session rules
void runQueued(async () => syncBlockedRules((await stateReady).blockedTabs));

async function enableForTab(tabId: number): Promise<void> {
  if (!(await mayBlock(tabId))) return disableForTab(tabId);
  return setBlocked((tabs) => (tabs.includes(tabId) ? tabs : [...tabs, tabId]));
}

function disableForTab(tabId: number): Promise<void> {
  return setBlocked((tabs) => tabs.filter((id) => id !== tabId));
}

async function reconcile(tabId: number, url: string | undefined): Promise<void> {
  if (!url) {
    await disableForTab(tabId);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await disableForTab(tabId);
    return;
  }
  if (parsed.hostname !== "github.com") {
    await disableForTab(tabId);
    return;
  }
  const search = parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search;
  if (isFullyCoveredUrl(parsed.pathname, search)) {
    await enableForTab(tabId);
  } else {
    await disableForTab(tabId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url) {
    void reconcile(tabId, info.url);
  } else if (info.status === "loading" && tab.url) {
    void reconcile(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void runQueued(async () => {
    const state = await stateReady;
    if (state.nativeTabs.includes(tabId)) {
      await saveState({ nativeTabs: state.nativeTabs.filter((id) => id !== tabId) });
    }
    await syncBlockedRules(state.blockedTabs.filter((id) => id !== tabId));
  });
});

// prerender and instant pages swap the tab id under a loaded page
chrome.tabs.onReplaced.addListener((added, removed) => {
  void runQueued(async () => {
    const state = await stateReady;
    const nativeTabs = state.nativeTabs.includes(removed)
      ? [...state.nativeTabs.filter((id) => id !== removed), added]
      : state.nativeTabs;
    if (nativeTabs !== state.nativeTabs) await saveState({ nativeTabs });
    const nextBlocked = state.blockedTabs.includes(removed)
      ? [...state.blockedTabs.filter((id) => id !== removed), added]
      : state.blockedTabs;
    await syncBlockedRules(nextBlocked);
  });
});

type PageMode = "on" | "native" | "signed-out" | "off";

// returns true when the page loaded under the wrong blocking state and needs one reload
function notePageMode(tabId: number, mode: PageMode): Promise<boolean> {
  return runQueued(async () => {
    const state = await stateReady;
    if (mode === "on") {
      const wasUnblocked = state.signedOut || state.nativeTabs.includes(tabId);
      await saveState({ signedOut: false, nativeTabs: state.nativeTabs.filter((id) => id !== tabId) });
      return wasUnblocked;
    }
    const blocked = state.blockedTabs.includes(tabId);
    if (mode === "signed-out") await saveState({ signedOut: true });
    if (mode === "native" && !state.nativeTabs.includes(tabId)) await saveState({ nativeTabs: [...state.nativeTabs, tabId] });
    await syncBlockedRules(state.blockedTabs.filter((id) => id !== tabId));
    return blocked;
  });
}

// dev auto-reload: poll the dev server build-stamp; reload extension when it changes.
// tree-shaken out of production builds — never runs against the user's machine.
if (import.meta.env?.MODE === "development") {
  const DEV_URL = "http://localhost:7878/build-id";
  const QUIESCE_MS = 4_000;
  // chrome auto-disables an extension that calls runtime.reload() too rapidly
  // (~3 times in 10s). Track our reload timestamps across SW restarts via
  // chrome.storage.session and refuse to reload if we'd trip the safety.
  const RELOAD_BACKOFF_MS = 15_000;
  let lastStamp: string | null = null;
  let pendingStamp: string | null = null;
  let pendingSince = 0;
  let consecutiveErrors = 0;
  const triggerReloadIfSafe = async (): Promise<void> => {
    let recent: number[] = [];
    try {
      const stored = await chrome.storage.session.get("oldgh:devReloadTimes");
      const arr = stored["oldgh:devReloadTimes"];
      if (Array.isArray(arr)) recent = arr.filter((n): n is number => typeof n === "number");
    } catch {}
    const now = Date.now();
    const within = recent.filter((t) => now - t < RELOAD_BACKOFF_MS);
    if (within.length >= 2) {
      console.warn("[oldgh] dev reload skipped: 2 reloads already within 15s window — manual reload required");
      return;
    }
    within.push(now);
    try { await chrome.storage.session.set({ "oldgh:devReloadTimes": within }); } catch {}
    console.info("[oldgh] dev rebuild settled, reloading extension");
    chrome.runtime.reload();
  };
  const tick = async (): Promise<void> => {
    try {
      const resp = await fetch(DEV_URL, { cache: "no-store" });
      if (!resp.ok) {
        consecutiveErrors++;
        return;
      }
      consecutiveErrors = 0;
      const stamp = (await resp.text()).trim();
      if (lastStamp === null) {
        lastStamp = stamp;
        return;
      }
      if (stamp === lastStamp) {
        pendingStamp = null;
        pendingSince = 0;
        return;
      }
      if (pendingStamp !== stamp) {
        pendingStamp = stamp;
        pendingSince = Date.now();
        return;
      }
      if (Date.now() - pendingSince >= QUIESCE_MS) {
        await triggerReloadIfSafe();
      }
    } catch {
      consecutiveErrors++;
    }
  };
  // poll faster while connected, slow down after server stops responding
  const fast = setInterval(() => {
    void tick().then(() => {
      if (consecutiveErrors > 5) {
        clearInterval(fast);
        setInterval(tick, 10_000);
      }
    });
  }, 1_000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || sender.id !== chrome.runtime.id) return undefined;
  const m = msg as { type?: unknown; pathname?: unknown; search?: unknown };
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return undefined;
  let senderOrigin = "";
  try {
    senderOrigin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  } catch {
    return undefined;
  }
  if (senderOrigin !== "https://github.com" && senderOrigin !== "https://gist.github.com") return undefined;

  if (m.type === "oldgh:route-change") {
    if (senderOrigin !== "https://github.com" || typeof m.pathname !== "string") return undefined;
    const search = typeof m.search === "string" ? m.search : "";
    const applied = isFullyCoveredUrl(m.pathname, search) ? enableForTab(tabId) : disableForTab(tabId);
    void applied.then(() => sendResponse({ ok: true }));
    return true;
  }

  if (m.type === "oldgh:page-mode") {
    const mode = (m as { mode?: unknown }).mode;
    if (mode !== "on" && mode !== "native" && mode !== "signed-out" && mode !== "off") return undefined;
    notePageMode(tabId, mode).then((reload) => sendResponse({ reload }), () => sendResponse({ reload: false }));
    return true;
  }

  if (m.type === "oldgh:open-options") {
    void chrome.runtime.openOptionsPage();
    return undefined;
  }

  if (m.type === "oldgh:pre-navigate-uncovered") {
    if (senderOrigin !== "https://github.com") return undefined;
    disableForTab(tabId).finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (m.type === "oldgh:fetch") {
    if (senderOrigin !== "https://github.com") return undefined;
    const url = typeof (m as { url?: unknown }).url === "string" ? (m as { url: string }).url : null;
    if (!url) return undefined;
    const credentials = (m as { credentials?: unknown }).credentials === "include" ? "include" : "omit";
    proxyFetch(url, credentials).then((res) => sendResponse(res));
    return true;
  }

  return undefined;
});

type ProxyFetchResult =
  | { ok: true; status: number; contentType: string; text: string }
  | { ok: false; status: number; error?: string };

async function proxyFetch(url: string, credentials: "include" | "omit"): Promise<ProxyFetchResult> {
  const allowedUrl = allowedProxyUrl(url, credentials);
  if (!allowedUrl) return { ok: false, status: 400, error: "raw file URL rejected" };
  let currentUrl = allowedUrl;
  let currentCreds = credentials;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      const r = await fetch(currentUrl, { credentials: currentCreds, redirect: "manual" });
      if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) {
        await r.body?.cancel();
        const location = r.headers.get("location");
        if (!location || hop === 5) return { ok: false, status: 400, error: "raw file redirect rejected" };
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, status: 400, error: "raw file redirect rejected" };
        }
        if (!allowedRedirectTarget(nextUrl)) return { ok: false, status: 400, error: "raw file redirect rejected" };
        if (new URL(nextUrl).hostname !== "github.com") currentCreds = "omit";
        currentUrl = nextUrl;
        continue;
      }
      if (!r.ok) return { ok: false, status: r.status };
      const contentType = r.headers.get("content-type") || "";
      const text = await readProxyText(r);
      return { ok: true, status: r.status, contentType, text };
    }
    return { ok: false, status: 400, error: "raw file redirect rejected" };
  } catch (e) {
    const tooLarge = e instanceof RangeError;
    return { ok: false, status: tooLarge ? 413 : 0, error: String(e) };
  }
}
