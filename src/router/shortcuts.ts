import { dispatchRoute } from "./dispatch";
import { resolveRoute } from "./resolve";

// 2013 keyboard shortcuts the dashboard ProTips advertise: "/" or "s" focuses
// the search bar, and "g" followed by a key navigates (g d/h dashboard, g n
// notifications, and on a repo g c/i/p/w/b for code/issues/pulls/wiki/branches).

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function go(path: string): void {
  history.pushState({}, "", path);
  void dispatchRoute(new URL(path, window.location.origin), { scrollTop: true });
}

// the /:owner/:repo prefix of the current page, or null when not on a repo
function currentRepo(): string | null {
  const search = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;
  const route = resolveRoute(window.location.pathname, search);
  if (route.kind.startsWith("repo-") && "owner" in route && "repo" in route) {
    return `/${route.owner}/${route.repo}`;
  }
  return null;
}

export function bindShortcuts(): void {
  let pendingG = false;
  let gTimer = 0;

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if (e.key === "/" || e.key === "s") {
      const input = document.querySelector<HTMLInputElement>(".oldgh-header__search-input");
      if (input) {
        e.preventDefault();
        input.focus();
      }
      return;
    }

    if (e.key === "g") {
      pendingG = true;
      window.clearTimeout(gTimer);
      gTimer = window.setTimeout(() => { pendingG = false; }, 1500);
      return;
    }

    if (!pendingG) return;
    pendingG = false;
    window.clearTimeout(gTimer);
    const repo = currentRepo();
    switch (e.key) {
      case "d":
      case "h": e.preventDefault(); go("/"); break;
      case "n": e.preventDefault(); go("/notifications"); break;
      case "c": if (repo) { e.preventDefault(); go(repo); } break;
      case "i": if (repo) { e.preventDefault(); go(`${repo}/issues`); } break;
      case "p": if (repo) { e.preventDefault(); go(`${repo}/pulls`); } break;
      case "w": if (repo) { e.preventDefault(); go(`${repo}/wiki`); } break;
      case "b": if (repo) { e.preventDefault(); go(`${repo}/branches`); } break;
    }
  });
}
