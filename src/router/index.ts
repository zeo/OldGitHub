import { dispatchRoute } from "@/router/dispatch";
import { isFullyCoveredUrl } from "@/router/resolve";

export function killTurbo(): void {
  const meta = document.createElement("meta");
  meta.name = "turbo-visit-control";
  meta.content = "reload";
  document.documentElement.appendChild(meta);

  const stop = (e: Event): void => {
    e.stopImmediatePropagation();
  };
  for (const evt of [
    "turbo:click",
    "turbo:before-visit",
    "turbo:visit",
    "turbo:before-fetch-request",
    "turbo:before-render",
    "turbo:render",
    "turbo:load",
  ]) {
    document.addEventListener(evt, stop, true);
  }
}

export function mountRouter(): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnce, { once: true });
  } else {
    initOnce();
  }
}

export function navigate(
  target: string | URL,
  opts: { scrollTop?: boolean; replace?: boolean } = {},
): void {
  let url: URL;
  try {
    url = target instanceof URL ? target : new URL(target, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (!isFullyCoveredUrl(url.pathname, search)) {
    const currentSearch = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    if (isFullyCoveredUrl(window.location.pathname, currentSearch)) {
      leaveCoveredPage(url.toString());
    } else {
      window.location.assign(url.toString());
    }
    return;
  }
  if (opts.replace) {
    history.replaceState({}, "", url.toString());
  } else {
    history.pushState({}, "", url.toString());
  }
  void dispatchRoute(url, { scrollTop: opts.scrollTop ?? true });
}

function leaveCoveredPage(destination: string): void {
  const go = (): void => { window.location.assign(destination); };
  // sw may have recycled or restarted, so always fall through to navigation
  try {
    void chrome.runtime
      .sendMessage({ type: "oldgh:pre-navigate-uncovered" })
      .catch(() => undefined)
      .finally(go);
  } catch {
    go();
  }
}

function initOnce(): void {
  interceptClicks();
  window.addEventListener("popstate", () => {
    void dispatchRoute(window.location);
  });
  void dispatchRoute(window.location);
}

function interceptClicks(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest("a");
      if (!anchor) return;
      if (anchor.hasAttribute("download") || anchor.hasAttribute("data-oldgh-open-options") || anchor.hasAttribute("data-oldgh-show-native")) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
        return;
      }

      const search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
      if (!isFullyCoveredUrl(url.pathname, search)) {
        const currentSearch = window.location.search.startsWith("?")
          ? window.location.search.slice(1)
          : window.location.search;
        if (isFullyCoveredUrl(window.location.pathname, currentSearch)) {
          e.preventDefault();
          leaveCoveredPage(url.toString());
        }
        return;
      }

      e.preventDefault();
      history.pushState({}, "", url.toString());
      void dispatchRoute(url, { scrollTop: true });
    },
    true,
  );
}
