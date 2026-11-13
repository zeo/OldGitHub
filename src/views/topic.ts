import { octicon } from "@/icons";
import { fetchPageDoc } from "@/adapters/_page";
import { formatCount } from "@/util/format";
import { AdapterFailure } from "@/adapters";
import { absoluteTime, relativeTime } from "@/util/time";
import { languageColor } from "@/util/language-color";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-topic";

type TopicMeta = {
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  facts: { label: string; value: string }[];
  related: string[];
};

type TopicRepo = {
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number | null;
  updatedAt: string;
};

type TopicPage = { meta: TopicMeta; repos: TopicRepo[]; totalCount: number | null; page: number; hasNext: boolean };

export async function mountTopic(pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const segs = pathname.split("/").filter(Boolean);
  const slug = segs[1] || "";
  if (!slug) {
    const root = document.createElement("div");
    root.className = ROOT_CLASS;
    root.innerHTML = `<div class="oldgh-page"><p class="oldgh-topic__empty">No topic selected.</p></div>`;
    adoptBodyRoot(root, undefined, nav);
    return;
  }

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(slug);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const heroSlot = root.querySelector<HTMLElement>(".oldgh-topic__hero");
  const reposSlot = root.querySelector<HTMLElement>(".oldgh-topic__repos");
  if (!heroSlot || !reposSlot) return;
  try {
    const result = await fetchTopicPage(slug, search);
    heroSlot.innerHTML = renderHero(slug, result.meta);
    reposSlot.innerHTML = renderRepos(slug, search, result);
  } catch (err) {
    heroSlot.innerHTML = "";
    reposSlot.innerHTML = `<p class="oldgh-topic__empty">Couldn't load this topic: ${escapeText(err instanceof Error ? err.message : String(err))}</p>`;
    return;
  }
  bindSort(root);
}

// github's topic page is server-rendered and takes the same s, o, l and page params
async function fetchTopicPage(slug: string, search: string): Promise<TopicPage> {
  const params = new URLSearchParams(search);
  const query = params.toString();
  const doc = await fetchPageDoc(`https://github.com/topics/${encodeURIComponent(slug)}${query ? `?${query}` : ""}`);
  const main = doc.querySelector("main");
  if (!main) throw new AdapterFailure("getTopic", `topic ${slug} page has no content`);

  const intro = main.querySelector(".markdown-body")?.closest(".border");
  const relatedHeading = Array.from(main.querySelectorAll("h2")).find((h) => /related topics/i.test(h.textContent ?? ""));
  const facts = Array.from(main.querySelectorAll("p")).flatMap((p) => {
    const label = text(p.querySelector(":scope > span.color-fg-muted"));
    if (label !== "Created by" && label !== "Released") return [];
    return [{ label, value: text(p).slice(label.length).trim() }];
  });
  const meta: TopicMeta = {
    displayName: text(main.querySelector("h1")) || slug,
    description: text(intro?.querySelector(".markdown-body")) || null,
    logoUrl: intro?.querySelector("img")?.getAttribute("src") ?? null,
    facts,
    related: Array.from(relatedHeading?.parentElement?.querySelectorAll("a.topic-tag") ?? [], (a) => text(a)).filter(Boolean),
  };

  const repos = Array.from(main.querySelectorAll("article")).flatMap((art) => {
    const [ownerLink, repoLink] = Array.from(art.querySelectorAll("h3 a"));
    const owner = text(ownerLink);
    const name = text(repoLink);
    if (!owner || !name) return [];
    const lang = art.querySelector('[itemprop="programmingLanguage"]');
    const stars = art.querySelector('[aria-label$="users starred this repository"]')?.getAttribute("title") ?? "";
    return [{
      owner,
      name,
      description: text(art.querySelector(".rounded-bottom-2 p")) || null,
      language: text(lang) || null,
      languageColor: lang?.previousElementSibling?.getAttribute("style")?.match(/background-color:\s*(#[0-9a-f]{3,8})/i)?.[1] ?? null,
      stars: stars ? Number(stars.replace(/,/g, "")) : null,
      updatedAt: art.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? "",
    }];
  });
  const total = Array.from(main.querySelectorAll("h2"), (h) => /([\d,]+)\s+public repositor/.exec(text(h))?.[1]).find(Boolean);
  return {
    meta,
    repos,
    totalCount: total ? Number(total.replace(/,/g, "")) : null,
    page: Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1),
    hasNext: main.querySelector('form.ajax-pagination-form input[name="page"]') !== null,
  };
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function renderShell(slug: string): string {
  return `
    <div class="oldgh-page">
      <div class="oldgh-topic__hero">
        <header class="oldgh-topic__hero-loading">
          <h1>${octicon("tag", { size: 22 })} ${escapeText(slug)}</h1>
          <p>Loading topic&hellip;</p>
        </header>
      </div>
      <div class="oldgh-topic__repos">
        <div class="oldgh-topic__loading">Loading repositories&hellip;</div>
      </div>
    </div>
  `;
}

function renderHero(slug: string, meta: TopicMeta): string {
  const facts = meta.facts.map((f) => `<li>${escapeText(f.label)} <strong>${escapeText(f.value)}</strong></li>`).join("");
  const related = meta.related.map((t) => `<li><a href="/topics/${escapeAttr(t)}">${escapeText(t)}</a></li>`).join("");
  return `
    <header class="oldgh-topic__hero-card">
      ${meta.logoUrl ? `<img class="oldgh-topic__logo" src="${escapeAttr(meta.logoUrl)}" width="64" height="64" alt="" />` : ""}
      <div class="oldgh-topic__hero-main">
        <h1 class="oldgh-topic__title">
          ${octicon("tag", { size: 22 })}
          ${escapeText(meta.displayName)}
          ${meta.displayName.toLowerCase() !== slug.toLowerCase() ? `<code class="oldgh-topic__slug">${escapeText(slug)}</code>` : ""}
        </h1>
        ${meta.description ? `<p class="oldgh-topic__short">${escapeText(meta.description)}</p>` : ""}
        ${facts ? `<ul class="oldgh-topic__meta">${facts}</ul>` : ""}
        ${related ? `<ul class="oldgh-topic__meta"><li>Related</li>${related}</ul>` : ""}
      </div>
    </header>
  `;
}

function renderRepos(slug: string, search: string, result: TopicPage): string {
  const { repos, totalCount, page, hasNext } = result;
  if (repos.length === 0) {
    return `
      <div class="oldgh-topic__empty">
        ${octicon("repo", { size: 36 })}
        <p>No public repositories use this topic${page > 1 ? " past this page" : ""}.</p>
      </div>
    `;
  }
  const sort = new URLSearchParams(search).get("s") ?? "best-match";
  const pageHref = (n: number): string => {
    const params = new URLSearchParams(search);
    if (n > 1) params.set("page", String(n));
    else params.delete("page");
    const q = params.toString();
    return `/topics/${encodeURIComponent(slug)}${q ? `?${q}` : ""}`;
  };
  return `
    <div class="oldgh-topic__bar">
      <div class="oldgh-topic__count">${totalCount !== null ? `<strong>${formatCount(totalCount)}</strong> ${totalCount === 1 ? "repository" : "repositories"}` : ""}</div>
      <label class="oldgh-topic__sort">
        <span>Sort:</span>
        <select data-oldgh-topic-sort>
          <option value="best-match"${sort === "best-match" ? " selected" : ""}>Best match</option>
          <option value="stars"${sort === "stars" ? " selected" : ""}>Most stars</option>
          <option value="forks"${sort === "forks" ? " selected" : ""}>Most forks</option>
          <option value="updated"${sort === "updated" ? " selected" : ""}>Recently updated</option>
        </select>
      </label>
    </div>
    <ul class="oldgh-topic__repo-list">
      ${repos.map(renderRepoRow).join("")}
    </ul>
    ${page > 1 || hasNext ? `
      <nav class="oldgh-topic__pager">
        ${page > 1 ? `<a href="${escapeAttr(pageHref(page - 1))}">‹ Previous</a>` : "<span></span>"}
        <span>Page ${page}</span>
        ${hasNext ? `<a href="${escapeAttr(pageHref(page + 1))}">Next ›</a>` : "<span></span>"}
      </nav>` : ""}
  `;
}

function renderRepoRow(r: TopicRepo): string {
  return `
    <li class="oldgh-topic__repo">
      <h2 class="oldgh-topic__repo-title">
        <a href="/${escapeAttr(r.owner)}">${escapeText(r.owner)}</a>
        <span class="oldgh-topic__repo-slash">/</span>
        <a href="/${escapeAttr(r.owner)}/${escapeAttr(r.name)}"><strong>${escapeText(r.name)}</strong></a>
      </h2>
      ${r.description ? `<p class="oldgh-topic__repo-desc">${escapeText(r.description)}</p>` : ""}
      <ul class="oldgh-topic__repo-meta">
        ${r.language ? `<li><span class="oldgh-search__lang-dot" style="background:${escapeAttr(r.languageColor ?? languageColor(r.language))}"></span>${escapeText(r.language)}</li>` : ""}
        ${r.stars !== null ? `<li>${octicon("star", { size: 12 })} ${formatCount(r.stars)}</li>` : ""}
        ${r.updatedAt ? `<li>Updated <time datetime="${escapeAttr(r.updatedAt)}" title="${escapeAttr(absoluteTime(r.updatedAt))}">${escapeText(relativeTime(r.updatedAt))}</time></li>` : ""}
      </ul>
    </li>
  `;
}

function bindSort(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("select[data-oldgh-topic-sort]");
  if (!select) return;
  select.addEventListener("change", () => {
    const params = new URLSearchParams(window.location.search);
    const value = select.value;
    params.delete("page");
    if (value === "best-match") {
      params.delete("s");
      params.delete("o");
    } else {
      params.set("s", value);
      params.set("o", "desc");
    }
    const href = `${window.location.pathname}?${params.toString()}`;
    history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
