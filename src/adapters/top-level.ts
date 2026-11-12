import { AdapterFailure } from "./index";
import { parseRepoPage } from "./_page";
import { cleanScrapedPage } from "@/util/html";

export type TopLevelView = {
  title: string;
  contentHtml: string;
  sourceUrl: string;
};

export async function scrapeTopLevel(
  path: string,
  search: string,
  titleFallback: string,
  selectors?: string[],
): Promise<TopLevelView> {
  const sourceUrl = `https://github.com${path}${search ? "?" + search : ""}`;
  const resp = await fetch(sourceUrl, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("scrapeTopLevel", `${sourceUrl} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);

  const candidates = selectors ?? [
    "main",
    "[data-turbo-body]",
    "#js-pjax-container",
    ".application-main",
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
    throw new AdapterFailure("scrapeTopLevel", "no main content");
  }
  cleanScraped(main);

  const title = pickTitle(doc, titleFallback);
  stripDuplicateHeading(main, title);
  return { title, contentHtml: main.innerHTML, sourceUrl };
}

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

function pickTitle(doc: Document, fallback: string): string {
  const scraped = pickScrapedTitle(doc);
  if (scraped) return scraped;
  return fallback;
}

const TITLE_BLOCKLIST = [
  /^Search code, repositories/i,
  /^Provide feedback$/i,
  /^Saved searches$/i,
  /^Search syntax tips/i,
];

function pickScrapedTitle(doc: Document): string | null {
  const candidates = doc.querySelectorAll<HTMLElement>("h1.h2, h1.h3, h1");
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

function cleanScraped(el: Element): void {
  cleanScrapedPage(el, [".flash", "[aria-label*='error' i][role='alert']", "[data-component='error-boundary']", ".js-error-boundary"]);
  for (const h of Array.from(el.querySelectorAll<HTMLElement>("h1"))) {
    const txt = (h.textContent || "").replace(/\s+/g, " ").trim();
    if (/^Search code, repositories/i.test(txt)) h.remove();
  }
}
