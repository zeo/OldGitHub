import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { currentUserLogin } from "@/auth/session";
import { fetchPageDoc, pageLinks } from "@/adapters/_page";
import { languageColor } from "@/util/language-color";
import { absoluteTime, relativeTime } from "@/util/time";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-stars";

type StarredRepo = {
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: string;
  forks: string;
  updatedAt: string;
};

type Choice = { value: string; label: string };

type StarsPage = {
  repos: StarredRepo[];
  total: string | null;
  sorts: (Choice & { checked: boolean })[];
  languages: Choice[];
  prev: string | null;
  next: string | null;
};

// github's stars tab takes these and returns the next and previous cursors in its pager
const PASSTHROUGH = ["sort", "direction", "language", "after", "before"];

export async function mountStars(pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;

  const segs = pathname.split("/").filter(Boolean);
  const login = segs[0] === "stars" && segs[1] ? segs[1] : currentUserLogin();
  if (!login) {
    root.innerHTML = `
      <div class="oldgh-page">
        <header class="oldgh-stars__header"><h1>Stars</h1></header>
        <p class="oldgh-stars__empty">Sign in to view your starred repositories.</p>
      </div>
    `;
    adoptBodyRoot(root, undefined, nav);
    return;
  }

  root.innerHTML = `
    <div class="oldgh-page">
      <header class="oldgh-stars__header">
        <h1>${octicon("star", { size: 22 })} ${escapeText(login)}'s Stars</h1>
        <p class="oldgh-stars__sub">Repositories starred by <a href="/${escapeAttr(login)}">${escapeText(login)}</a></p>
      </header>
      <div class="oldgh-stars__loading">Loading stars…</div>
    </div>
  `;
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const params = new URLSearchParams(search);
  const loading = root.querySelector(".oldgh-stars__loading");
  try {
    const page = await fetchStarsPage(login, params);
    loading?.remove();
    const layout = document.createElement("div");
    layout.className = "oldgh-stars__layout";
    layout.innerHTML = renderLayout(page, pathname, params);
    root.querySelector(".oldgh-page")?.appendChild(layout);
    bindStarsSort(layout);
  } catch (err) {
    if (loading) loading.textContent = `Couldn't load stars: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function fetchStarsPage(login: string, params: URLSearchParams): Promise<StarsPage> {
  const query = new URLSearchParams({ tab: "stars" });
  for (const key of PASSTHROUGH) {
    const v = params.get(key);
    if (v) query.set(key, v);
  }
  const doc = await fetchPageDoc(`https://github.com/${encodeURIComponent(login)}?${query}`);
  const frame = doc.querySelector("turbo-frame#user-starred-repos") ?? doc;

  const repos = Array.from(frame.querySelectorAll("h3 a[href^='/']")).flatMap((a) => {
    const m = /^\/([\w.-]+)\/([\w.-]+)\/?$/.exec(a.getAttribute("href") ?? "");
    const card = a.closest(".border-bottom");
    if (!m || !card) return [];
    const lang = card.querySelector("[itemprop='programmingLanguage']");
    return [{
      owner: m[1]!,
      name: m[2]!,
      description: text(card.querySelector("p[itemprop='description']")) || null,
      language: text(lang) || null,
      languageColor: card.querySelector<HTMLElement>(".repo-language-color")?.style.backgroundColor || null,
      stars: text(card.querySelector('a[href$="/stargazers"]')),
      forks: text(card.querySelector('a[href$="/forks"]')),
      updatedAt: card.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? "",
    }];
  });

  const sorts = Array.from(doc.querySelectorAll("#stars-sort-menu-list a[href]"), (a) => ({
    value: new URL(a.getAttribute("href")!, "https://github.com").searchParams.get("sort") ?? "",
    label: text(a),
    checked: a.getAttribute("aria-checked") === "true",
  })).filter((s) => s.value);

  const languages = Array.from(doc.querySelectorAll("#stars-language-filter-menu-list a[href]")).flatMap((a) => {
    const value = new URL(a.getAttribute("href")!, "https://github.com").searchParams.get("language");
    return value ? [{ value, label: text(a) }] : [];
  });

  const { prev, next } = pageLinks(frame);
  return {
    repos,
    // signed out the tab counter carries the exact count in a title, signed in only the rounded label
    total: doc.querySelector('a[href*="tab=stars"] .Counter[title]')?.getAttribute("title")
      ?? (text(doc.querySelector('a[data-tab-item="stars"] [data-component="CounterLabel"]')) || null),
    sorts,
    languages,
    prev,
    next,
  };
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function renderLayout(page: StarsPage, pathname: string, params: URLSearchParams): string {
  const language = params.get("language") ?? "";
  const hrefWith = (changes: Record<string, string | null>): string => {
    const next = new URLSearchParams(params);
    next.delete("after");
    next.delete("before");
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
  // github's pager links point at the profile tab; keep the cursor and stay on this view
  const pagerHref = (href: string): string => {
    const q = new URL(href, "https://github.com").searchParams;
    q.delete("tab");
    return `${pathname}?${q}`;
  };
  const activeLanguage = page.languages.find((l) => l.value === language)?.label ?? language;

  return `
    <aside class="oldgh-stars__sidebar">
      ${page.total ? `
        <div class="oldgh-stars__sidebox">
          <h3>${octicon("flame", { size: 14 })} Stats</h3>
          <ul class="oldgh-stars__stats">
            <li><strong>${escapeText(page.total)}</strong> ${page.total === "1" ? "repository" : "repositories"} starred</li>
          </ul>
        </div>` : ""}
      ${page.languages.length > 0 ? `
        <div class="oldgh-stars__sidebox">
          <h3>${octicon("code", { size: 14 })} Languages</h3>
          <ul class="oldgh-stars__lang-list">
            ${language ? `<li><a href="${escapeAttr(hrefWith({ language: null }))}">${octicon("x", { size: 12 })} Clear filter</a></li>` : ""}
            ${page.languages.map((l) => `
              <li class="${l.value === language ? "is-active" : ""}">
                <a href="${escapeAttr(hrefWith({ language: l.value }))}">
                  <span class="oldgh-search__lang-dot" style="background:${escapeAttr(languageColor(l.label))}"></span>
                  ${escapeText(l.label)}
                </a>
              </li>
            `).join("")}
          </ul>
        </div>` : ""}
    </aside>
    <main class="oldgh-stars__main">
      <div class="oldgh-stars__bar">
        <div class="oldgh-stars__count">
          ${language ? `Filtered by <strong>${escapeText(activeLanguage)}</strong>` : ""}
        </div>
        ${page.sorts.length > 0 ? `
          <label class="oldgh-stars__sort">
            <span>Sort:</span>
            <select data-oldgh-stars-sort>
              ${page.sorts.map((s) => `<option value="${escapeAttr(hrefWith({ sort: s.value, direction: "desc" }))}"${s.checked ? " selected" : ""}>${escapeText(s.label)}</option>`).join("")}
            </select>
          </label>` : ""}
      </div>
      ${renderList(page.repos, !!language)}
      ${page.prev || page.next ? `
        <nav class="oldgh-stars__pager">
          ${page.prev ? `<a href="${escapeAttr(pagerHref(page.prev))}">‹ Previous</a>` : "<span></span>"}
          ${page.next ? `<a href="${escapeAttr(pagerHref(page.next))}">Next ›</a>` : "<span></span>"}
        </nav>` : ""}
    </main>
  `;
}

function bindStarsSort(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>("select[data-oldgh-stars-sort]");
  select?.addEventListener("change", () => {
    history.pushState({}, "", select.value);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function renderList(items: StarredRepo[], isFiltered: boolean): string {
  if (items.length === 0) {
    const msg = isFiltered ? "No starred repositories match this language." : "No starred repositories yet.";
    return `<p class="oldgh-stars__empty">${octicon("star", { size: 36 })} ${msg}</p>`;
  }
  return `
    <ul class="oldgh-stars__list">
      ${items.map(renderRow).join("")}
    </ul>
  `;
}

function renderRow(r: StarredRepo): string {
  return `
    <li class="oldgh-stars__row">
      <h2 class="oldgh-stars__name">
        <img class="oldgh-stars__avatar" src="https://github.com/${escapeAttr(r.owner)}.png?size=40" width="20" height="20" alt="" />
        <a href="/${escapeAttr(r.owner)}">${escapeText(r.owner)}</a> /
        <a href="/${escapeAttr(r.owner)}/${escapeAttr(r.name)}"><strong>${escapeText(r.name)}</strong></a>
      </h2>
      ${r.description ? `<p class="oldgh-stars__desc">${escapeText(r.description)}</p>` : ""}
      <ul class="oldgh-stars__meta">
        ${r.language ? `<li><span class="oldgh-search__lang-dot" style="background:${escapeAttr(r.languageColor ?? languageColor(r.language))}"></span>${escapeText(r.language)}</li>` : ""}
        ${r.stars ? `<li>${octicon("star", { size: 12 })} ${escapeText(r.stars)}</li>` : ""}
        ${r.forks ? `<li>${octicon("repo-forked", { size: 12 })} ${escapeText(r.forks)}</li>` : ""}
        ${r.updatedAt ? `<li>Updated <time datetime="${escapeAttr(r.updatedAt)}" title="${escapeAttr(absoluteTime(r.updatedAt))}">${escapeText(relativeTime(r.updatedAt))}</time></li>` : ""}
      </ul>
    </li>
  `;
}
