import { AdapterFailure } from "./index";
import { parseRepoPage } from "./_page";
import { cleanScrapedPage } from "@/util/html";

export type ScrapedSection = {
  owner: string;
  repo: string;
  title: string;
  contentHtml: string;
  sourceUrl: string;
};

export async function scrapeSection(
  owner: string,
  repo: string,
  path: string,
  options: { titleFallback: string; selectors?: string[] },
): Promise<ScrapedSection> {
  const sourceUrl = `https://github.com/${owner}/${repo}${path}`;
  const resp = await fetch(sourceUrl, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("scrapeSection", `${sourceUrl} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);

  const candidates = options.selectors ?? [
    "turbo-frame#repo-content-turbo-frame",
    "[data-pjax='#repo-content-pjax-container']",
    "#repo-content-pjax-container",
    "#js-repo-pjax-container",
    "[data-turbo-body]",
    "main #repo-content-turbo-frame",
    ".application-main",
    "main",
  ];

  let main: Element | null = null;
  for (const sel of candidates) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) {
      main = el;
      break;
    }
  }

  if (!main) {
    throw new AdapterFailure("scrapeSection", "no main content found");
  }

  cleanScrapedContent(main);

  // prefer the explicit fallback when the scraped heading is hidden/generic
  const titleFromMain = pickScrapedTitle(main);
  const docTitleRaw = doc.querySelector("title")?.textContent?.trim() || "";
  const docTitleClean = docTitleRaw.split("·")[0]?.trim() || "";
  const title = titleFromMain || options.titleFallback || docTitleClean || "Other";
  stripDuplicateHeading(main, title);

  return {
    owner,
    repo,
    title,
    contentHtml: main.innerHTML,
    sourceUrl,
  };
}

const TITLE_BLOCKLIST = [
  /^Search code, repositories/i,
  /^Provide feedback$/i,
  /^Saved searches$/i,
  /^Search syntax tips/i,
];

// skip the visually-hidden / generic leading heading modern github injects
function pickScrapedTitle(el: Element): string | null {
  const candidates = el.querySelectorAll<HTMLElement>("h1.h2, h1.h3, h1");
  for (const h of Array.from(candidates)) {
    if (h.classList.contains("sr-only")) continue;
    if (h.getAttribute("aria-hidden") === "true") continue;
    if (h.closest("dialog, modal-dialog, .Overlay--hidden, [hidden]")) continue;
    const txt = h.textContent?.replace(/\s+/g, " ").trim();
    if (!txt) continue;
    if (txt.length > 60) continue;
    if (TITLE_BLOCKLIST.some((re) => re.test(txt))) continue;
    return txt;
  }
  return null;
}

// remove the heading whose text became the title, not just the first h1
function stripDuplicateHeading(el: Element, title: string): void {
  if (!title) return;
  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = normalize(title);
  for (const h of Array.from(el.querySelectorAll<HTMLElement>("h1, h2"))) {
    if (h.classList.contains("sr-only")) continue;
    if (normalize(h.textContent || "") === target) {
      h.remove();
      break;
    }
  }
}

function cleanScrapedContent(el: Element): void {
  cleanScrapedPage(el, [".flash", "[aria-label*='error' i][role='alert']", "[data-component='error-boundary']", ".js-error-boundary"]);
  // Strip the "Welcome to Projects" marketing card. Only remove the small
  // promotional card itself, identified by short text + a 'Learn more' link.
  // Walk from the innermost matching heading up to the smallest containing
  // card (max ~6 ancestors) so we don't accidentally remove the project list.
  for (const heading of Array.from(el.querySelectorAll<HTMLElement>("h2, h3, h4"))) {
    const txt = (heading.textContent || "").trim();
    if (!/^Welcome to Projects$/i.test(txt)) continue;
    let card: HTMLElement | null = heading;
    for (let i = 0; i < 6 && card; i++) {
      const next: HTMLElement | null = card.parentElement;
      if (!next) break;
      const parentText = (next.textContent || "").trim();
      if (parentText.length > 800) break;
      card = next;
    }
    if (card && card !== el) card.remove();
  }
}
