import { octicon } from "@/icons";
import { getProfile, type PinnedRepo, type ProfileReadme, type ProfileView } from "@/adapters/profile";
import { setFollowing, type FollowForms } from "@/adapters/social";
import { isLoggedIn } from "@/auth/session";
import { adoptBodyRoot, navigationToken } from "./_body";
import { bindContributionTooltips, decorateContributionCells, renderContributionStreaks } from "./_profile-calendar";
import { hydrateActivity, hydrateRepos, hydrateScrapedTab } from "./_profile-tabs";
import { escapeAttr, escapeText, safeAttrHref, safeCssColor, safeHref, sanitizeHtml, sanitizeScrapedFragment } from "@/util/html";

const ROOT_CLASS = "oldgh-profile";

const USER_TABS: { key: string; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "repositories", label: "Repositories" },
  { key: "stars", label: "Stars" },
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
  { key: "achievements", label: "Achievements" },
];

const ORG_TABS: { key: string; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "repositories", label: "Repositories" },
  { key: "projects", label: "Projects" },
  { key: "packages", label: "Packages" },
  { key: "people", label: "People" },
];

function isViewingPastYear(query: string): boolean {
  const m = /(?:^|[?&])from=(\d{4})-/.exec(query);
  if (!m || !m[1]) return false;
  const year = parseInt(m[1], 10);
  return Number.isFinite(year) && year !== new Date().getUTCFullYear();
}

export async function mountProfile(login: string, tab: string, query: string): Promise<void> {
  const nav = navigationToken();
  const view = await getProfile(login, query);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, tab);
  if (!adoptBodyRoot(root, ".oldgh-header", nav)) return;

  if (tab === "repositories") {
    void hydrateRepos(root, login, query);
  } else if (tab !== "overview") {
    void hydrateScrapedTab(root, login, tab, query);
  }
  if (tab === "overview" && view.kind === "user" && !isViewingPastYear(query)) {
    // the public feed only holds recent events, which would mislead under a past year
    void hydrateActivity(root, login);
  }
  decorateContributionCells(root);
  // tool-tip custom elements relocate themselves asynchronously; retry once they have
  setTimeout(() => decorateContributionCells(root), 100);
  setTimeout(() => decorateContributionCells(root), 500);
  renderContributionStreaks(root);
  bindContributionTooltips(root);
  if (view.follow) bindFollow(root, view.follow);
}

function bindFollow(root: HTMLElement, forms: FollowForms): void {
  const button = root.querySelector<HTMLButtonElement>("[data-oldgh-follow]");
  const countEl = root.querySelector<HTMLElement>('[data-oldgh-stat="followers"] strong');
  if (!button) return;
  const paint = () => {
    button.innerHTML = `${octicon("person", { size: 14 })}<span>${forms.following ? "Unfollow" : "Follow"}</span>`;
  };
  const apply = (following: boolean) => {
    // only exact counts can move by one; "1.2k" stays as github rendered it
    if (countEl && following !== forms.following && /^\d+$/.test(countEl.textContent || "")) {
      countEl.textContent = String(Number(countEl.textContent) + (following ? 1 : -1));
    }
    forms.following = following;
    paint();
  };
  paint();
  button.addEventListener("click", async () => {
    const next = !forms.following;
    apply(next);
    button.disabled = true;
    try {
      await setFollowing(forms, next);
      button.removeAttribute("data-error");
      button.title = "";
    } catch (err) {
      apply(!next);
      const message = `Couldn't ${next ? "follow" : "unfollow"}: ${err instanceof Error ? err.message : String(err)}`;
      button.setAttribute("data-error", message);
      button.title = message;
    } finally {
      button.disabled = false;
    }
  });
}

function renderShell(v: ProfileView, tab: string): string {
  return `
    <div class="oldgh-page oldgh-profile__page">
      <aside class="oldgh-profile__sidebar">
        ${renderSidebar(v)}
      </aside>
      <main class="oldgh-profile__main">
        ${renderTabNav(v, tab)}
        ${renderTabBody(v, tab)}
      </main>
    </div>
  `;
}

function renderTabNav(v: ProfileView, tab: string): string {
  const tabs = v.kind === "org" ? ORG_TABS : USER_TABS;
  const items = tabs.map((t) => {
    const href = t.key === "overview" ? `/${v.login}` : `/${v.login}?tab=${t.key}`;
    const active = tab === t.key ? ' aria-current="page"' : "";
    return `<li class="oldgh-tabs__item"><a class="oldgh-tabs__link" href="${escapeAttr(href)}"${active}>${escapeText(t.label)}</a></li>`;
  }).join("");
  return `<nav class="oldgh-profile__tabnav" aria-label="Profile sections"><ul class="oldgh-tabs">${items}</ul></nav>`;
}

function renderTabBody(v: ProfileView, tab: string): string {
  if (tab === "repositories") {
    return `<div class="oldgh-profile__repos" data-state="loading"><div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Loading repositories&hellip;</p></div></div>`;
  }
  if (tab !== "overview") {
    return `<div class="oldgh-profile__scraped" data-state="loading"><div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Loading&hellip;</p></div></div>`;
  }
  if (v.kind === "org") {
    return `
      ${v.readme ? renderReadme(v.readme) : ""}
      ${v.pinned.length > 0 ? renderPinned(v) : v.readme ? "" : renderOrgEmptyState(v)}
    `;
  }
  return `
    ${v.readme ? renderReadme(v.readme) : ""}
    ${v.pinned.length > 0 ? renderPinned(v) : ""}
    ${renderContributions(v)}
    <div class="oldgh-profile__activity-slot"></div>
  `;
}

function renderOrgEmptyState(v: ProfileView): string {
  const links: string[] = [];
  links.push(`<a href="/${escapeAttr(v.login)}?tab=repositories">${octicon("repo", { size: 14 })}<span>Repositories${v.repoCountHint != null ? ` (${escapeText(String(v.repoCountHint))})` : ""}</span></a>`);
  links.push(`<a href="/${escapeAttr(v.login)}?tab=people">${octicon("organization", { size: 14 })}<span>People</span></a>`);
  return `
    <section class="oldgh-profile__org-empty oldgh-profile__empty">
      ${octicon("organization", { size: 40 })}
      <h3 class="oldgh-profile__section-title">${escapeText(v.displayName)}</h3>
      <p class="oldgh-profile__muted">This organization hasn't pinned any repositories or published a profile README yet.</p>
      <p class="oldgh-profile__org-empty-links">${links.join("")}</p>
    </section>
  `;
}

function renderReadme(r: ProfileReadme): string {
  const title = r.href ? `<a href="${escapeAttr(safeHref(r.href))}">${escapeText(r.title)}</a>` : escapeText(r.title);
  return `
    <section class="oldgh-profile__readme">
      <h3 class="oldgh-profile__section-title">${octicon("book", { size: 14 })} ${title}</h3>
      <article class="oldgh-profile__readme-body markdown-body">${sanitizeHtml(r.html)}</article>
    </section>
  `;
}

function renderSidebar(v: ProfileView): string {
  const avatar = `
    <div class="oldgh-profile__avatar">
      <img src="${escapeAttr(v.avatarUrl)}" alt="${escapeAttr(v.displayName)}" />
    </div>
  `;
  const action = v.isViewer
    ? `<a class="oldgh-btn oldgh-profile__edit" href="/settings/profile">Edit profile</a>`
    : v.follow
      ? `<button type="button" class="oldgh-btn oldgh-profile__follow" data-oldgh-follow>${octicon("person", { size: 14 })}<span>Follow</span></button>`
      : isLoggedIn()
        ? ""
        : `<a class="oldgh-btn oldgh-profile__follow" href="/login?return_to=${encodeURIComponent(`/${v.login}`)}">${octicon("person", { size: 14 })}<span>Follow</span></a>`;

  const stats: string[] = [];
  if (v.followersCount) stats.push(statItem(v.followersCount, "followers", `/${v.login}?tab=followers`, "followers"));
  if (v.followingCount) stats.push(statItem(v.followingCount, "following", `/${v.login}?tab=following`));
  if (v.repoCountHint != null) stats.push(statItem(String(v.repoCountHint), "repos", `/${v.login}?tab=repositories`));

  const details: string[] = [];
  if (v.bio) details.push(`<p class="oldgh-profile__bio">${escapeText(v.bio)}</p>`);
  if (v.location) details.push(`<p class="oldgh-profile__detail">${octicon("location", { size: 14 })}<span>${escapeText(v.location)}</span></p>`);
  if (v.homepage) details.push(`<p class="oldgh-profile__detail">${octicon("link", { size: 14 })}<a href="${escapeAttr(safeHref(v.homepage))}" rel="nofollow noopener">${escapeText(stripUrl(v.homepage))}</a></p>`);

  const highlights = renderHighlights(v);

  const orgs = v.orgs.length > 0
    ? `<section class="oldgh-profile__orgs">
        <h3>Organizations</h3>
        <ul class="oldgh-profile__org-list">
          ${v.orgs.slice(0, 12).map((o) => `<li><a href="/${escapeAttr(o.login)}" title="@${escapeAttr(o.login)}"><img src="${escapeAttr(o.avatarUrl)}" alt="${escapeAttr(o.login)}" width="32" height="32" /></a></li>`).join("")}
        </ul>
      </section>`
    : "";

  const achievements = v.achievements.length > 0
    ? `<section class="oldgh-profile__achievements">
        <h3>Achievements</h3>
        <ul class="oldgh-profile__badges">
          ${v.achievements.slice(0, 8).map((a) => `<li><a href="${safeAttrHref(a.href)}" title="${escapeAttr(a.name)}"><img src="${safeAttrHref(a.iconUrl)}" alt="${escapeAttr(a.name)}" width="56" height="56" /></a></li>`).join("")}
        </ul>
      </section>`
    : "";

  return `
    ${avatar}
    <h1 class="oldgh-profile__name">${escapeText(v.displayName)}</h1>
    <p class="oldgh-profile__login">${escapeText(v.login)}</p>
    ${details.join("")}
    ${action}
    ${stats.length > 0 ? `<ul class="oldgh-profile__stats">${stats.join("")}</ul>` : ""}
    ${highlights}
    ${orgs}
    ${achievements}
  `;
}

function renderHighlights(v: ProfileView): string {
  const items: string[] = [];
  if (v.highlights.proPlan) {
    items.push(`<li class="oldgh-profile__highlight"><span class="oldgh-profile__pro">PRO</span> Account</li>`);
  }
  if (v.highlights.devProgramMember) {
    items.push(`<li class="oldgh-profile__highlight">${octicon("rocket", { size: 14 })}<a href="/settings/profile#github-developer-program">Developer Program Member</a></li>`);
  }
  if (items.length === 0) return "";
  return `
    <section class="oldgh-profile__highlights">
      <h3>Highlights</h3>
      <ul class="oldgh-profile__highlight-list">${items.join("")}</ul>
    </section>
  `;
}

function statItem(value: string, label: string, href: string, stat?: string): string {
  return `<li${stat ? ` data-oldgh-stat="${stat}"` : ""}><a href="${escapeAttr(href)}"><strong>${escapeText(value)}</strong> <span>${escapeText(label)}</span></a></li>`;
}

function renderPinned(v: ProfileView): string {
  return `
    <section class="oldgh-profile__pinned">
      <h3 class="oldgh-profile__section-title">Pinned repositories</h3>
      <ul class="oldgh-profile__pinned-list">
        ${v.pinned.map((p) => renderPinnedCard(p)).join("")}
      </ul>
    </section>
  `;
}

function renderPinnedCard(p: PinnedRepo): string {
  const repoIcon = p.isPrivate ? octicon("lock", { size: 14 }) : octicon("repo", { size: 14 });
  const langColor = p.languageColor ? safeCssColor(p.languageColor) : null;
  const langSwatch = langColor
    ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(langColor)}"></span>`
    : "";
  const meta: string[] = [];
  if (p.language) meta.push(`<span class="oldgh-profile__pinned-lang">${langSwatch}${escapeText(p.language)}</span>`);
  if (p.stars) meta.push(`<span class="oldgh-profile__pinned-count">${octicon("star", { size: 12 })}${escapeText(p.stars)}</span>`);
  if (p.forks) meta.push(`<span class="oldgh-profile__pinned-count">${octicon("repo-forked", { size: 12 })}${escapeText(p.forks)}</span>`);
  return `
    <li class="oldgh-profile__pinned-card">
      <h4 class="oldgh-profile__pinned-title">
        ${repoIcon}
        <a href="${safeAttrHref(p.href)}"><strong>${escapeText(p.nwo.split("/").pop() ?? p.nwo)}</strong></a>
      </h4>
      ${p.description ? `<p class="oldgh-profile__pinned-desc">${escapeText(p.description)}</p>` : ""}
      ${meta.length > 0 ? `<p class="oldgh-profile__pinned-meta">${meta.join("")}</p>` : ""}
    </li>
  `;
}

function renderContributions(v: ProfileView): string {
  if (!v.contributionGraphHtml) {
    return `
      <section class="oldgh-profile__contribs-empty">
        <h3 class="oldgh-profile__section-title">Contributions</h3>
        <p class="oldgh-profile__activity-link">${octicon("graph", { size: 14 })}<span>See the full contribution graph at <a href="https://github.com/${escapeAttr(v.login)}">github.com/${escapeText(v.login)}</a>.</span></p>
      </section>
    `;
  }
  const yearList = v.contributionYears.length > 1
    ? `<ol class="oldgh-profile__contribs-years">${v.contributionYears.map((y) => `
        <li${y.isActive ? ` class="is-active"` : ""}>
          <a href="${escapeAttr(y.href)}"${y.isActive ? ` aria-current="page"` : ""}>${y.year}</a>
        </li>
      `).join("")}</ol>`
    : "";
  return `
    <section class="oldgh-profile__contribs">
      ${v.contributionHeading ? `<h3 class="oldgh-profile__section-title">${escapeText(v.contributionHeading)}</h3>` : `<h3 class="oldgh-profile__section-title">Contributions</h3>`}
      <div class="oldgh-profile__contribs-row">
        <div class="oldgh-profile__contribs-main">
          <div class="oldgh-profile__contribs-graph">${sanitizeScrapedFragment(v.contributionGraphHtml)}</div>
          <div class="oldgh-profile__contribs-legend">
            <span>Less</span>
            <span class="oldgh-profile__contribs-legend-cell" data-level="0"></span>
            <span class="oldgh-profile__contribs-legend-cell" data-level="1"></span>
            <span class="oldgh-profile__contribs-legend-cell" data-level="2"></span>
            <span class="oldgh-profile__contribs-legend-cell" data-level="3"></span>
            <span class="oldgh-profile__contribs-legend-cell" data-level="4"></span>
            <span>More</span>
          </div>
        </div>
        ${yearList}
      </div>
    </section>
  `;
}

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
