import { octicon } from "@/icons";
import { getProfileRepos, type ProfileReposView, type RepoListItem } from "@/adapters/profile-repos";
import { fetchPageDoc } from "@/adapters/_page";
import { renderPrevNextPager } from "./_pager";
import { absoluteTime, relativeTime } from "@/util/time";
import { languageColor } from "@/util/language-color";
import { escapeAttr, escapeRegExp, escapeText, safeAttrHref, safeCssColor, safeDecodeURIComponent, safeHref, sanitizeTree } from "@/util/html";

type ActivityItem = {
  icon: string;
  line: string;
  detail: { text: string; href: string | null } | null;
  occurredAt: string;
};

// keyed by the class github puts on each feed card
const ACTIVITY_ICONS: Record<string, string> = {
  "repo-push": "git-commit",
  "git-branch": "git-branch",
  "git-pull-request": "git-pull-request",
  "git-merge": "git-merge",
  issues_opened: "issue-opened",
  issues_closed: "issue-closed",
  issues_reopened: "issue-reopened",
  issues_comment: "comment",
  release: "tag",
  star: "star",
  fork: "repo-forked",
  gollum: "book",
  public: "repo",
};

// github's public atom feed holds recent events without spending api quota
export async function hydrateActivity(root: HTMLElement, login: string): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-profile__activity-slot");
  if (!slot) return;
  const resp = await fetch(`https://github.com/${encodeURIComponent(login)}.atom`).catch(() => null);
  if (!resp?.ok) return;
  const feed = new DOMParser().parseFromString(await resp.text(), "application/xml");
  // atom entries follow event id order, which drifts from event time for batched pushes
  const items = Array.from(feed.querySelectorAll("entry"), parseEntry)
    .filter((x): x is ActivityItem => x !== null)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const groups = groupByMonth(items);
  if (groups.length === 0) return;
  slot.innerHTML = `
    <section class="oldgh-profile__activity">
      <h3 class="oldgh-profile__section-title">${octicon("clock", { size: 14 })} Public activity</h3>
      <div class="oldgh-activity">
        ${groups.map((g, i) => `
          <details class="oldgh-activity__group" ${i === 0 ? "open" : ""}>
            <summary class="oldgh-activity__month">
              <span class="oldgh-activity__month-label">${escapeText(g.label)}</span>
              <span class="oldgh-activity__month-count">${g.items.length} ${g.items.length === 1 ? "event" : "events"}</span>
            </summary>
            <ul class="oldgh-activity__list">
              ${g.items.map(renderActivityItem).join("")}
            </ul>
          </details>
        `).join("")}
      </div>
    </section>
  `;
}

function groupByMonth(items: ActivityItem[]): { label: string; items: ActivityItem[] }[] {
  const grouped = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = item.occurredAt.slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return Array.from(grouped, ([key, list]) => ({
    label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
    items: list,
  }));
}

function parseEntry(entry: Element): ActivityItem | null {
  const card = new DOMParser().parseFromString(entry.querySelector("content")?.textContent ?? "", "text/html");
  const header = card.querySelector("div.color-fg-muted:has(relative-time)");
  const stamp = new Date(header?.querySelector("relative-time")?.getAttribute("datetime") ?? "");
  if (!header || Number.isNaN(stamp.getTime())) return null;

  const parts: string[] = [];
  let actorSkipped = false;
  for (const node of Array.from(header.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(escapeText(node.textContent ?? ""));
      continue;
    }
    if (!(node instanceof Element) || node.matches("div, span:has(img), span:has(relative-time)")) continue;
    const label = (node.textContent ?? "").replace(/\s+/g, " ").trim().replace(/^refs\/heads\//, "");
    if (node.matches("a") && !actorSkipped) {
      actorSkipped = true;
      continue;
    }
    const shown = node.matches(".branch-name") ? `<code>${escapeText(label)}</code>` : escapeText(label);
    const href = node.getAttribute("href");
    parts.push(href ? `<a href="${escapeAttr(sameSiteHref(href))}">${shown}</a>` : shown);
  }
  const line = parts.join("").replace(/\s+/g, " ").trim().replace(/^[a-z]/, (c) => c.toUpperCase());
  if (!line) return null;

  const titleLink = card.querySelector('.Box .f4 a[href*="/pull/"], .Box .f4 a[href*="/issues/"]');
  const target = header.querySelector('a[href*="/pull/"], a[href*="/issues/"]');
  const commit = card.querySelector(".commits li");
  const detail = titleLink
    ? { text: text(titleLink), href: titleLink.getAttribute("href") }
    : target?.getAttribute("title")
      ? { text: target.getAttribute("title") ?? "", href: target.getAttribute("href") }
      : commit
        ? { text: text(commit.querySelector("blockquote")), href: commit.querySelector("code a")?.getAttribute("href") ?? null }
        : null;
  const kind = card.querySelector(".js-feed-item-view")?.classList[0] ?? "";
  return { icon: ACTIVITY_ICONS[kind] ?? "primitive-dot", line, detail, occurredAt: stamp.toISOString() };
}

function sameSiteHref(href: string): string {
  const url = new URL(href, "https://github.com");
  return url.origin === "https://github.com" ? url.pathname + url.search + url.hash : safeHref(url.href);
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function renderActivityItem(item: ActivityItem): string {
  return `
    <li class="oldgh-activity__item">
      <span class="oldgh-activity__icon">${octicon(item.icon, { size: 14 })}</span>
      <span class="oldgh-activity__line">
        ${item.line}
        <span class="oldgh-activity__when" title="${escapeAttr(absoluteTime(item.occurredAt))}">${escapeText(relativeTime(item.occurredAt))}</span>
        ${item.detail?.text ? `<span class="oldgh-activity__detail">${item.detail.href ? `<a href="${escapeAttr(sameSiteHref(item.detail.href))}">${escapeText(item.detail.text)}</a>` : escapeText(item.detail.text)}</span>` : ""}
      </span>
    </li>
  `;
}

export async function hydrateRepos(root: HTMLElement, login: string, query: string): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-profile__repos");
  if (!container) return;
  let data: ProfileReposView;
  try {
    data = await getProfileRepos(login, query);
  } catch {
    container.innerHTML = `<p class="oldgh-profile__muted">Couldn't load repositories.</p>`;
    return;
  }
  container.innerHTML = renderRepos(data);
}

function renderRepos(d: ProfileReposView): string {
  if (d.items.length === 0) {
    return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No repositories.</p></div>`;
  }
  return `
    <ul class="oldgh-repo-list">
      ${d.items.map((r) => renderRepoRow(r)).join("")}
    </ul>
    ${renderPagination(d.pagination)}
  `;
}

function renderRepoRow(r: RepoListItem): string {
  const privacy = r.isPrivate
    ? `<span class="oldgh-repo-list__visibility">Private</span>`
    : `<span class="oldgh-repo-list__visibility oldgh-repo-list__visibility--public">Public</span>`;
  const forkLabel = r.isFork ? `<span class="oldgh-repo-list__type">Forked</span>` : "";
  const mirror = r.isMirror ? `<span class="oldgh-repo-list__type">Mirror</span>` : "";
  const template = r.isTemplate ? `<span class="oldgh-repo-list__type">Template</span>` : "";

  const meta: string[] = [];
  if (r.language) {
    const swatchColor = r.languageColor ? safeCssColor(r.languageColor) : null;
    const swatch = swatchColor
      ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(swatchColor)}"></span>`
      : "";
    meta.push(`<span>${swatch}${escapeText(r.language)}</span>`);
  }
  if (r.stars) meta.push(`<span>${octicon("star", { size: 12 })}${escapeText(r.stars)}</span>`);
  if (r.forks) meta.push(`<span>${octicon("repo-forked", { size: 12 })}${escapeText(r.forks)}</span>`);
  if (r.updatedIso) {
    meta.push(`<span title="${escapeAttr(absoluteTime(r.updatedIso))}">Updated ${escapeText(relativeTime(r.updatedIso))}</span>`);
  }

  return `
    <li class="oldgh-repo-list__item">
      <h3 class="oldgh-repo-list__title">
        <a href="${safeAttrHref(r.href)}"><strong>${escapeText(r.name)}</strong></a>
        ${privacy}${forkLabel}${mirror}${template}
      </h3>
      ${r.description ? `<p class="oldgh-repo-list__desc">${escapeText(r.description)}</p>` : ""}
      <p class="oldgh-repo-list__meta">${meta.join("")}</p>
    </li>
  `;
}

function framePagination(frame: Element): ProfileReposView["pagination"] {
  const link = (label: string) => {
    const href = Array.from(frame.querySelectorAll(".paginate-container a[href]")).find((a) => a.textContent?.trim() === label)?.getAttribute("href");
    if (!href) return null;
    const url = new URL(href, "https://github.com");
    return url.origin === "https://github.com" ? url.pathname + url.search : null;
  };
  return { prevHref: link("Previous"), nextHref: link("Next") };
}

function renderPagination(p: ProfileReposView["pagination"]): string {
  return renderPrevNextPager({
    className: "oldgh-repo-list__pagination",
    prevHref: p.prevHref,
    nextHref: p.nextHref,
    prevHtml: `${octicon("triangle-left", { size: 14 })}<span>Previous</span>`,
    nextHtml: `<span>Next</span>${octicon("triangle-right", { size: 14 })}`,
    disabledButtons: true,
  });
}

export async function hydrateScrapedTab(root: HTMLElement, login: string, tab: string, query: string): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-profile__scraped");
  if (!container) return;
  const params = new URLSearchParams(query);
  params.set("tab", tab);
  const url = `https://github.com/${encodeURIComponent(login)}?${params}`;
  try {
    const doc = await fetchPageDoc(url);
    const frame: Element =
      doc.querySelector("turbo-frame#user-profile-frame") ||
      doc.querySelector("turbo-frame[id*='profile']") ||
      doc.querySelector("turbo-frame[id]") ||
      doc.querySelector("main") ||
      doc.body;
    if (tab === "achievements") {
      container.innerHTML = renderAchievementsFromFrame(frame);
      return;
    }
    if (tab === "stars") {
      container.innerHTML = renderStarsFromFrame(frame) + renderPagination(framePagination(frame));
      return;
    }
    if (tab === "followers" || tab === "following" || tab === "people") {
      container.innerHTML = renderPeopleFromFrame(frame) + renderPagination(framePagination(frame));
      return;
    }
    if (tab === "packages") {
      container.innerHTML = renderPackagesFromFrame(frame, login);
      return;
    }
    if (tab === "sponsoring") {
      container.innerHTML = renderSponsoringFromFrame(frame, login);
      return;
    }
    if (tab === "projects") {
      container.innerHTML = renderProjectsFromFrame(frame, login);
      return;
    }
    sanitizeTree(frame);
    container.innerHTML = frame.innerHTML;
  } catch {
    container.innerHTML = `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Couldn't load this tab.</p></div>`;
  }
}

function renderStarsFromFrame(frame: Element): string {
  const items = Array.from(frame.querySelectorAll("h3 a[href^='/']")).flatMap((a) => {
    const full = /^\/([\w.-]+\/[\w.-]+)\/?$/.exec(a.getAttribute("href") ?? "")?.[1];
    const card = a.closest(".border-bottom");
    if (!full || !card) return [];
    const desc = text(card.querySelector("p[itemprop='description']"));
    const lang = text(card.querySelector("[itemprop='programmingLanguage']"));
    const rawSwatch = card.querySelector<HTMLElement>(".repo-language-color")?.style.backgroundColor || languageColor(lang);
    const swatch = safeCssColor(rawSwatch) ?? "#ccc";
    const stars = text(card.querySelector('a[href$="/stargazers"]'));
    const forks = text(card.querySelector('a[href$="/forks"]'));
    const updated = card.querySelector("relative-time[datetime]")?.getAttribute("datetime") ?? "";
    const meta = [
      lang ? `<span><span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(swatch)}"></span>${escapeText(lang)}</span>` : "",
      stars ? `<span>${octicon("star", { size: 12 })}${escapeText(stars)}</span>` : "",
      forks ? `<span>${octicon("repo-forked", { size: 12 })}${escapeText(forks)}</span>` : "",
      updated ? `<span title="${escapeAttr(absoluteTime(updated))}">updated ${escapeText(relativeTime(updated))}</span>` : "",
    ].join("");
    return [`
      <li class="oldgh-profile__repo">
        <h3 class="oldgh-profile__repo-name"><a href="/${escapeAttr(full)}">${escapeText(full)}</a></h3>
        ${desc ? `<p class="oldgh-profile__repo-desc">${escapeText(desc)}</p>` : ""}
        ${meta ? `<p class="oldgh-profile__repo-meta">${meta}</p>` : ""}
      </li>
    `];
  });
  if (items.length === 0) return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No starred repositories.</p></div>`;
  return `<ul class="oldgh-profile__repos-list">${items.join("")}</ul>`;
}

function renderPeopleFromFrame(frame: Element): string {
  type P = { login: string; name: string | null; avatarUrl: string; bio: string | null; location: string | null };
  const people: P[] = [];
  const seen = new Set<string>();

  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[data-hovercard-type='user']"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/?$/.exec(href);
    if (!m || !m[1]) continue;
    const login = m[1];
    if (seen.has(login)) continue;
    seen.add(login);

    const card: Element | null =
      a.closest("li") ||
      a.closest("div.d-table") ||
      a.closest(".user-list-item") ||
      a.closest("[data-testid*='member']") ||
      a.parentElement;

    const avatarImg = a.querySelector<HTMLImageElement>("img[src*='avatars']") ?? null;
    const avatarUrl = avatarImg?.getAttribute("src") || `https://github.com/${login}.png?size=64`;

    let name: string | null = null;
    if (card) {
      const nameEl = card.querySelector(".f4.lh-condensed, .text-bold[itemprop='name'], h3.f4");
      if (nameEl) name = (nameEl.textContent || "").trim() || null;
    }
    let bio: string | null = null;
    if (card) {
      const bioEl = card.querySelector(".user-profile-bio, .pinned-item-desc, p.color-fg-muted, [data-bio-text]");
      if (bioEl) bio = (bioEl.textContent || "").trim().slice(0, 200) || null;
    }
    let location: string | null = null;
    if (card) {
      const locEl = card.querySelector("[itemprop='homeLocation'], li[itemprop='homeLocation'] span");
      if (locEl) location = (locEl.textContent || "").trim() || null;
    }
    // github puts the username in the name slot when there is no display name
    people.push({ login, name: name && name !== login ? name : null, avatarUrl, bio, location });
  }
  if (people.length === 0) {
    return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No users to show.</p></div>`;
  }
  return `
    <ul class="oldgh-people">
      ${people.map((p) => `
        <li class="oldgh-people__item">
          <a class="oldgh-people__avatar" href="/${escapeAttr(p.login)}">
            <img src="${escapeAttr(p.avatarUrl)}" width="48" height="48" alt="${escapeAttr(p.login)}" />
          </a>
          <div class="oldgh-people__body">
            <div class="oldgh-people__name">
              ${p.name ? `<a href="/${escapeAttr(p.login)}"><strong>${escapeText(p.name)}</strong></a> ` : ""}
              <a href="/${escapeAttr(p.login)}" class="oldgh-people__login">${escapeText(p.login)}</a>
            </div>
            ${p.bio ? `<p class="oldgh-people__bio">${escapeText(p.bio)}</p>` : ""}
            ${p.location ? `<p class="oldgh-people__location">${octicon("location", { size: 12 })} ${escapeText(p.location)}</p>` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPackagesFromFrame(frame: Element, login: string): string {
  type P = {
    name: string;
    href: string;
    registry: string | null;
    description: string | null;
    version: string | null;
    isPrivate: boolean;
    repo: string | null;
  };
  const packages: P[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[href*='/pkgs/'], a[href*='/packages/']"))) {
    const href = a.getAttribute("href") || "";
    const m = /\/packages\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/.exec(href)
      || /\/pkgs\/([^/?#]+)\/([^/?#]+)/.exec(href);
    if (!m) continue;
    const rawName = (a.textContent || "").trim();
    const cleanName = rawName || safeDecodeURIComponent(m[m.length - 1] || "");
    if (!cleanName || /^packages$/i.test(cleanName)) continue;
    const key = href.split("?")[0]!;
    if (seen.has(key)) continue;
    const card = a.closest("li, .Box-row, div.d-flex") || a.parentElement?.parentElement;
    const registry = m[1]?.toLowerCase() === "container" || href.includes("/container/") ? "container" : m[1]?.toLowerCase() || null;
    const descEl = card?.querySelector<HTMLElement>("p.color-fg-muted, .text-small.color-fg-muted");
    const description = descEl?.textContent?.trim() || null;
    const verEl = card?.querySelector<HTMLElement>("[class*='version'], a[href*='/versions']");
    const version = verEl?.textContent?.trim() || null;
    const isPrivate = !!/private/i.test(card?.querySelector<HTMLElement>(".Label")?.textContent || "");
    const repoLink = card?.querySelector<HTMLAnchorElement>("a[data-hovercard-type='repository']");
    const repo = repoLink?.textContent?.trim() || null;
    seen.add(key);
    packages.push({
      name: cleanName,
      href,
      registry,
      description,
      version,
      isPrivate,
      repo,
    });
  }
  if (packages.length === 0) {
    return `
      <section class="oldgh-packages">
        <div class="oldgh-packages__empty">
          ${octicon("package", { size: 40 })}
          <h2>No packages published yet.</h2>
          <p>Container, npm, NuGet, Maven, RubyGems and other packages published from @${escapeText(login)}'s repositories will appear here.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-packages">
      <header class="oldgh-packages__head">
        <h3>${octicon("package", { size: 16 })} Packages <span class="oldgh-packages__count">${packages.length}</span></h3>
      </header>
      <ul class="oldgh-packages__list">
        ${packages.map(renderPackageRow).join("")}
      </ul>
    </section>
  `;
}

function renderPackageRow(p: { name: string; href: string; registry: string | null; description: string | null; version: string | null; isPrivate: boolean; repo: string | null }): string {
  const registryIcon = packageRegistryIcon(p.registry);
  return `
    <li class="oldgh-packages__row">
      <span class="oldgh-packages__icon">${registryIcon}</span>
      <div class="oldgh-packages__main">
        <h3 class="oldgh-packages__name">
          <a href="${escapeAttr(p.href)}">${escapeText(p.name)}</a>
          ${p.isPrivate ? `<span class="oldgh-packages__chip">Private</span>` : ""}
        </h3>
        ${p.description ? `<p class="oldgh-packages__desc">${escapeText(p.description)}</p>` : ""}
        <div class="oldgh-packages__meta">
          ${p.registry ? `<span class="oldgh-packages__registry">${escapeText(formatRegistry(p.registry))}</span>` : ""}
          ${p.version ? `<span>${octicon("tag", { size: 11 })} ${escapeText(p.version)}</span>` : ""}
          ${p.repo ? `<span>${octicon("repo", { size: 11 })} <a href="/${escapeAttr(p.repo)}">${escapeText(p.repo)}</a></span>` : ""}
        </div>
      </div>
    </li>
  `;
}

function packageRegistryIcon(registry: string | null): string {
  switch (registry) {
    case "npm": return octicon("package", { size: 18 });
    case "container": case "docker": return octicon("package", { size: 18 });
    case "rubygems": return octicon("ruby", { size: 18 });
    case "maven": return octicon("file-binary", { size: 18 });
    case "nuget": return octicon("file-binary", { size: 18 });
    default: return octicon("package", { size: 18 });
  }
}

function formatRegistry(registry: string): string {
  switch (registry) {
    case "npm": return "npm";
    case "container": return "Container";
    case "docker": return "Docker";
    case "rubygems": return "RubyGems";
    case "maven": return "Maven";
    case "nuget": return "NuGet";
    default: return registry;
  }
}

function renderSponsoringFromFrame(frame: Element, login: string): string {
  type S = { login: string; name: string | null; avatarUrl: string; tier: string | null };
  const sponsorees: S[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[data-hovercard-type='user'], a[href^='/']"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/?$/.exec(href);
    if (!m) continue;
    const candidateLogin = m[1]!;
    if (candidateLogin === login) continue;
    if (seen.has(candidateLogin)) continue;
    const card = a.closest("li, article, .Box-row, .d-flex");
    if (!card) continue;
    if (!card.querySelector("a[href*='/sponsors/'], a[href*='sponsor'], [class*='tier']")) continue;
    const avatarImg = card.querySelector<HTMLImageElement>("img.avatar, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || `https://github.com/${candidateLogin}.png?size=64`;
    const nameEl = card.querySelector<HTMLElement>("h3, .h3, .f4, [class*='heading']");
    const name = nameEl?.textContent?.trim() || null;
    const tierEl = card.querySelector<HTMLElement>("[class*='tier']");
    const tier = tierEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    seen.add(candidateLogin);
    sponsorees.push({ login: candidateLogin, name: name !== candidateLogin ? name : null, avatarUrl, tier });
  }
  if (sponsorees.length === 0) {
    return `
      <section class="oldgh-sponsoring">
        <div class="oldgh-sponsoring__empty">
          ${octicon("heart", { size: 40 })}
          <h2>Not sponsoring anyone yet.</h2>
          <p>Sponsorships fund maintainers of open-source projects. Open the <a href="/sponsors/explore">Sponsors directory</a> to find people @${escapeText(login)} relies on.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-sponsoring">
      <header class="oldgh-sponsoring__head">
        <h3>${octicon("heart", { size: 16 })} Sponsoring <span class="oldgh-sponsoring__count">${sponsorees.length}</span></h3>
        <p>Maintainers @${escapeText(login)} financially supports.</p>
      </header>
      <ul class="oldgh-sponsoring__grid">
        ${sponsorees.map((s) => `
          <li class="oldgh-sponsoring__card">
            <a class="oldgh-sponsoring__avatar" href="/${escapeAttr(s.login)}" aria-label="View ${escapeAttr(s.login)}'s profile">
              <img src="${escapeAttr(s.avatarUrl)}" width="56" height="56" alt="" />
            </a>
            <div class="oldgh-sponsoring__main">
              ${s.name ? `<a class="oldgh-sponsoring__name" href="/${escapeAttr(s.login)}"><strong>${escapeText(s.name)}</strong></a>` : ""}
              <a class="oldgh-sponsoring__login" href="/${escapeAttr(s.login)}">@${escapeText(s.login)}</a>
              ${s.tier ? `<span class="oldgh-sponsoring__tier">${escapeText(s.tier)}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderProjectsFromFrame(frame: Element, login: string): string {
  type P = { number: number; title: string; description: string | null; href: string; status: "open" | "closed"; itemCount: number | null };
  const projects: P[] = [];
  const seen = new Set<number>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[href*='/projects/']"))) {
    const href = a.getAttribute("href") || "";
    const escapedLogin = escapeRegExp(login);
    const m = new RegExp(`^/${escapedLogin}/projects/(\\d+)`, "i").exec(href)
      || /^\/users\/[\w.-]+\/projects\/(\d+)/i.exec(href)
      || new RegExp(`^/orgs/${escapedLogin}/projects/(\\d+)`, "i").exec(href);
    if (!m) continue;
    const num = parseInt(m[1]!, 10);
    if (seen.has(num)) continue;
    const card = a.closest("li, article, .Box-row");
    if (!card) continue;
    const title = (a.textContent || "").trim();
    if (!title || title.length > 200) continue;
    const descEl = card.querySelector<HTMLElement>("p.color-fg-muted, .text-small.color-fg-muted");
    const description = descEl?.textContent?.trim() || null;
    const stateEl = card.querySelector<HTMLElement>("[data-state], .State");
    const status: "open" | "closed" = /closed/i.test(stateEl?.textContent || "") ? "closed" : "open";
    const itemCountText = card.querySelector<HTMLElement>(".Counter")?.textContent || "";
    const itemCount = parseInt(itemCountText.replace(/\D/g, ""), 10) || null;
    seen.add(num);
    projects.push({ number: num, title, description, href, status, itemCount });
  }
  if (projects.length === 0) {
    return `
      <section class="oldgh-user-projects">
        <div class="oldgh-user-projects__empty">
          ${octicon("project", { size: 40 })}
          <h2>No projects yet.</h2>
          <p>Projects let @${escapeText(login)} plan work across repositories, including roadmaps and todo boards.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-user-projects">
      <header class="oldgh-user-projects__head">
        <h3>${octicon("project", { size: 16 })} Projects <span class="oldgh-user-projects__count">${projects.length}</span></h3>
      </header>
      <ul class="oldgh-user-projects__list">
        ${projects.map((p) => `
          <li class="oldgh-user-projects__row">
            <span class="oldgh-user-projects__icon">${octicon("project", { size: 16 })}</span>
            <div class="oldgh-user-projects__main">
              <h3>
                <a href="${safeAttrHref(p.href)}">${escapeText(p.title)}</a>
                <span class="oldgh-user-projects__num">#${p.number}</span>
              </h3>
              ${p.description ? `<p class="oldgh-user-projects__desc">${escapeText(p.description)}</p>` : ""}
              <div class="oldgh-user-projects__meta">
                <span class="oldgh-user-projects__status oldgh-user-projects__status--${p.status}">${p.status === "open" ? "Open" : "Closed"}</span>
                ${p.itemCount !== null ? `<span>${p.itemCount} item${p.itemCount === 1 ? "" : "s"}</span>` : ""}
              </div>
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderAchievementsFromFrame(frame: Element): string {
  type A = { slug: string; name: string; iconUrl: string; tier: string | null; description: string | null };
  const earned: A[] = [];
  for (const d of Array.from(frame.querySelectorAll<HTMLElement>("details[data-achievement-slug]"))) {
    const slug = d.getAttribute("data-achievement-slug") || "";
    const img = d.querySelector<HTMLImageElement>("img");
    const iconUrl = img?.getAttribute("src") || "";
    const name = img?.getAttribute("alt")?.replace(/^Achievement:\s*/i, "").trim() || slug;
    const tierEl = d.querySelector(".achievement-tier, [class*='tier']");
    const tier = tierEl?.textContent?.trim() || null;
    let description: string | null = null;
    for (const p of Array.from(d.querySelectorAll<HTMLElement>(".Popover-message p, .Popover p, .position-absolute p"))) {
      const txt = (p.textContent || "").trim();
      if (txt && txt.length > 4 && !/^achievement:\s/i.test(txt) && txt !== name) {
        description = txt;
        break;
      }
    }
    if (slug && iconUrl) earned.push({ slug, name, iconUrl, tier, description });
  }
  if (earned.length === 0) {
    return `
      <section class="oldgh-achievements">
        <div class="oldgh-achievements__empty">
          ${octicon("star", { size: 36 })}
          <h3>No achievements earned yet.</h3>
          <p>Achievements highlight specific events on GitHub. Open pull requests, ship releases, or sponsor maintainers as they accumulate over time.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-achievements">
      <header class="oldgh-achievements__intro">
        <h3>${octicon("star", { size: 18 })} Achievements <span class="oldgh-achievements__count">${earned.length}</span></h3>
        <p>Highlights and milestones earned across GitHub activity.</p>
      </header>
      <ul class="oldgh-achievements__grid">
        ${earned.map((a) => `
          <li class="oldgh-achievements__item" title="${escapeAttr(a.description || a.name)}">
            <div class="oldgh-achievements__icon-wrap">
              <img class="oldgh-achievements__icon" src="${escapeAttr(a.iconUrl)}" alt="${escapeAttr(a.name)}" width="80" height="80" />
              ${a.tier ? `<span class="oldgh-achievements__tier">×${escapeText(a.tier.replace(/^x/i, ""))}</span>` : ""}
            </div>
            <div class="oldgh-achievements__meta">
              <span class="oldgh-achievements__name">${escapeText(a.name)}</span>
              ${a.description ? `<span class="oldgh-achievements__desc">${escapeText(a.description.slice(0, 120))}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}
