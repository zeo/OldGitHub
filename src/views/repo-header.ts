import { octicon } from "@/icons";
import { getRepoSummary, formatCount, type RepoSummary } from "@/adapters/repo";

const PRIMARY_NAV = [
  { key: "code", label: "Code", path: "", icon: "code" },
  { key: "issues", label: "Issues", path: "/issues", icon: "issue-opened" },
  { key: "pulls", label: "Pull requests", path: "/pulls", icon: "git-pull-request" },
  { key: "wiki", label: "Wiki", path: "/wiki", icon: "book" },
] as const;

const INSIGHTS_NAV = [
  { key: "pulse", label: "Pulse", path: "/pulse", icon: "pulse" },
  { key: "graphs", label: "Graphs", path: "/graphs/contributors", icon: "graph" },
  { key: "network", label: "Network", path: "/network", icon: "git-branch" },
] as const;

const MORE_NAV = [
  { key: "discussions", label: "Discussions", path: "/discussions", icon: "comment-discussion" },
  { key: "actions", label: "Actions", path: "/actions", icon: "play" },
  { key: "projects", label: "Projects", path: "/projects", icon: "project" },
  { key: "releases", label: "Releases", path: "/releases", icon: "tag" },
  { key: "security", label: "Security", path: "/security", icon: "shield" },
  { key: "settings", label: "Settings", path: "/settings", icon: "gear" },
] as const;

const NAV_ITEMS = [...PRIMARY_NAV, ...INSIGHTS_NAV, ...MORE_NAV] as const;

type NavItem = (typeof NAV_ITEMS)[number];
type NavKey = NavItem["key"];

const ROOT_CLASS = "oldgh-repo-header";

export async function mountRepoHeader(owner: string, repo: string, prefetched?: Promise<RepoSummary | null> | RepoSummary | null): Promise<void> {
  let summary: RepoSummary | null = null;
  try {
    summary = prefetched !== undefined ? await prefetched : await getRepoSummary(owner, repo);
  } catch (err) {
    console.debug("[oldgh] getRepoSummary failed, rendering minimal header:", err);
  }

  const header = document.createElement("div");
  header.className = ROOT_CLASS;
  header.dataset.oldghOwner = owner;
  header.dataset.oldghRepo = repo;
  const active = currentNavKey(owner, repo, window.location.pathname);
  header.innerHTML = summary
    ? renderRepoHeaderHtml(summary, active)
    : renderMinimalHeader(owner, repo, active);

  unmountRepoHeader();
  document.documentElement.setAttribute("data-oldgh-hide-modern-repo-header", "");
  setNavigationMode(owner, repo, window.location.pathname);
  bindRepoHeader(header);
  const after = document.querySelector(".oldgh-header");
  if (after && after.parentNode) {
    after.after(header);
  } else {
    document.body.prepend(header);
  }
}

export function prefetchRepoSummary(owner: string, repo: string): Promise<RepoSummary | null> {
  return getRepoSummary(owner, repo).catch((err) => {
    console.debug("[oldgh] prefetchRepoSummary failed:", err);
    return null;
  });
}

function renderMinimalHeader(owner: string, repo: string, active: NavKey | null): string {
  const minimal: RepoSummary = {
    owner,
    repo,
    nwo: `${owner}/${repo}`,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    parentNwo: null,
    description: "",
    homepage: null,
    defaultBranch: "main",
    stars: null,
    forks: null,
    watchers: null,
    topics: [],
    primaryLanguage: null,
    license: null,
    hasIssues: true,
    hasWiki: true,
    hasProjects: true,
    hasDiscussions: false,
  };
  return renderRepoHeaderHtml(minimal, active);
}

export function unmountRepoHeader(): void {
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach((el) => el.remove());
  document.documentElement.removeAttribute("data-oldgh-hide-modern-repo-header");
  document.documentElement.removeAttribute("data-oldgh-repo-nav");
}

export function updateActiveTab(owner: string, repo: string, pathname: string): void {
  const active = currentNavKey(owner, repo, pathname);
  setNavigationMode(owner, repo, pathname);
  document.querySelectorAll<HTMLAnchorElement>(".oldgh-repo-tabs__link").forEach((link) => {
    if (active && link.dataset.tab === active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  const more = document.querySelector<HTMLDetailsElement>(".oldgh-repo-nav__more");
  if (more) {
    more.open = false;
    const trigger = more.querySelector<HTMLElement>(".oldgh-repo-nav__more-trigger");
    if (trigger) {
      if (active && MORE_NAV.some((item) => item.key === active)) {
        trigger.setAttribute("aria-current", "page");
      } else {
        trigger.removeAttribute("aria-current");
      }
    }
  }
}

function renderRepoHeaderHtml(s: RepoSummary, active: NavKey | null): string {
  const repoIcon = s.isPrivate
    ? octicon("lock", { size: 18 })
    : s.isFork
      ? octicon("repo-forked", { size: 18 })
      : octicon("repo", { size: 18 });

  const forkOf = s.isFork && s.parentNwo
    ? `<div class="oldgh-repo-header__fork-of">forked from <a href="/${escapeAttr(s.parentNwo)}">${escapeText(s.parentNwo)}</a></div>`
    : "";

  const descBits: string[] = [];
  if (s.description) descBits.push(`<span class="oldgh-repo-header__description-text">${escapeText(s.description)}</span>`);
  if (s.homepage) {
    const href = /^https?:\/\//.test(s.homepage) ? s.homepage : `https://${s.homepage}`;
    descBits.push(`<a class="oldgh-repo-header__homepage" href="${escapeAttr(href)}" rel="noopener noreferrer nofollow">${octicon("link", { size: 12 })} ${escapeText(s.homepage.replace(/^https?:\/\//, ""))}</a>`);
  }
  const description = descBits.length > 0
    ? `<p class="oldgh-repo-header__description">${descBits.join(" ")}</p>`
    : "";
  const archivedBadge = s.isArchived
    ? ` <span class="oldgh-repo-header__archived" title="This repository is archived">${s.isPrivate ? "Private" : "Public"} archive</span>`
    : "";
  const archivedBanner = s.isArchived
    ? `<div class="oldgh-repo-header__archive-banner">${octicon("archive", { size: 16 })}<span>This repository has been archived by the owner. It is now read-only.</span></div>`
    : "";

  const topics = s.topics.length > 0
    ? `<p class="oldgh-repo-header__topics">${s.topics.slice(0, 12).map((t) => `<a class="oldgh-repo-header__topic" href="/topics/${escapeAttr(t)}">${escapeText(t)}</a>`).join("")}</p>`
    : "";

  const watchersText = formatCount(s.watchers);
  const starsText = formatCount(s.stars);
  const forksText = formatCount(s.forks);

  const watch = renderActionButton({
    href: `/${s.owner}/${s.repo}/subscription`,
    icon: "eye",
    label: "Watch",
    listHref: `/${s.owner}/${s.repo}/watchers`,
    count: watchersText,
  });
  const star = renderActionButton({
    href: `/${s.owner}/${s.repo}/stargazers`,
    icon: "star",
    label: "Stars",
    listHref: `/${s.owner}/${s.repo}/stargazers`,
    count: starsText,
  });
  const fork = renderActionButton({
    href: `/${s.owner}/${s.repo}/fork`,
    icon: "repo-forked",
    label: "Fork",
    listHref: `/${s.owner}/${s.repo}/forks`,
    count: forksText,
  });

  return `
    <div class="oldgh-page">
      <div class="oldgh-repo-titlebar">
        <h1 class="oldgh-repo-header__title">
          <span class="oldgh-repo-header__icon">${repoIcon}</span>
          <a href="/${escapeAttr(s.owner)}">${escapeText(s.owner)}</a>
          <span class="oldgh-repo-header__slash">/</span>
          <a href="/${escapeAttr(s.owner)}/${escapeAttr(s.repo)}"><strong>${escapeText(s.repo)}</strong></a>
          ${archivedBadge}
        </h1>
        <div class="oldgh-repo-header__actions">${watch}${star}${fork}</div>
      </div>
      ${forkOf}
      ${description}
      ${topics}
      ${archivedBanner}
      <nav class="oldgh-repo-tabs" aria-label="Repository">
        <ul class="oldgh-repo-nav__group">
          ${PRIMARY_NAV.filter((item) => isNavItemAvailable(s, item.key)).map((item) => renderNavItem(s, item, active)).join("")}
        </ul>
        <ul class="oldgh-repo-nav__group oldgh-repo-nav__group--insights">
          ${INSIGHTS_NAV.map((item) => renderNavItem(s, item, active)).join("")}
        </ul>
        ${renderMoreMenu(s, active)}
        ${renderClonePanel(s)}
      </nav>
    </div>
  `;
}

type ActionButton = {
  href: string;
  icon: string;
  label: string;
  listHref: string;
  count: string;
};

function renderActionButton(b: ActionButton): string {
  const icon = octicon(b.icon, { size: 14 });
  const count = b.count
    ? `<a class="oldgh-repo-header__action-count" href="${escapeAttr(b.listHref)}">${escapeText(b.count)}</a>`
    : "";
  return `
    <span class="oldgh-repo-header__action">
      <a class="oldgh-btn oldgh-repo-header__action-btn" href="${escapeAttr(b.href)}">
        ${icon}<span>${b.label}</span>
      </a>
      ${count}
    </span>
  `;
}

function isNavItemAvailable(s: RepoSummary, key: NavKey): boolean {
  switch (key) {
    case "issues": return s.hasIssues;
    case "discussions": return s.hasDiscussions;
    case "wiki": return s.hasWiki;
    case "projects": return s.hasProjects;
    case "settings": return canSeeSettings(s.owner, s.repo);
    default: return true;
  }
}

function canSeeSettings(owner: string, repo: string): boolean {
  const settingsPath = `/${owner}/${repo}/settings`;
  if (window.location.pathname === settingsPath || window.location.pathname.startsWith(`${settingsPath}/`)) {
    return true;
  }
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).some((link) => {
    if (link.closest(".oldgh-repo-header")) return false;
    const href = link.getAttribute("href")?.split(/[?#]/, 1)[0];
    return href === settingsPath || href?.startsWith(`${settingsPath}/`);
  });
}

function renderNavItem(s: RepoSummary, item: NavItem, active: NavKey | null): string {
  const href = `/${s.owner}/${s.repo}${item.path}`;
  const icon = octicon(item.icon, { size: 16 });
  const ariaCurrent = item.key === active ? ' aria-current="page"' : "";
  return `
    <li class="oldgh-repo-nav__item">
      <a class="oldgh-repo-tabs__link"
         data-tab="${item.key}"
         href="${escapeAttr(href)}"
         title="${escapeAttr(item.label)}"${ariaCurrent}>
        ${icon}<span>${item.label}</span>
      </a>
    </li>
  `;
}

function renderMoreMenu(s: RepoSummary, active: NavKey | null): string {
  const items = MORE_NAV.filter((item) => isNavItemAvailable(s, item.key));
  const isActive = !!active && items.some((item) => item.key === active);
  return `
    <details class="oldgh-repo-nav__more">
      <summary class="oldgh-repo-nav__more-trigger" title="More repository sections"${isActive ? ' aria-current="page"' : ""}>
        ${octicon("ellipsis", { size: 16 })}<span>More</span>
      </summary>
      <ul class="oldgh-repo-nav__more-list">
        ${items.map((item) => renderNavItem(s, item, active)).join("")}
      </ul>
    </details>
  `;
}

function renderClonePanel(s: RepoSummary): string {
  const https = `https://github.com/${s.owner}/${s.repo}.git`;
  const ssh = `git@github.com:${s.owner}/${s.repo}.git`;
  const branch = s.defaultBranch.split("/").map(encodeURIComponent).join("/");
  const zip = `/${s.owner}/${s.repo}/archive/refs/heads/${branch}.zip`;
  return `
    <div class="oldgh-repo-nav__clone">
      <p class="oldgh-repo-nav__clone-label"><strong data-clone-label>HTTPS</strong> clone URL</p>
      <div class="oldgh-repo-nav__clone-field">
        <input type="text" readonly value="${escapeAttr(https)}" data-clone-url aria-label="HTTPS clone URL" />
        <button type="button" data-clone-copy aria-label="Copy clone URL" title="Copy clone URL">${octicon("clippy", { size: 14 })}</button>
      </div>
      <p class="oldgh-repo-nav__clone-methods">
        You can clone with
        <button type="button" data-clone-method="HTTPS" data-clone-value="${escapeAttr(https)}" aria-pressed="true">HTTPS</button>
        or
        <button type="button" data-clone-method="SSH" data-clone-value="${escapeAttr(ssh)}" aria-pressed="false">SSH</button>.
      </p>
      <a class="oldgh-btn oldgh-repo-nav__download" href="${escapeAttr(zip)}">${octicon("cloud-download", { size: 14 })}<span>Download ZIP</span></a>
    </div>
  `;
}

function bindRepoHeader(header: HTMLElement): void {
  const input = header.querySelector<HTMLInputElement>("[data-clone-url]");
  const label = header.querySelector<HTMLElement>("[data-clone-label]");
  header.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const method = target?.closest<HTMLButtonElement>("[data-clone-method]");
    if (method && input && label) {
      const value = method.dataset["cloneValue"];
      const name = method.dataset["cloneMethod"];
      if (!value || !name) return;
      input.value = value;
      input.setAttribute("aria-label", `${name} clone URL`);
      label.textContent = name;
      header.querySelectorAll<HTMLButtonElement>("[data-clone-method]").forEach((button) => {
        button.setAttribute("aria-pressed", button === method ? "true" : "false");
      });
      return;
    }

    const copy = target?.closest<HTMLButtonElement>("[data-clone-copy]");
    if (!copy || !input) return;
    void copyCloneUrl(copy, input);
  });
}

async function copyCloneUrl(button: HTMLButtonElement, input: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.value);
    const previous = button.innerHTML;
    button.innerHTML = octicon("check", { size: 14 });
    button.classList.add("is-copied");
    window.setTimeout(() => {
      button.innerHTML = previous;
      button.classList.remove("is-copied");
    }, 1200);
  } catch {
    input.focus();
    input.select();
  }
}

function setNavigationMode(owner: string, repo: string, pathname: string): void {
  const prefix = `/${owner}/${repo}`;
  const mode = pathname === prefix || pathname === `${prefix}/` ? "wide" : "compact";
  document.documentElement.setAttribute("data-oldgh-repo-nav", mode);
}

function currentNavKey(owner: string, repo: string, pathname: string): NavKey | null {
  const prefix = `/${owner}/${repo}`;
  if (pathname === prefix || pathname === `${prefix}/`) return "code";
  const rest = pathname.slice(prefix.length);
  if (rest.startsWith("/releases")) return "releases";
  if (rest.startsWith("/tree/") || rest.startsWith("/blob/") || rest.startsWith("/commits") || rest.startsWith("/commit/") || rest.startsWith("/tags") || rest.startsWith("/branches")) {
    return "code";
  }
  if (rest.startsWith("/issues") || rest.startsWith("/labels") || rest.startsWith("/milestones") || rest.startsWith("/milestone/")) return "issues";
  if (rest.startsWith("/pulls") || rest.startsWith("/pull/")) return "pulls";
  if (rest.startsWith("/discussions")) return "discussions";
  if (rest.startsWith("/actions") || rest.startsWith("/runs/")) return "actions";
  if (rest.startsWith("/projects")) return "projects";
  if (rest.startsWith("/wiki")) return "wiki";
  if (rest.startsWith("/security") || rest.startsWith("/dependabot")) return "security";
  if (rest.startsWith("/pulse")) return "pulse";
  if (rest.startsWith("/graphs") || rest.startsWith("/community")) return "graphs";
  if (rest.startsWith("/network")) return "network";
  if (rest.startsWith("/settings")) return "settings";
  return null;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
