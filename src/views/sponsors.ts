import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-sponsors";

type Sponsorable = {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  type: "User" | "Organization";
  url: string;
  tagline: string | null;
};

export async function mountSponsors(_pathname: string, _search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell();
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const slot = root.querySelector<HTMLElement>(".oldgh-sponsors__grid-slot");
  if (!slot) return;

  try {
    const list = await scrapeSponsors();
    slot.innerHTML = renderGrid(list);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slot.innerHTML = `<div class="oldgh-sponsors__empty">Couldn't load sponsors directory: ${escapeText(msg)}</div>`;
  }
}

async function scrapeSponsors(): Promise<Sponsorable[]> {
  const resp = await fetch("https://github.com/sponsors/explore", {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) throw new Error(`responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const out: Sponsorable[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/sponsors\/([\w.-]+)(?:[?#]|$)/.exec(href);
    if (!m) continue;
    const login = m[1]!;
    if (login === "explore" || login === "accounts") continue;
    if (seen.has(login)) continue;
    const card = a.closest("li, article, .Box-row, .d-flex") || a;
    const avatarImg = card.querySelector<HTMLImageElement>("img.avatar-user, img.avatar, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || `https://github.com/${login}.png?size=120`;
    const nameEl = card.querySelector<HTMLElement>("h3, h4, .h3, .h4, [class*='heading']");
    const name = nameEl?.textContent?.trim() || null;
    const bioEl = card.querySelector<HTMLElement>("p.color-fg-muted, [class*='bio'], .user-profile-bio");
    const bio = bioEl?.textContent?.trim() || null;
    const taglineEl = card.querySelector<HTMLElement>("p.lh-condensed, [class*='tagline'], [class*='listing']");
    const tagline = taglineEl?.textContent?.trim() || null;
    const isOrg = !!card.querySelector("svg.octicon-organization, [aria-label*='Organization']");
    seen.add(login);
    out.push({
      login,
      name: name && name !== login ? name : null,
      avatarUrl,
      bio,
      type: isOrg ? "Organization" : "User",
      url: `/sponsors/${login}`,
      tagline: tagline && tagline.length > 8 && tagline !== bio ? tagline : null,
    });
    if (out.length >= 40) break;
  }
  return out;
}

function renderShell(): string {
  return `
    <div class="oldgh-page oldgh-sponsors__page">
      <header class="oldgh-sponsors__hero">
        <h1>${octicon("heart", { size: 26 })} GitHub Sponsors</h1>
        <p>Open source projects rely on the labour of maintainers. Sponsors directly fund the people who build software that runs the world.</p>
        <nav class="oldgh-sponsors__hero-nav">
          <a href="/sponsors/explore" class="is-active">${octicon("telescope", { size: 14 })}<span>Explore</span></a>
          <a href="https://github.com/sponsors">${octicon("info", { size: 14 })}<span>About Sponsors</span></a>
        </nav>
      </header>
      <section class="oldgh-sponsors__section">
        <header class="oldgh-sponsors__section-head">
          <h2>${octicon("flame", { size: 14 })} Featured sponsorable accounts</h2>
        </header>
        <div class="oldgh-sponsors__grid-slot">
          <div class="oldgh-sponsors__loading">Loading sponsorable accounts&hellip;</div>
        </div>
      </section>
    </div>
  `;
}

function renderGrid(items: Sponsorable[]): string {
  if (items.length === 0) {
    return `<div class="oldgh-sponsors__empty">No sponsorable accounts to show right now.</div>`;
  }
  return `
    <ul class="oldgh-sponsors__grid">
      ${items.map(renderCard).join("")}
    </ul>
  `;
}

function renderCard(s: Sponsorable): string {
  return `
    <li class="oldgh-sponsors__card">
      <a class="oldgh-sponsors__avatar" href="${escapeAttr(s.url)}" aria-label="View sponsorship page for ${escapeAttr(s.login)}">
        <img src="${escapeAttr(s.avatarUrl)}" width="64" height="64" alt="" />
      </a>
      <div class="oldgh-sponsors__body">
        <h3 class="oldgh-sponsors__name">
          ${s.name ? `<a href="${escapeAttr(s.url)}"><strong>${escapeText(s.name)}</strong></a>` : ""}
          <a class="oldgh-sponsors__login" href="${escapeAttr(s.url)}">@${escapeText(s.login)}</a>
          ${s.type === "Organization" ? `<span class="oldgh-sponsors__type">${octicon("organization", { size: 11 })} Org</span>` : ""}
        </h3>
        ${s.tagline ? `<p class="oldgh-sponsors__tagline">${escapeText(s.tagline)}</p>` : ""}
        ${s.bio ? `<p class="oldgh-sponsors__bio">${escapeText(s.bio)}</p>` : ""}
        <a class="oldgh-btn oldgh-sponsors__btn" href="${escapeAttr(s.url)}">${octicon("heart", { size: 12 })}<span>Sponsor</span></a>
      </div>
    </li>
  `;
}
