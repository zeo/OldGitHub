import { AdapterFailure } from "./index";
import { readFollowForms, type FollowForms } from "./social";

export type ProfileKind = "user" | "org";

export type PinnedRepo = {
  nwo: string;
  href: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: string | null;
  forks: string | null;
  isPrivate: boolean;
};

export type ProfileOrg = {
  login: string;
  avatarUrl: string;
};

export type AchievementBadge = {
  name: string;
  iconUrl: string;
  href: string;
};

export type ProfileHighlights = {
  proPlan: boolean;
  devProgramMember: boolean;
  starWaveSpotted: boolean;
};

export type ContributionYear = {
  year: number;
  href: string;
  isActive: boolean;
};

export type ProfileView = {
  login: string;
  kind: ProfileKind;
  avatarUrl: string;
  displayName: string;
  bio: string | null;
  homepage: string | null;
  location: string | null;
  followersCount: string | null;
  followingCount: string | null;
  repoCountHint: number | null;
  contributionHeading: string | null;
  contributionGraphHtml: string | null;
  contributionYears: ContributionYear[];
  pinned: PinnedRepo[];
  orgs: ProfileOrg[];
  achievements: AchievementBadge[];
  highlights: ProfileHighlights;
  isViewer: boolean;
  follow: FollowForms | null;
};

export async function getProfile(login: string, query: string = ""): Promise<ProfileView> {
  // pass through ?from=YYYY-12-01&to=YYYY-12-31 (and tab=overview) so the
  // server returns the contribution graph for the requested year.
  const params = new URLSearchParams(query);
  const passthrough = new URLSearchParams();
  for (const k of ["from", "to", "tab"]) {
    const v = params.get(k);
    if (v) passthrough.set(k, v);
  }
  const qs = passthrough.toString();
  const url = `https://github.com/${login}${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getProfile", `/${login} responded ${resp.status}`);
  }
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const profileUsername = meta(doc, "profile:username");
  if (!profileUsername) {
    throw new AdapterFailure("getProfile", "missing profile:username meta");
  }

  const hovercard = meta(doc, "hovercard-subject-tag");
  const kind: ProfileKind = hovercard?.startsWith("organization:") ? "org" : "user";

  const avatarUrl = meta(doc, "og:image") ?? `https://github.com/${profileUsername}.png?size=400`;

  const ogTitle = meta(doc, "og:title") ?? profileUsername;
  const displayName = extractDisplayName(doc, ogTitle, profileUsername);

  const ogDescription = meta(doc, "og:description") ?? "";
  const repoHintMatch = /\bhas (\d+(?:,\d+)*)\s+repositor/i.exec(ogDescription);
  const repoCountHint = repoHintMatch && repoHintMatch[1]
    ? parseInt(repoHintMatch[1].replace(/,/g, ""), 10)
    : null;

  const orgBio = kind === "org" && ogDescription
    ? ogDescription.replace(/\s+GitHub is where .+? builds software\.?\s*$/i, "").trim()
    : null;
  const userBioEl = doc.querySelector<HTMLElement>(".user-profile-bio, [data-bio-text]");
  const userBio = userBioEl?.textContent?.trim() || null;
  const bio = orgBio || userBio;

  const homepageEl = doc.querySelector<HTMLAnchorElement>('li[itemprop="url"] a, [data-test-selector="profile-website-url"] a');
  const homepage = homepageEl?.href || null;

  const locationEl = doc.querySelector<HTMLElement>('li[itemprop="homeLocation"] span, [itemprop="homeLocation"]');
  const location = locationEl?.textContent?.trim() || null;

  let contributionGraphHtml = extractContributionGraph(doc);
  let contributionHeading = normalizeWhitespace(doc.querySelector(".js-yearly-contributions h2")?.textContent || "") || null;
  if (!contributionGraphHtml && kind === "user") {
    const fetched = await fetchContributionFragment(profileUsername, passthrough.get("from"), passthrough.get("to"));
    if (fetched) {
      contributionGraphHtml = fetched.tableHtml;
      contributionHeading = fetched.heading ?? contributionHeading;
    }
  }
  const contributionYears = extractContributionYears(doc, profileUsername, passthrough.get("from"));

  return {
    login: profileUsername,
    kind,
    avatarUrl,
    displayName,
    bio,
    homepage,
    location,
    followersCount: readCountFromTabLink(doc, "followers"),
    followingCount: readCountFromTabLink(doc, "following"),
    repoCountHint,
    contributionHeading,
    contributionGraphHtml,
    contributionYears,
    pinned: readPinned(doc),
    orgs: readOrgs(doc),
    achievements: readAchievements(doc, profileUsername),
    highlights: readHighlights(doc),
    isViewer: !!doc.querySelector('a[href$="/account"]'),
    follow: readFollowForms(doc),
  };
}

function extractContributionYears(doc: Document, login: string, activeFrom: string | null): ContributionYear[] {
  // modern GH hydrates the year list lazily — the SSR'd profile no longer
  // contains <a data-year> anchors. try to read them anyway (Wayback / older
  // GH versions still have them), and fall back to a synthesized window.
  const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>(
    ".js-profile-timeline-year-list a, [data-tab-item][data-year], a[data-year]",
  ));
  const fromScrape = new Set<number>();
  for (const a of anchors) {
    const yearAttr = a.getAttribute("data-year");
    const year = yearAttr ? parseInt(yearAttr, 10) : NaN;
    if (!Number.isFinite(year) || year < 2007 || year > 2100) continue;
    fromScrape.add(year);
  }

  const currentYear = new Date().getUTCFullYear();
  const yearsDesc: number[] = fromScrape.size > 0
    ? Array.from(fromScrape).sort((a, b) => b - a)
    : Array.from({ length: 7 }, (_, i) => currentYear - i);

  // include the year the user is currently viewing even if it's outside the
  // synthesized window, so the active marker has somewhere to land.
  const viewing = activeFrom ? parseInt(activeFrom.slice(0, 4), 10) : currentYear;
  if (Number.isFinite(viewing) && !yearsDesc.includes(viewing)) {
    yearsDesc.push(viewing);
    yearsDesc.sort((a, b) => b - a);
  }

  return yearsDesc.map((year) => ({
    year,
    href: year === currentYear ? `/${login}` : `/${login}?from=${year}-12-01&to=${year}-12-31&tab=overview`,
    isActive: year === viewing,
  }));
}


async function fetchContributionFragment(login: string, from?: string | null, to?: string | null): Promise<{ tableHtml: string; heading: string | null } | null> {
  try {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const tail = qs.toString();
    const resp = await fetch(`https://github.com/users/${login}/contributions${tail ? `?${tail}` : ""}`, {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector<HTMLElement>("table.ContributionCalendar-grid, table.js-calendar-graph-table, .js-yearly-contributions table");
    if (!table) return null;
    const heading = normalizeWhitespace(doc.querySelector("h2")?.textContent || "") || null;
    const referencedIds = new Set<string>();
    for (const cell of Array.from(table.querySelectorAll<HTMLElement>("[aria-labelledby]"))) {
      const id = cell.getAttribute("aria-labelledby");
      if (id) referencedIds.add(id);
    }
    const tooltips: string[] = [];
    for (const id of referencedIds) {
      const tt = doc.querySelector(`#${cssIdentifierEscape(id)}`);
      if (tt) tooltips.push(tt.outerHTML);
    }
    return { tableHtml: table.outerHTML + tooltips.join(""), heading };
  } catch {
    return null;
  }
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function readHighlights(doc: Document): ProfileHighlights {
  const proPlan = !!doc.querySelector('[data-test-selector="profile-pro-button"]')
    || !!doc.querySelector('.user-profile-pro-button-label, .Label[data-view-component="true"][title*="Pro" i]')
    || /\bPRO\b/.test(doc.querySelector(".vcard-names + p, .h-card .Label")?.textContent || "");
  const devProgramMember = !!doc.querySelector('a[href$="#github-developer-program"]');
  const starWaveSpotted = !!doc.querySelector('a[href*="starwave"]');
  return { proPlan, devProgramMember, starWaveSpotted };
}

function extractDisplayName(doc: Document, ogTitle: string, login: string): string {
  // first source of truth: vcard-fullname element on the page sidebar. it's
  // rendered identically across every profile tab, so /:user?tab=stars and
  // /:user both surface the same display name from this element.
  const vcardName = doc.querySelector<HTMLElement>(".vcard-fullname, .p-name.vcard-fullname, [itemprop='name']")?.textContent?.replace(/\s+/g, " ").trim();
  if (vcardName && vcardName !== login) return vcardName;

  const TAB_NAMES = "Overview|Repositories|Stars|Followers|Following|Achievements|Projects|Packages|Sponsoring|People";
  // when viewing your own profile, GitHub flips the title to "Your <Tab>" —
  // that's a navigation breadcrumb, not the user's display name. discard it
  // entirely so we fall through to og:title / login.
  const isOwnerTitle = (s: string): boolean => new RegExp(`^Your (${TAB_NAMES})\\b`, "i").test(s.replace(/\s*·\s*GitHub\s*$/, "").trim());
  const stripTabSuffix = (s: string): string => s
    .replace(/\s*·\s*GitHub\s*$/, "")
    .replace(new RegExp(`\\s*[-–—]\\s*(${TAB_NAMES})\\s*$`), "")
    .trim();

  const rawTitle = doc.querySelector("title")?.textContent?.trim() ?? "";
  const title = isOwnerTitle(rawTitle) ? "" : stripTabSuffix(rawTitle);

  const parenMatch = /^(.+?)\s*\((.+?)\)\s*$/.exec(title);
  if (parenMatch && parenMatch[1] && parenMatch[2]) {
    const a = parenMatch[1].trim();
    const b = parenMatch[2].trim();
    if (a === login && b !== login) return b;
    if (b === login && a !== login) return a;
    if (a !== login) return a;
    return b;
  }

  const ogTrim = isOwnerTitle(ogTitle) ? "" : stripTabSuffix(ogTitle);
  const ogParen = /^(.+?)\s*\((.+?)\)\s*$/.exec(ogTrim);
  if (ogParen && ogParen[1] && ogParen[2]) {
    const a = ogParen[1].trim();
    const b = ogParen[2].trim();
    if (a === login && b !== login) return b;
    if (b === login && a !== login) return a;
    if (a !== login) return a;
    return b;
  }
  if (ogTrim && ogTrim !== login) return ogTrim;
  if (title && title !== login) return title;
  return login;
}

function extractContributionGraph(doc: Document): string | null {
  const container = doc.querySelector<HTMLElement>(".js-yearly-contributions");
  if (!container) return null;
  const table = container.querySelector<HTMLElement>("table");
  if (!table) return null;
  const referencedIds = new Set<string>();
  for (const cell of Array.from(table.querySelectorAll<HTMLElement>("[aria-labelledby]"))) {
    const id = cell.getAttribute("aria-labelledby");
    if (id) referencedIds.add(id);
  }
  const tooltips: string[] = [];
  for (const id of referencedIds) {
    const tt = container.querySelector(`#${cssIdentifierEscape(id)}`);
    if (tt) tooltips.push(tt.outerHTML);
  }
  return table.outerHTML + tooltips.join("");
}

function cssIdentifierEscape(s: string): string {
  return s.replace(/[^\w-]/g, "\\$&");
}

function meta(doc: Document, key: string): string | null {
  return doc.querySelector<HTMLMetaElement>(`meta[name="${key}"], meta[property="${key}"]`)?.content?.trim() ?? null;
}

function readCountFromTabLink(doc: Document, tab: string): string | null {
  const anchor = doc.querySelector<HTMLAnchorElement>(`a[href*="tab=${tab}"]`);
  if (!anchor) return null;
  const bold = anchor.querySelector(".text-bold, span.color-fg-default, strong");
  const text = bold?.textContent?.trim() || anchor.textContent?.trim()?.split(/\s+/)[0];
  return text || null;
}

function readPinned(doc: Document): PinnedRepo[] {
  const items = doc.querySelectorAll<HTMLElement>(".pinned-item-list-item");
  const out: PinnedRepo[] = [];
  for (const el of Array.from(items)) {
    const titleLink = el.querySelector<HTMLAnchorElement>('a[href]');
    const href = titleLink?.getAttribute("href") || "";
    if (!href || !href.includes("/")) continue;
    const nwo = href.replace(/^\//, "");
    const desc = el.querySelector(".pinned-item-desc, p.color-fg-muted")?.textContent?.trim() || null;
    const langEl = el.querySelector<HTMLElement>('[itemprop="programmingLanguage"]');
    const language = langEl?.textContent?.trim() || null;
    const langColor = el.querySelector<HTMLElement>(".repo-language-color");
    const languageColor = langColor ? langColor.style.backgroundColor || null : null;
    const starsEl = el.querySelector<HTMLAnchorElement>('a[href*="/stargazers"]');
    const stars = starsEl?.textContent?.trim() || null;
    const forksEl = el.querySelector<HTMLAnchorElement>('a[href*="/forks"], a[href*="/network/members"]');
    const forks = forksEl?.textContent?.trim() || null;
    // .Label--secondary alone is too permissive (also matches Forked / Mirror /
    // Template). check title attr first, then read label text.
    const labels = Array.from(el.querySelectorAll<HTMLElement>(".Label, .Label--secondary"));
    const isPrivate = labels.some((l) => {
      const title = (l.getAttribute("title") || "").trim().toLowerCase();
      const text = (l.textContent || "").trim().toLowerCase();
      return title === "private" || text === "private";
    });
    out.push({ nwo, href, description: desc, language, languageColor, stars, forks, isPrivate });
  }
  return out;
}

function readOrgs(doc: Document): ProfileOrg[] {
  // walking every a[data-hovercard-type=organization] was too greedy — it
  // picked up the 'github' org from Developer Program / PRO badges and any
  // commit/repo links that hover-card-resolved to an org. only count anchors
  // that live under the explicit Organizations section: a heading containing
  // "Organizations" with the avatar list immediately following.
  const candidateContainers: Element[] = [];
  // 1) heading-based: <h2|h3|h4> with text "Organizations" then a sibling list
  for (const h of Array.from(doc.querySelectorAll<HTMLElement>("h2, h3, h4"))) {
    const t = (h.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (t !== "organizations") continue;
    let sib: Element | null = h.nextElementSibling;
    while (sib && !sib.querySelector?.('a[data-hovercard-type="organization"]')) {
      sib = sib.nextElementSibling;
    }
    if (sib) candidateContainers.push(sib);
  }
  // 2) explicit selectors used over time: vCard "h-card" details, aria labels.
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[aria-label="Organizations" i], [itemprop="follows"], .h-card .ml-3'))) {
    candidateContainers.push(el);
  }
  const anchors = new Set<HTMLAnchorElement>();
  for (const c of candidateContainers) {
    for (const a of Array.from(c.querySelectorAll<HTMLAnchorElement>('a[data-hovercard-type="organization"]'))) {
      anchors.add(a);
    }
  }
  const seen = new Set<string>();
  const out: ProfileOrg[] = [];
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/?$/.exec(href);
    if (!m || !m[1]) continue;
    const login = m[1];
    if (seen.has(login)) continue;
    seen.add(login);
    const img = a.querySelector<HTMLImageElement>("img");
    const avatarUrl = img?.getAttribute("src") || `https://github.com/${login}.png?size=64`;
    out.push({ login, avatarUrl });
  }
  return out;
}

function readAchievements(doc: Document, login: string): AchievementBadge[] {
  const anchors = doc.querySelectorAll<HTMLAnchorElement>(`a[href*="${login}?achievement="]`);
  const out: AchievementBadge[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(anchors)) {
    const href = a.getAttribute("href") || "";
    const key = /achievement=([^&]+)/.exec(href)?.[1] ?? href;
    if (seen.has(key)) continue;
    const img = a.querySelector<HTMLImageElement>("img");
    if (!img) continue;
    seen.add(key);
    out.push({
      name: img.getAttribute("alt") || key,
      iconUrl: img.getAttribute("src") || "",
      href,
    });
  }
  return out;
}
