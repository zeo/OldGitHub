export type PageMode = "on" | "native" | "signed-out" | "off";

const NATIVE_KEY = "oldgh:native";
const RELOAD_GUARD_KEY = "oldgh:reload-guard";
const REPORT_URL = "https://github.com/zeo/OldGitHub/issues/new";

function sessionFlag(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionFlag(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // storage blocked: native mode then lasts only for this load
  }
}

export function isNativeTab(): boolean {
  return sessionFlag(NATIVE_KEY) === "1";
}

export async function reportPageMode(mode: PageMode): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "oldgh:page-mode", mode })) as { reload?: boolean } | undefined;
    return res?.reload === true;
  } catch {
    return false;
  }
}

// reload at most once per url every 10s so a confused worker can't loop the tab
export function reloadOnce(): boolean {
  const [at = "0", href = ""] = (sessionFlag(RELOAD_GUARD_KEY) ?? "").split(" ");
  if (href === location.href && Date.now() - Number(at) < 10_000) return false;
  setSessionFlag(RELOAD_GUARD_KEY, `${Date.now()} ${location.href}`);
  location.reload();
  return true;
}

export async function showNativePage(path?: string): Promise<void> {
  setSessionFlag(NATIVE_KEY, "1");
  await reportPageMode("native");
  // swapping the url first lets a link land natively on a specific page or anchor
  if (path) history.replaceState(null, "", path);
  location.reload();
}

async function leaveNativeMode(): Promise<void> {
  setSessionFlag(NATIVE_KEY, null);
  await reportPageMode("on");
  location.reload();
}

export function bindNativeLinks(): void {
  document.addEventListener("click", (e) => {
    const target = (e.target as Element | null)?.closest?.("[data-oldgh-show-native], [data-oldgh-open-options]");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (target.hasAttribute("data-oldgh-open-options")) void chrome.runtime.sendMessage({ type: "oldgh:open-options" }).catch(() => undefined);
    else {
      const href = target.getAttribute("href");
      void showNativePage(href?.startsWith("/") && !href.startsWith("//") ? href : undefined);
    }
  }, true);
}

export function reportIssueUrl(detail?: string): string {
  const params = new URLSearchParams({
    title: `Page not rendering: ${location.pathname}`,
    body: `Page: ${location.href}\n${detail ? `Error: ${detail}\n` : ""}\nWhat looked wrong:\n`,
  });
  return `${REPORT_URL}?${params}`;
}

export function mountNativePill(): void {
  const host = document.createElement("div");
  host.setAttribute("data-oldgh-native-pill", "");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      div { display:flex; gap:10px; align-items:center; padding:7px 12px; border-radius:3px;
        font:12px/1.4 Helvetica, Arial, sans-serif; color:#333; background:#f5f5f5;
        border:1px solid #ccc; box-shadow:0 1px 3px rgba(0,0,0,.2); }
      button, a { font:inherit; color:#4183c4; background:none; border:0; padding:0; cursor:pointer; text-decoration:none; }
      button:hover, a:hover { text-decoration:underline; }
      strong { font-weight:bold; }
    </style>
    <div role="status">
      <span>OldGitHub is off in this tab.</span>
      <button type="button" data-on><strong>Turn it back on</strong></button>
      <a target="_blank" rel="noopener noreferrer" data-report>Report a problem</a>
      <button type="button" data-options>Options</button>
    </div>`;
  root.querySelector<HTMLAnchorElement>("[data-report]")!.href = reportIssueUrl();
  root.querySelector("[data-on]")!.addEventListener("click", () => void leaveNativeMode());
  root.querySelector("[data-options]")!.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "oldgh:open-options" }).catch(() => undefined);
  });
  document.body.appendChild(host);
}
