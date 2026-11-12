import { octicon } from "@/icons";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-marketplace";

type MarketItem = {
  kind: "action" | "app";
  slug: string;
  name: string;
  tagline: string | null;
  iconUrl: string | null;
  iconBg: string | null;
  category: string | null;
  verified: boolean;
  pricing: string | null;
  url: string;
};

type MarketSection = {
  title: string;
  href: string | null;
  items: MarketItem[];
};

type MarketCategory = {
  slug: string;
  label: string;
  count: number | null;
  href: string;
  icon: string | null;
};

type MarketView = {
  type: "all" | "actions" | "apps";
  sections: MarketSection[];
  categories: MarketCategory[];
  popularActions: MarketItem[];
  popularApps: MarketItem[];
};

export async function mountMarketplace(_pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const params = new URLSearchParams(search);
  const type = mapType(params.get("type"));
  const category = params.get("category") || "";

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(type, category);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  try {
    const view = await scrapeMarketplace(type, category);
    const mainSlot = root.querySelector<HTMLElement>(".oldgh-marketplace__main");
    if (mainSlot) mainSlot.innerHTML = renderMain(view);
    const railSlot = root.querySelector<HTMLElement>(".oldgh-marketplace__rail");
    if (railSlot) railSlot.innerHTML = renderRail(view, category);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const mainSlot = root.querySelector<HTMLElement>(".oldgh-marketplace__main");
    if (mainSlot) mainSlot.innerHTML = `<div class="oldgh-marketplace__error">Couldn't load Marketplace: ${escapeText(msg)}</div>`;
  }
}

export function unmountMarketplace(): void {
  removeAllBodyRoots();
}

function mapType(raw: string | null): "all" | "actions" | "apps" {
  if (raw === "actions") return "actions";
  if (raw === "apps") return "apps";
  return "all";
}

async function scrapeMarketplace(type: "all" | "actions" | "apps", category: string): Promise<MarketView> {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (category) params.set("category", category);
  const url = `https://github.com/marketplace${params.toString() ? "?" + params.toString() : ""}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) throw new Error(`marketplace responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const sections: MarketSection[] = [];
  // Heuristic: find <h2>...</h2> followed by a list of marketplace cards
  for (const heading of Array.from(doc.querySelectorAll<HTMLElement>("h2"))) {
    const title = heading.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!title || title.length > 80) continue;
    if (!/popular|trending|new|recently|featured|verified|category|all/i.test(title)) continue;
    const container = heading.parentElement;
    if (!container) continue;
    // Look at the next sibling element with a grid/list of cards
    let cardsEl: Element | null = null;
    let next: Element | null = container.nextElementSibling;
    let safety = 0;
    while (next && safety < 4) {
      if (next.querySelectorAll("a[href*='/marketplace/']").length >= 3) {
        cardsEl = next;
        break;
      }
      next = next.nextElementSibling;
      safety++;
    }
    if (!cardsEl) {
      cardsEl = container.querySelector(".d-grid, ul, .Box, [class*='grid']");
    }
    if (!cardsEl) continue;
    const items = extractItems(cardsEl);
    if (items.length === 0) continue;
    const moreLink = container.querySelector<HTMLAnchorElement>("a[href*='/marketplace']:not([href$='/marketplace'])");
    const href = moreLink?.getAttribute("href") || null;
    if (sections.some((s) => s.title.toLowerCase() === title.toLowerCase())) continue;
    sections.push({ title, href, items: items.slice(0, 9) });
    if (sections.length >= 6) break;
  }

  // Fallback: just grab whatever marketplace items we can find on the page
  if (sections.length === 0) {
    const items = extractItems(doc.body);
    if (items.length > 0) {
      sections.push({
        title: type === "actions" ? "Actions" : type === "apps" ? "Apps" : "Marketplace",
        href: null,
        items: items.slice(0, 24),
      });
    }
  }

  const categories = extractCategories(doc);
  const popularActions = sections.find((s) => /action/i.test(s.title))?.items ?? [];
  const popularApps = sections.find((s) => /app/i.test(s.title))?.items ?? [];

  return { type, sections, categories, popularActions, popularApps };
}

function extractItems(scope: Element): MarketItem[] {
  const out: MarketItem[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/marketplace\/(actions|apps)\/([\w.-]+)/.exec(href);
    if (!m) continue;
    const kind = (m[1] === "actions" ? "action" : "app") as "action" | "app";
    const slug = m[2]!;
    if (seen.has(`${kind}:${slug}`)) continue;

    // The whole card is probably the closest LI or article
    const card = a.closest("li, article, .Box, .d-flex") || a;
    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    // Name: prefer headings, fall back to anchor text without the tagline
    const heading = card.querySelector<HTMLElement>("h3, h4, .h3, .h4, .h5, [data-testid*='name']");
    const name = (heading?.textContent || a.textContent || "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) continue;

    // Tagline: a paragraph or sibling with short description
    const tagEl = card.querySelector<HTMLElement>("p, .color-fg-muted, [data-testid*='description']");
    const tagline = tagEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    if (tagline && tagline === name) continue;

    const img = card.querySelector<HTMLImageElement>("img");
    const iconUrl = img?.getAttribute("src") || null;
    const iconWrap = card.querySelector<HTMLElement>(".d-flex.flex-items-center [style*='background'], [style*='background-color']");
    const iconBgStyle = iconWrap?.getAttribute("style") || "";
    const bgMatch = /background(?:-color)?:\s*([^;]+)/.exec(iconBgStyle);
    const iconBg = bgMatch?.[1]?.trim() ?? null;

    const verified = !!card.querySelector("svg.octicon-verified, [aria-label*='Verified']");
    // .color-fg-success is too generic (verified label, "Free"/"Installed" share it) so it gets dropped to avoid mislabeling pricing
    const pricingEl = card.querySelector<HTMLElement>("[data-testid*='pricing'], [class*='pricing']");
    const pricing = pricingEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    const categoryEl = card.querySelector<HTMLElement>("[data-testid*='category'], [class*='category']");
    const category = categoryEl?.textContent?.replace(/\s+/g, " ").trim() || null;

    seen.add(`${kind}:${slug}`);
    out.push({
      kind,
      slug,
      name,
      tagline: tagline && tagline.length < 240 ? tagline : null,
      iconUrl,
      iconBg,
      category,
      verified,
      pricing,
      url: href,
    });
    if (out.length >= 60) break;
  }
  return out;
}

function extractCategories(doc: Document): MarketCategory[] {
  const out: MarketCategory[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href*='category=']"))) {
    const href = a.getAttribute("href") || "";
    const m = /category=([\w.-]+)/.exec(href);
    if (!m) continue;
    const slug = m[1]!;
    if (seen.has(slug)) continue;
    const label = a.textContent?.replace(/\s+/g, " ").trim() || slug;
    if (!label || label.length > 64) continue;
    // derive count and label from one trailing match so "CI (2) tools (123)" keeps the right count
    const tail = /\s*\((\d[\d,]*)\)\s*$/.exec(label);
    const count = tail ? parseInt(tail[1]!.replace(/,/g, ""), 10) : null;
    const cleanLabel = tail ? label.slice(0, tail.index).trim() : label;
    if (!cleanLabel) continue;
    seen.add(slug);
    out.push({
      slug,
      label: cleanLabel,
      count,
      href: `/marketplace?category=${encodeURIComponent(slug)}`,
      icon: null,
    });
    if (out.length >= 20) break;
  }
  return out;
}

function renderShell(type: "all" | "actions" | "apps", category: string): string {
  const subnav: Array<{ key: typeof type; label: string; icon: string }> = [
    { key: "all", label: "All", icon: "package" },
    { key: "actions", label: "Actions", icon: "zap" },
    { key: "apps", label: "Apps", icon: "plug" },
  ];
  return `
    <div class="oldgh-page oldgh-marketplace__page">
      <header class="oldgh-marketplace__hero">
        <h1>${octicon("package", { size: 26 })} GitHub Marketplace</h1>
        <p>Find the apps and actions to extend your GitHub workflow — CI/CD, code quality, project management, deployment.</p>
        <form class="oldgh-marketplace__search" action="/marketplace" method="get">
          ${type !== "all" ? `<input type="hidden" name="type" value="${escapeAttr(type)}" />` : ""}
          ${category ? `<input type="hidden" name="category" value="${escapeAttr(category)}" />` : ""}
          <input name="query" type="search" placeholder="Search Marketplace…" autocomplete="off" />
          <button type="submit" class="oldgh-btn oldgh-btn--primary">${octicon("search", { size: 14 })}<span>Search</span></button>
        </form>
        <nav class="oldgh-marketplace__subnav">
          ${subnav.map((t) => `<a class="${type === t.key ? "is-active" : ""}" href="/marketplace${t.key === "all" ? "" : "?type=" + t.key}">${octicon(t.icon, { size: 14 })}<span>${escapeText(t.label)}</span></a>`).join("")}
        </nav>
      </header>
      <div class="oldgh-marketplace__layout">
        <div class="oldgh-marketplace__main">
          <div class="oldgh-marketplace__loading">Loading Marketplace…</div>
        </div>
        <aside class="oldgh-marketplace__rail"></aside>
      </div>
    </div>
  `;
}

function renderMain(v: MarketView): string {
  if (v.sections.length === 0) {
    return `
      <div class="oldgh-marketplace__empty">
        <p>We couldn't render this Marketplace view in the classic layout.</p>
        <p><a href="javascript:void(0)" data-oldgh-show-native>Show GitHub's Marketplace page instead</a>.</p>
      </div>
    `;
  }
  return v.sections.map(renderSection).join("");
}

function renderSection(s: MarketSection): string {
  return `
    <section class="oldgh-marketplace__section">
      <header class="oldgh-marketplace__section-head">
        <h2>${escapeText(s.title)}</h2>
        ${s.href ? `<a class="oldgh-marketplace__more" href="${escapeAttr(s.href)}">See all &rsaquo;</a>` : ""}
      </header>
      <ul class="oldgh-marketplace__grid">
        ${s.items.map(renderItem).join("")}
      </ul>
    </section>
  `;
}

function renderItem(it: MarketItem): string {
  const iconStyle = it.iconBg ? `style="background:${escapeAttr(it.iconBg)}"` : "";
  const icon = it.iconUrl
    ? `<img class="oldgh-marketplace__icon" src="${escapeAttr(it.iconUrl)}" alt="" />`
    : `<span class="oldgh-marketplace__icon-placeholder">${octicon(it.kind === "action" ? "zap" : "plug", { size: 18 })}</span>`;
  return `
    <li class="oldgh-marketplace__card">
      <a class="oldgh-marketplace__card-link" href="${escapeAttr(it.url)}">
        <div class="oldgh-marketplace__icon-wrap" ${iconStyle}>${icon}</div>
        <div class="oldgh-marketplace__card-body">
          <h3 class="oldgh-marketplace__card-name">
            ${escapeText(it.name)}
            ${it.verified ? `<span class="oldgh-marketplace__verified" title="Verified publisher">${octicon("verified", { size: 12 })}</span>` : ""}
          </h3>
          ${it.tagline ? `<p class="oldgh-marketplace__card-tagline">${escapeText(it.tagline)}</p>` : ""}
          <div class="oldgh-marketplace__card-meta">
            <span class="oldgh-marketplace__kind oldgh-marketplace__kind--${it.kind}">${it.kind === "action" ? octicon("zap", { size: 11 }) : octicon("plug", { size: 11 })} ${it.kind === "action" ? "Action" : "App"}</span>
            ${it.pricing ? `<span>${escapeText(it.pricing)}</span>` : ""}
            ${it.category ? `<span>${escapeText(it.category)}</span>` : ""}
          </div>
        </div>
      </a>
    </li>
  `;
}

function renderRail(v: MarketView, activeCategory: string): string {
  const categoriesHtml = v.categories.length > 0
    ? `
      <div class="oldgh-marketplace__sidebox">
        <h3>${octicon("list-unordered", { size: 12 })} Categories</h3>
        <ul>
          ${activeCategory ? `<li><a href="/marketplace">${octicon("x", { size: 12 })} Clear filter</a></li>` : ""}
          ${v.categories.map((c) => `
            <li class="${c.slug === activeCategory ? "is-active" : ""}">
              <a href="${escapeAttr(c.href)}">${escapeText(c.label)}${c.count !== null ? `<span class="oldgh-marketplace__cat-count">${c.count.toLocaleString()}</span>` : ""}</a>
            </li>
          `).join("")}
        </ul>
      </div>
    `
    : "";
  return `
    ${categoriesHtml}
    <div class="oldgh-marketplace__sidebox">
      <h3>${octicon("light-bulb", { size: 12 })} What's here?</h3>
      <p class="oldgh-marketplace__about">
        <strong>Actions</strong> automate CI/CD, releases, dependency upgrades, deployments — anything you can script.
        <br><br>
        <strong>Apps</strong> add features like code review tools, project trackers, and integrations with services outside GitHub.
      </p>
    </div>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
