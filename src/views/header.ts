import { octicon } from "@/icons";
import { getMe, type Me } from "@/adapters/me";
import { getUnreadCount } from "@/adapters/notifications";
import { AdapterFailure } from "@/adapters";
import { getCurrentTheme, setTheme, type Theme } from "@/theme";

const POLL_INTERVAL_MS = 60_000;

const IS_GIST_SUBDOMAIN = typeof window !== "undefined" && window.location.hostname === "gist.github.com";

type RepositoryContext = { owner: string; repo: string };
type SearchScope = "repository" | "global";

let repositoryContext: RepositoryContext | null = null;

export async function mountHeader(): Promise<void> {
  hideModernHeader();

  const root = document.createElement("div");
  root.className = "oldgh-header";
  root.dataset.oldgh = "header";
  document.body.prepend(root);

  let me: Me;
  try {
    me = await getMe();
  } catch (err) {
    if (err instanceof AdapterFailure) {
      console.debug("[oldgh] header adapter failure:", err.name, err.message);
      root.remove();
      restoreModernHeader();
      return;
    }
    throw err;
  }

  root.innerHTML = renderHeaderHtml(me);
  if (IS_GIST_SUBDOMAIN) absolutizeGithubHrefs(root);
  bindSearchForm(root);
  bindAvatarMenu(root);
  bindThemeMenu(root);
  void startNotificationPolling(root);
  void syncThemeMenuState(root);
}

// on gist.github.com, our header's relative hrefs would resolve to
// gist.github.com/... (404). Rewrite them to absolute github.com so nav works.
function absolutizeGithubHrefs(root: HTMLElement): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach((a) => {
    a.href = "https://github.com" + a.getAttribute("href")!;
  });
  root.querySelectorAll<HTMLFormElement>('form[action^="/"]').forEach((f) => {
    f.action = "https://github.com" + f.getAttribute("action")!;
  });
}

function renderHeaderHtml(me: Me): string {
  const logo = octicon("mark-github", { size: 28, ariaLabel: "GitHub" });
  const chevron = octicon("triangle-down", { className: "oldgh-chevron" });
  return `
    <div class="oldgh-header__inner">
      <a class="oldgh-header__logo" href="/" aria-label="GitHub">${logo}</a>
      <a class="oldgh-header__notifications" href="/notifications" aria-label="Notifications" title="Notifications">
        <span class="oldgh-header__notification-dot" aria-hidden="true"></span>
      </a>
      <form class="oldgh-header__search" action="/search" method="get" role="search" data-search-scope="global">
        <details class="oldgh-header__menu oldgh-header__scope">
          <summary aria-label="Search scope">
            <strong class="oldgh-header__scope-label">All GitHub</strong>
            ${chevron}
          </summary>
          <ul class="oldgh-header__menu-list" role="menu">
            <li role="none" data-repository-scope hidden>
              <button type="button" role="menuitemradio" data-search-scope="repository" aria-checked="false">
                <strong>This repository</strong>
                <span class="oldgh-header__scope-repo"></span>
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitemradio" data-search-scope="global" aria-checked="true">
                <strong>All GitHub</strong>
              </button>
            </li>
          </ul>
        </details>
        <input
          class="oldgh-header__search-input"
          type="search"
          name="q"
          placeholder="Search or type a command"
          aria-label="Search or type a command"
          autocomplete="off"
        />
        <a class="oldgh-header__search-help" href="https://docs.github.com/search-github" aria-label="Search help" title="Search help">
          ${octicon("question", { size: 14 })}
        </a>
        <input type="hidden" name="ref" value="cmdform" />
      </form>
      <details class="oldgh-header__menu oldgh-header__menu--theme" data-oldgh-theme-menu>
        <summary aria-label="Theme" title="Theme">
          ${octicon("gear", { size: 16 })}
        </summary>
        <ul class="oldgh-header__menu-list" role="menu">
          <li class="oldgh-header__menu-label" role="presentation">Theme</li>
          <li role="none"><button type="button" role="menuitemradio" class="oldgh-header__menu-button" data-theme="light">${sunSvg("", 14)} Light</button></li>
          <li role="none"><button type="button" role="menuitemradio" class="oldgh-header__menu-button" data-theme="dark">${moonSvg("", 14)} Dark</button></li>
          <li role="none"><button type="button" role="menuitemradio" class="oldgh-header__menu-button" data-theme="auto">${octicon("device-desktop", { size: 14 })} Match system</button></li>
        </ul>
      </details>
      <nav class="oldgh-header__nav" aria-label="Primary" data-oldgh-topnav>
        <a href="/explore" data-topnav-key="explore">Explore</a>
        <a href="https://gist.github.com">Gist</a>
        <a href="https://github.blog">Blog</a>
        <a href="https://docs.github.com">Help</a>
      </nav>
      <div class="oldgh-header__actions">
        <a class="oldgh-header__user" href="${escapeAttr(me.profileUrl)}" title="View profile">
          <img class="oldgh-header__avatar" src="${escapeAttr(me.avatarUrl)}" alt="" width="20" height="20" />
          <strong>${escapeText(me.login)}</strong>
        </a>
        <details class="oldgh-header__menu oldgh-header__menu--new">
          <summary aria-label="Create new" title="Create new">
            <span class="oldgh-header__new-icon">${octicon("repo", { size: 16 })}${octicon("plus-small", { size: 7 })}</span>
          </summary>
          <ul class="oldgh-header__menu-list" role="menu">
            <li role="none"><a role="menuitem" href="/new">New repository</a></li>
            <li role="none"><a role="menuitem" href="/new/import">Import repository</a></li>
            <li role="none"><a role="menuitem" href="https://gist.github.com">New gist</a></li>
            <li role="none"><a role="menuitem" href="/organizations/new">New organization</a></li>
          </ul>
        </details>
        <details class="oldgh-header__menu oldgh-header__menu--account">
          <summary aria-label="Account menu" title="Account menu">${octicon("tools", { size: 16 })}</summary>
          <ul class="oldgh-header__menu-list" role="menu">
            <li class="oldgh-header__menu-label" role="presentation">
              Signed in as <strong>${escapeText(me.login)}</strong>
            </li>
            <li role="none"><a role="menuitem" href="${escapeAttr(me.profileUrl)}">Your profile</a></li>
            <li role="none"><a role="menuitem" href="${escapeAttr(me.profileUrl)}?tab=repositories">Your repositories</a></li>
            <li role="none"><a role="menuitem" href="/issues">Your issues</a></li>
            <li role="none"><a role="menuitem" href="/pulls">Your pull requests</a></li>
            <li role="none"><a role="menuitem" href="/stars">Your stars</a></li>
            <li role="none"><a role="menuitem" href="/settings/profile">Settings</a></li>
          </ul>
        </details>
        <form class="oldgh-header__logout" action="/logout" method="post" data-oldgh-logout>
          <button type="submit" aria-label="Sign out" title="Sign out">${octicon("sign-out", { size: 16 })}</button>
        </form>
      </div>
    </div>
  `;
}

// keep the global header search box in sync with the active /search query so
// it reads like native GitHub (the box holds your query for refining), and
// clears it off the search page.
export function syncSearchInput(pathname: string, search: string): void {
  const input = document.querySelector<HTMLInputElement>(".oldgh-header__search-input");
  if (!input) return;
  if (input === document.activeElement) return;
  if (pathname === "/search") {
    const query = new URLSearchParams(search).get("q") ?? "";
    input.value = repositoryContext
      ? query.replace(new RegExp(`(^|\\s)repo:${escapeRegExp(repositoryContext.owner)}/${escapeRegExp(repositoryContext.repo)}(?=\\s|$)`, "i"), " ").trim()
      : query;
  } else {
    input.value = "";
  }
}

export function syncHeaderRepositoryContext(owner: string | null, repo: string | null): void {
  const next = owner && repo ? { owner, repo } : null;
  repositoryContext = next;

  const form = document.querySelector<HTMLFormElement>("form.oldgh-header__search");
  if (!form) return;
  const repositoryItem = form.querySelector<HTMLElement>("[data-repository-scope]");
  const repositoryName = form.querySelector<HTMLElement>(".oldgh-header__scope-repo");
  if (repositoryItem) repositoryItem.hidden = !next;
  if (repositoryName) repositoryName.textContent = next ? `${next.owner}/${next.repo}` : "";

  setSearchScope(form, next ? "repository" : "global");
}

function bindSearchForm(root: HTMLElement): void {
  // on gist.github.com let the browser submit to the absolutized github.com URL
  if (IS_GIST_SUBDOMAIN) return;
  const form = root.querySelector<HTMLFormElement>("form.oldgh-header__search");
  if (!form) return;
  form.addEventListener("click", (e) => {
    const button = (e.target as Element | null)?.closest<HTMLButtonElement>("button[data-search-scope]");
    if (!button) return;
    const scope = button.dataset["searchScope"] as SearchScope | undefined;
    if (!scope || (scope === "repository" && !repositoryContext)) return;
    setSearchScope(form, scope);
    form.querySelector<HTMLDetailsElement>(".oldgh-header__scope")?.removeAttribute("open");
  });
  form.addEventListener("submit", (e) => {
    const input = form.querySelector<HTMLInputElement>('input[name="q"]');
    const q = input?.value.trim();
    if (!q) return;
    e.preventDefault();
    const context = form.dataset["searchScope"] === "repository" ? repositoryContext : null;
    const query = context ? `repo:${context.owner}/${context.repo} ${q}` : q;
    const type = context ? "&type=code" : "";
    const url = `/search?q=${encodeURIComponent(query)}${type}&ref=cmdform`;
    window.location.assign(url);
  });
}

function setSearchScope(form: HTMLFormElement, scope: SearchScope): void {
  form.dataset.searchScope = scope;
  const label = form.querySelector<HTMLElement>(".oldgh-header__scope-label");
  if (label) label.textContent = scope === "repository" ? "This repository" : "All GitHub";
  form.querySelectorAll<HTMLButtonElement>("button[data-search-scope]").forEach((button) => {
    button.setAttribute("aria-checked", button.dataset["searchScope"] === scope ? "true" : "false");
  });
}

function bindAvatarMenu(root: HTMLElement): void {
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    root.querySelectorAll<HTMLDetailsElement>("details.oldgh-header__menu").forEach((d) => {
      if (!d.contains(target)) d.open = false;
    });
  });

  const logoutForm = root.querySelector<HTMLFormElement>('form[data-oldgh-logout]');
  if (logoutForm) {
    logoutForm.addEventListener("submit", (e) => {
      const token = document
        .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
        ?.content;
      if (!token) return;
      let input = logoutForm.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "authenticity_token";
        logoutForm.append(input);
      }
      input.value = token;
      void e;
    });
  }
}

function sunSvg(extraClass: string, size: number): string {
  return `<svg class="octicon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0zm0 13.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13.5zM2.343 2.343a.75.75 0 0 1 1.06 0l1.061 1.061a.75.75 0 0 1-1.06 1.06L2.343 3.404a.75.75 0 0 1 0-1.06zM11.536 11.536a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061zM0 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8zm13.5 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75zM2.343 13.657a.75.75 0 0 1 0-1.061l1.06-1.06a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0zm9.193-9.193a.75.75 0 0 1 0-1.06l1.06-1.061a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0z"/></svg>`;
}

function moonSvg(extraClass: string, size: number): string {
  return `<svg class="octicon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.598 1.591a.75.75 0 0 1 .785-.175 7 7 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786z"/></svg>`;
}

function bindThemeMenu(root: HTMLElement): void {
  const menu = root.querySelector<HTMLDetailsElement>("[data-oldgh-theme-menu]");
  if (!menu) return;
  menu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-theme]");
    if (!btn) return;
    e.preventDefault();
    const value = btn.dataset["theme"] as Theme | undefined;
    if (!value) return;
    void setTheme(value).then(() => {
      menu.open = false;
      void syncThemeMenuState(root);
    });
  });
}

async function syncThemeMenuState(root: HTMLElement): Promise<void> {
  const current = await getCurrentTheme();
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>(".oldgh-header__menu--theme button[data-theme]"))) {
    btn.setAttribute("aria-checked", btn.dataset["theme"] === current ? "true" : "false");
  }
}

async function startNotificationPolling(root: HTMLElement): Promise<void> {
  const dot = root.querySelector<HTMLElement>(".oldgh-header__notification-dot");
  const link = root.querySelector<HTMLAnchorElement>(".oldgh-header__notifications");
  if (!dot || !link) return;

  let consecutiveFailures = 0;
  let intervalId: number | null = null;

  const update = async (): Promise<void> => {
    try {
      const count = await getUnreadCount();
      consecutiveFailures = 0;
      if (count > 0) {
        dot.classList.add("is-unread");
        link.setAttribute("aria-label", `${count > 99 ? "99+" : count} unread notifications`);
        link.title = `${count > 99 ? "99+" : count} unread notifications`;
      } else {
        dot.classList.remove("is-unread");
        link.setAttribute("aria-label", "Notifications");
        link.title = "Notifications";
      }
    } catch (err) {
      consecutiveFailures++;
      const reason = err instanceof AdapterFailure ? err.name + ": " + err.message : String(err);
      // log the first failure at debug, then stay quiet — the badge isn't
      // worth a console entry per minute when the endpoint is unreachable
      if (consecutiveFailures === 1) {
        console.debug("[oldgh] notifications poll skipped:", reason);
      }
      if (consecutiveFailures >= 3 && intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
        console.debug("[oldgh] notifications poll halted after 3 consecutive failures");
      }
    }
  };

  await update();
  intervalId = window.setInterval(() => {
    void update();
  }, POLL_INTERVAL_MS);
}

export function updateTopNavActive(pathname: string): void {
  const nav = document.querySelector<HTMLElement>("[data-oldgh-topnav]");
  if (!nav) return;
  const key = pathname === "/explore" || pathname.startsWith("/explore/") || pathname === "/trending" || pathname.startsWith("/trending/")
    ? "explore"
    : null;
  for (const a of Array.from(nav.querySelectorAll<HTMLAnchorElement>("a[data-topnav-key]"))) {
    if (key && a.dataset["topnavKey"] === key) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  }
}

function hideModernHeader(): void {
  document.documentElement.setAttribute("data-oldgh-hide-modern-header", "");
}

function restoreModernHeader(): void {
  document.documentElement.removeAttribute("data-oldgh-hide-modern-header");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
