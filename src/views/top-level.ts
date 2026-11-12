import { scrapeTopLevel, type TopLevelView } from "@/adapters/top-level";
import { AdapterFailure } from "@/adapters";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-top-level";

export type TopLevelKind = "dashboard" | "notifications" | "search" | "issues" | "pulls" | "stars" | "explore" | "trending" | "watching" | "marketplace" | "settings" | "topic" | "topics" | "collections" | "sponsors" | "other";

export async function mountTopLevel(
  kind: TopLevelKind,
  pathname: string,
  search: string,
  titleFallback: string,
): Promise<void> {
  const nav = navigationToken();
  const view = await scrapeTopLevel(pathname, search, titleFallback);

  // after cleaning, a failed react island can leave only whitespace/markup with no
  // text; fall back to the native page rather than render an empty titled section
  if (!hasMeaningfulContent(view.contentHtml)) {
    throw new AdapterFailure("mountTopLevel", `no content for ${pathname}`);
  }

  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${kind}`;
  root.innerHTML = `
    <div class="oldgh-page">
      <header class="oldgh-section__header">
        <h1>${escapeText(view.title)}</h1>
      </header>
      <div class="oldgh-section__content">
        ${view.contentHtml}
      </div>
    </div>
  `;
  adoptBodyRoot(root, undefined, nav);
}

export function unmountTopLevel(): void {
  removeAllBodyRoots();
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hasMeaningfulContent(html: string): boolean {
  const probe = document.createElement("div");
  probe.innerHTML = html;
  const text = (probe.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length > 0) return true;
  // no visible text, but media-only content (e.g. an avatar grid) is still real
  return probe.querySelector("img, svg, video, canvas") !== null;
}
