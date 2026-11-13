import { killTurbo, mountRouter } from "@/router";
import { isFullyCoveredUrl, resolveRoute } from "@/router/resolve";
import { keepFirstLoad } from "@/adapters/_page";
import { bindShortcuts } from "@/router/shortcuts";
import { isLoggedIn } from "@/auth/session";
import { applyTheme, watchThemeChanges } from "@/theme";
import { mountHeader } from "@/views/header";
import { mountFooter } from "@/views/footer";
import { mountHovercards } from "@/views/hovercards";
import { mountQuotaNotice } from "@/views/quota-notice";
import { bindNativeLinks, isNativeTab, mountNativePill, reloadOnce, reportPageMode, type PageMode } from "@/native-mode";

const IS_GIST = window.location.hostname === "gist.github.com";
const DISABLED_CACHE_KEY = "oldgh:disabled-cache";
const SIGNED_OUT_CACHE_KEY = "oldgh:signed-out-cache";

let colorModeObserver: MutationObserver | null = null;
const originalColorAttrs = new Map<string, string | null>();

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // localStorage unavailable; the next load decides from storage instead
  }
}

// synchronous guess at document_start; boot() confirms once storage and the dom are ready
function eagerMode(): PageMode {
  if (readLocal(DISABLED_CACHE_KEY)) return "off";
  if (isNativeTab()) return "native";
  if (readLocal(SIGNED_OUT_CACHE_KEY) && !isLoggedIn()) return "signed-out";
  return "on";
}

function eagerStyle(): void {
  document.documentElement.setAttribute("data-oldgh", "active");
  if (IS_GIST) document.documentElement.setAttribute("data-oldgh-host", "gist");
  document.documentElement.setAttribute("data-oldgh-mounted", "pending");
  // Read the cached theme from localStorage (sync) to avoid a light→dark flash
  // before chrome.storage.sync resolves. applyTheme() reconciles to the true
  // stored value shortly after.
  const cached = readCachedTheme();
  const initial = resolveInitial(cached);
  document.documentElement.setAttribute("data-oldgh-theme", initial);
  forceGitHubColorModeNeutral();
  injectThemeStylesheet();
}

function readCachedTheme(): string | null {
  try {
    return localStorage.getItem("oldgh:theme-cache");
  } catch {
    return null;
  }
}

function resolveInitial(cached: string | null): "light" | "dark" {
  if (cached === "light" || cached === "dark") return cached;
  // "auto" or no cache: trust prefers-color-scheme for the first paint
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // matchMedia unavailable
  }
  return "light";
}

function undoEagerStyle(): void {
  const html = document.documentElement;
  for (const attr of ["data-oldgh", "data-oldgh-host", "data-oldgh-mounted", "data-oldgh-theme"]) html.removeAttribute(attr);
  colorModeObserver?.disconnect();
  colorModeObserver = null;
  for (const [attr, value] of originalColorAttrs) {
    if (value === null) html.removeAttribute(attr);
    else html.setAttribute(attr, value);
  }
  document.querySelectorAll("link[data-oldgh-stylesheet]").forEach((n) => n.remove());
}

const GITHUB_ASSETS = "https://github.githubassets.com/assets/";
const assetState = { loaded: false, blocked: false, armed: false, healing: false };

function noteAsset(e: Event): void {
  const el = e.target;
  const url = el instanceof HTMLLinkElement ? el.href : el instanceof HTMLScriptElement ? el.src : "";
  if (!url.startsWith(GITHUB_ASSETS)) return;
  if (e.type === "load") assetState.loaded = true;
  else assetState.blocked = true;
  if (assetState.armed) void healLoadState();
}

// the rules arm on tabs.onUpdated, which can lose the race with a hard load's first requests
async function healLoadState(): Promise<boolean> {
  const search = location.search.slice(1);
  const covered = isFullyCoveredUrl(location.pathname, search);
  if (assetState.healing || !(covered ? assetState.loaded : assetState.blocked)) return false;
  assetState.healing = true;
  document.removeEventListener("load", noteAsset, true);
  document.removeEventListener("error", noteAsset, true);
  console.warn(`[oldgh] github assets were ${covered ? "loaded on a page we render" : "blocked on a native page"}, reloading once`);
  await chrome.runtime.sendMessage({ type: "oldgh:route-change", pathname: location.pathname, search }).catch(() => undefined);
  return reloadOnce();
}

async function boot(): Promise<void> {
  const early = eagerMode();
  if (early === "on") eagerStyle();
  if (!IS_GIST) {
    document.addEventListener("load", noteAsset, true);
    document.addEventListener("error", noteAsset, true);
  }
  chrome.runtime.onMessage.addListener((msg: { type?: unknown; enabled?: unknown }, _sender, sendResponse) => {
    if (msg?.type !== "oldgh:set-enabled") return undefined;
    writeLocal(DISABLED_CACHE_KEY, msg.enabled === false);
    sendResponse({ ok: true });
    return undefined;
  });
  const stored = await chrome.storage.local.get("enabled").catch(() => ({} as Record<string, unknown>));
  const enabled = stored["enabled"] !== false;
  writeLocal(DISABLED_CACHE_KEY, !enabled);
  if (document.readyState === "loading") {
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }

  const mode: PageMode = !enabled ? "off" : isNativeTab() ? "native" : isLoggedIn() ? "on" : "signed-out";
  writeLocal(SIGNED_OUT_CACHE_KEY, mode === "signed-out");
  if (mode !== "on") {
    document.removeEventListener("load", noteAsset, true);
    document.removeEventListener("error", noteAsset, true);
    undoEagerStyle();
    if (await reportPageMode(mode) && reloadOnce()) return;
    if (mode === "native") mountNativePill();
    return;
  }
  // an early "off" or "signed-out" guess let github's own assets load, so this page needs one clean reload
  if (early !== "on") {
    await reportPageMode("on");
    if (reloadOnce()) return;
    eagerStyle();
  } else {
    void reportPageMode("on").then((reload) => reload && reloadOnce());
  }
  assetState.armed = true;
  if (await healLoadState()) return;
  await run();
}

async function run(): Promise<void> {
  if (IS_GIST) {
    // gist.github.com: keep the native body, just put our themed header on top
    await applyTheme();
    watchThemeChanges();
    await mountHeader();
    document.documentElement.setAttribute("data-oldgh-mounted", "gist-passthrough");
    return;
  }
  const firstKind = resolveRoute(location.pathname, location.search.slice(1)).kind;
  if (firstKind === "repo-home" || firstKind === "profile") keepFirstLoad();
  killTurbo();
  bindNativeLinks();
  await applyTheme();
  watchThemeChanges();
  console.debug("[oldgh] mounting header + router");
  await mountHeader();
  mountFooter();
  mountHovercards();
  mountQuotaNotice();
  bindShortcuts();
  mountRouter();
}

function forceGitHubColorModeNeutral(): void {
  // we render everything ourselves, but a few scraped fragments (achievements,
  // wiki, scraped sections) still pick up github's color-mode tokens.
  // pin them to follow our resolved theme so scraped HTML matches the user
  // theme, and so native pass-through pages (create forms, settings) have
  // readable labels.
  const html = document.documentElement;
  for (const attr of ["data-color-mode", "data-light-theme", "data-dark-theme"]) originalColorAttrs.set(attr, html.getAttribute(attr));
  const sync = (): void => {
    const ourTheme = html.getAttribute("data-oldgh-theme") === "dark" ? "dark" : "light";
    if (html.getAttribute("data-color-mode") !== ourTheme) {
      html.setAttribute("data-color-mode", ourTheme);
    }
    if (html.getAttribute("data-light-theme") !== "light") html.setAttribute("data-light-theme", "light");
    if (html.getAttribute("data-dark-theme") !== "dark") html.setAttribute("data-dark-theme", "dark");
  };
  sync();
  colorModeObserver = new MutationObserver(() => sync());
  colorModeObserver.observe(html, { attributes: true, attributeFilter: ["data-color-mode", "data-light-theme", "data-dark-theme", "data-oldgh-theme"] });
}

function injectThemeStylesheet(): void {
  const href = chrome.runtime.getURL("styles/2013.css");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.oldghStylesheet = "theme";
  document.documentElement.appendChild(link);
}

void boot();
