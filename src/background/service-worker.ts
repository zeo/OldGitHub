import { isFullyCoveredUrl } from "@/router/resolve";
import { allowedProxyUrl, readProxyText } from "./proxy-policy";

const ResourceType = chrome.declarativeNetRequest.ResourceType;
const RuleActionType = chrome.declarativeNetRequest.RuleActionType;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.storage.sync.set({ theme: "auto" });
  }
});

type BlockState = { enabled: boolean; signedOut: boolean; nativeTabs: number[] };

const stateReady: Promise<BlockState> = Promise.all([
  chrome.storage.local.get("enabled"),
  chrome.storage.session.get(["oldgh:signed-out", "oldgh:native-tabs"]),
]).then(([local, session]) => ({
  enabled: local["enabled"] !== false,
  signedOut: session["oldgh:signed-out"] === true,
  nativeTabs: Array.isArray(session["oldgh:native-tabs"]) ? (session["oldgh:native-tabs"] as number[]) : [],
}));

async function saveState(patch: Partial<BlockState>): Promise<BlockState> {
  const state = Object.assign(await stateReady, patch);
  if ("enabled" in patch) await chrome.storage.local.set({ enabled: state.enabled });
  if ("signedOut" in patch || "nativeTabs" in patch) {
    await chrome.storage.session.set({ "oldgh:signed-out": state.signedOut, "oldgh:native-tabs": state.nativeTabs });
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
chrome.runtime.onStartup.addListener(() => undefined);

chrome.action.onClicked.addListener(() => {
  void (async () => {
    const state = await saveState({ enabled: !(await stateReady).enabled });
    showBadge(state.enabled);
    if (!state.enabled) {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
    }
    const tabs = await chrome.tabs.query({ url: ["https://github.com/*", "https://gist.github.com/*"] });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      await chrome.tabs.sendMessage(tab.id, { type: "oldgh:set-enabled", enabled: state.enabled }).catch(() => undefined);
      void chrome.tabs.reload(tab.id);
    }
  })();
});

type RuleSpec = {
  urlFilter: string;
  resourceType: chrome.declarativeNetRequest.ResourceType;
};

const BLOCK_SPECS: readonly RuleSpec[] = [
  { urlFilter: "||github.githubassets.com/assets/", resourceType: ResourceType.STYLESHEET },
  { urlFilter: "||github.githubassets.com/assets/react-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/wp-runtime-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/app_assets_modules_", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/environment-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/behaviors-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/vendors-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/chunk-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/notifications-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/webpack_", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/primer-", resourceType: ResourceType.SCRIPT },
  { urlFilter: "||github.githubassets.com/assets/element-", resourceType: ResourceType.SCRIPT },
];

const RULES_PER_TAB = BLOCK_SPECS.length;
const RULE_ID_BASE = 1000;
const MAX_RULE_ID = 1_000_000_000;

function ruleIdsFor(tabId: number): number[] {
  const base = RULE_ID_BASE + tabId * RULES_PER_TAB;
  if (base + RULES_PER_TAB >= MAX_RULE_ID) return [];
  return Array.from({ length: RULES_PER_TAB }, (_, i) => base + i);
}

async function enableForTab(tabId: number): Promise<void> {
  if (!(await mayBlock(tabId))) return disableForTab(tabId);
  const ids = ruleIdsFor(tabId);
  if (ids.length === 0) return;
  const addRules: chrome.declarativeNetRequest.Rule[] = BLOCK_SPECS.map((spec, i) => ({
    id: ids[i]!,
    priority: 1,
    action: { type: RuleActionType.BLOCK },
    condition: {
      urlFilter: spec.urlFilter,
      resourceTypes: [spec.resourceType],
      tabIds: [tabId],
      initiatorDomains: ["github.com"],
    },
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ids,
      addRules,
    });
  } catch (err) {
    console.debug("[oldgh] enableForTab failed:", err);
  }
}

async function disableForTab(tabId: number): Promise<void> {
  const ids = ruleIdsFor(tabId);
  if (ids.length === 0) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  } catch (err) {
    console.debug("[oldgh] disableForTab failed:", err);
  }
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
  void disableForTab(tabId);
  void stateReady.then((s) => {
    if (s.nativeTabs.includes(tabId)) void saveState({ nativeTabs: s.nativeTabs.filter((id) => id !== tabId) });
  });
});

async function tabWasBlocked(tabId: number): Promise<boolean> {
  const ids = new Set(ruleIdsFor(tabId));
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((r) => ids.has(r.id));
}

type PageMode = "on" | "native" | "signed-out" | "off";

// returns true when the page loaded under the wrong blocking state and needs one reload
async function notePageMode(tabId: number, mode: PageMode): Promise<boolean> {
  const state = await stateReady;
  if (mode === "on") {
    const wasUnblocked = state.signedOut || state.nativeTabs.includes(tabId);
    await saveState({ signedOut: false, nativeTabs: state.nativeTabs.filter((id) => id !== tabId) });
    return wasUnblocked;
  }
  const blocked = await tabWasBlocked(tabId);
  if (mode === "signed-out") await saveState({ signedOut: true });
  if (mode === "native" && !state.nativeTabs.includes(tabId)) await saveState({ nativeTabs: [...state.nativeTabs, tabId] });
  await disableForTab(tabId);
  return blocked;
}

// dev auto-reload: poll the dev server build-stamp; reload extension when it changes.
// tree-shaken out of production builds — never runs against the user's machine.
if (import.meta.env.MODE === "development") {
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
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as { type?: unknown; pathname?: unknown; search?: unknown };
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return undefined;

  if (m.type === "oldgh:route-change") {
    if (typeof m.pathname !== "string") return undefined;
    const search = typeof m.search === "string" ? m.search : "";
    if (isFullyCoveredUrl(m.pathname, search)) {
      void enableForTab(tabId);
    } else {
      void disableForTab(tabId);
    }
    return undefined;
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
    disableForTab(tabId).finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (m.type === "oldgh:fetch") {
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
  try {
    const r = await fetch(allowedUrl, { credentials, redirect: "follow" });
    if (!r.ok) return { ok: false, status: r.status };
    const contentType = r.headers.get("content-type") || "";
    const text = await readProxyText(r);
    return { ok: true, status: r.status, contentType, text };
  } catch (e) {
    const tooLarge = e instanceof RangeError;
    return { ok: false, status: tooLarge ? 413 : 0, error: String(e) };
  }
}
