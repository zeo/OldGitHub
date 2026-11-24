import { AdapterFailure } from "./index";
import { parseRepoPage } from "./_page";
import { encodePathSegments, escapeAttr } from "@/util/html";

export type WikiPageRef = {
  title: string;
  href: string;
};

export type WikiView = {
  owner: string;
  repo: string;
  pageTitle: string;
  metaText: string;
  bodyHtml: string;
  pages: WikiPageRef[];
  cloneUrl: string;
};

export async function getWiki(owner: string, repo: string, page: string): Promise<WikiView> {
  const segs = page.split("/").filter(Boolean);
  if (segs.some((s) => s === "." || s === "..")) {
    throw new AdapterFailure("getWiki", `invalid wiki page path: ${page}`);
  }
  const slug = page === "Home" ? "" : "/" + encodePathSegments(page);
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/wiki${slug}`;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getWiki", `${url} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = parseRepoPage(html);

  const pageTitle = doc.querySelector(".gh-header-title")?.textContent?.trim() || page;
  const metaText = doc.querySelector(".gh-header-meta")?.textContent?.replace(/\s+/g, " ").trim() || "";
  const bodyEl = doc.querySelector(".markdown-body");
  const isEmptyWiki =
    !bodyEl &&
    !!doc.querySelector(".blankslate, [data-testid='blankslate'], h3.f3-light, .container-lg [data-target*='wiki']");
  const bodyHtml = bodyEl
    ? bodyEl.innerHTML
    : isEmptyWiki
      ? `<div class="oldgh-wiki__empty"><h2>This wiki is empty.</h2><p>Wikis let you write longer-form content about your project: design notes, getting-started guides, references, anything that doesn't fit a README. Create the first page on <a href="/${escapeAttr(owner)}/${escapeAttr(repo)}/wiki" data-oldgh-show-native>GitHub's wiki editor</a>.</p></div>`
      : "";
  if (!bodyEl && !isEmptyWiki) {
    throw new AdapterFailure("getWiki", "no .markdown-body found");
  }

  const pages: WikiPageRef[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("#wiki-pages-box a, #wiki-rightbar a, .wiki-pages-list a"))) {
    const href = a.getAttribute("href") || "";
    const title = a.textContent?.trim() || "";
    if (!title || !href || href.startsWith("#") || seen.has(href)) continue;
    // reject custom-sidebar in-page fragment links like /owner/repo/wiki#about
    if (href.includes("#")) continue;
    if (!href.includes("/wiki")) continue;
    seen.add(href);
    pages.push({ title, href });
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.wiki.git`;
  return { owner, repo, pageTitle, metaText, bodyHtml, pages, cloneUrl };
}
