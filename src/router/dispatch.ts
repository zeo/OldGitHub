import { AdapterFailure } from "@/adapters";
import { isApiRateLimited } from "@/adapters/rate-limit";
import { mountRepoHeader, unmountRepoHeader, updateActiveTab, prefetchRepoSummary } from "@/views/repo-header";
import { updateTopNavActive, syncHeaderRepositoryContext, syncSearchInput } from "@/views/header";
import type { RepoListKind } from "@/views/repo-lists";
import { beginNavigation, isCurrentNavigation, removeAllBodyRoots } from "@/views/_body";
import { resolveRoute, type Route } from "./resolve";
import { reportIssueUrl } from "@/native-mode";
import { escapeAttr, escapeText, safeDecodeURIComponent } from "@/util/html";

const MOUNTED_ATTR = "data-oldgh-mounted";

type RepoKey = { owner: string; repo: string };
type MountableRoute = Exclude<Route, { kind: "out-of-scope" }>;

let mountedRepo: RepoKey | null = null;
let mountedBodyKey = "";
let progressBarEl: HTMLElement | null = null;
let progressTimer: number | null = null;

function insertBodyError(message: string, rateLimited: boolean): void {
  document.querySelectorAll(".oldgh-body-error").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "oldgh-body-root oldgh-body-error";
  el.innerHTML = rateLimited
    ? `
      <div class="oldgh-page oldgh-body-error__page">
        <h2>GitHub rate-limited this request.</h2>
        <p>GitHub allows 60 API requests an hour without a token and 5,000 with one. This browser has used its share for now.</p>
        <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
        <p><a href="#" data-oldgh-open-options>Add a token in OldGitHub options</a>, wait for the limit to reset, or <a href="#" data-oldgh-show-native>show GitHub's native page instead</a>.</p>
      </div>
    `
    : `
      <div class="oldgh-page oldgh-body-error__page">
        <h2>Couldn't render this page natively.</h2>
        <p>The OldGitHub adapter for this URL didn't return data we could use, so the original GitHub UI is hidden to avoid showing two skins at once.</p>
        <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
        <p><a href="${escapeAttr(window.location.href)}">Reload</a> or <a href="#" data-oldgh-show-native>show GitHub's native page instead</a>. If it keeps happening, <a href="${escapeAttr(reportIssueUrl(message))}" target="_blank" rel="noopener noreferrer">report it</a>.</p>
      </div>
    `;
  const after = document.querySelector(".oldgh-repo-header") || document.querySelector(".oldgh-header");
  if (after && after.parentNode) {
    after.after(el);
  } else {
    insertBeforeFooter(el);
  }
}

function showProgress(): void {
  if (!progressBarEl) {
    progressBarEl = document.createElement("div");
    progressBarEl.className = "oldgh-progress-bar";
    document.documentElement.appendChild(progressBarEl);
  }
  progressBarEl.classList.remove("oldgh-progress-bar--hide");
  progressBarEl.classList.add("oldgh-progress-bar--show");
  if (progressTimer != null) {
    window.clearTimeout(progressTimer);
    progressTimer = null;
  }
}

function hideProgress(): void {
  if (!progressBarEl) return;
  progressBarEl.classList.remove("oldgh-progress-bar--show");
  progressBarEl.classList.add("oldgh-progress-bar--hide");
  if (progressTimer != null) window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    if (progressBarEl) progressBarEl.classList.remove("oldgh-progress-bar--hide");
  }, 300);
}

export async function dispatchRoute(loc: Location | URL, options: { scrollTop?: boolean } = {}): Promise<void> {
  const nav = beginNavigation();
  const pathname = currentPath(loc);
  const search = currentSearch(loc);
  const route = resolveRoute(pathname, search);

  // fire-and-forget: the message may throw or reject when the sw recycles
  try {
    void chrome.runtime.sendMessage({ type: "oldgh:route-change", pathname, search }).catch(() => {});
  } catch {}

  const willMount = route.kind !== "out-of-scope";
  if (willMount) {
    document.documentElement.setAttribute(MOUNTED_ATTR, route.kind);
    showProgress();
  }
  updateTopNavActive(pathname);
  if ("owner" in route && "repo" in route) {
    syncHeaderRepositoryContext(route.owner, route.repo);
  } else if (route.kind === "top-level" && route.subkind === "search") {
    const query = new URLSearchParams(search).get("q") ?? "";
    const repository = /(?:^|\s)repo:([^/\s]+)\/([^\s]+)/i.exec(query);
    syncHeaderRepositoryContext(repository?.[1] ?? null, repository?.[2] ?? null);
  } else {
    syncHeaderRepositoryContext(null, null);
  }
  syncSearchInput(pathname, search);
  const newTitle = titleForRoute(route, pathname);
  if (newTitle) document.title = newTitle;

  // keep the previous shell visible as a still until new fetches settle so headers and bodies swap cleanly
  try {
    if (route.kind === "out-of-scope") {
      // github responds with X-Frame-Options: deny, so drop our body and let the native page show below our header
      mountedBodyKey = "";
      removeAllBodyRoots();
      teardownRepoHeader();
      clearMounted();
      return;
    }

    const targetKey = bodyKey(route, pathname, search);
    if ("owner" in route && "repo" in route) {
      const sameRepo = mountedRepo && mountedRepo.owner === route.owner && mountedRepo.repo === route.repo;
      if (sameRepo) {
        updateActiveTab(route.owner, route.repo, pathname);
        await applyRouteBody(route, pathname, search, targetKey, nav);
        return;
      }
      const summaryPromise = prefetchRepoSummary(route.owner, route.repo);
      await applyRouteBody(route, pathname, search, targetKey, nav);
      if (!isCurrentNavigation(nav)) return;
      await mountRepoHeader(route.owner, route.repo, summaryPromise);
      if (!isCurrentNavigation(nav)) return;
      mountedRepo = { owner: route.owner, repo: route.repo };
      return;
    }

    await applyRouteBody(route, pathname, search, targetKey, nav);
    if (isCurrentNavigation(nav)) teardownRepoHeader();
  } catch (err) {
    if (!isCurrentNavigation(nav)) return;
    mountedBodyKey = "";
    removeAllBodyRoots();
    const inMountedRepo = "owner" in route && "repo" in route && mountedRepo?.owner === route.owner && mountedRepo.repo === route.repo;
    if (!inMountedRepo) teardownRepoHeader();
    if (!(err instanceof AdapterFailure)) {
      console.error("[oldgh] dispatch failed:", err);
      insertBodyError(err instanceof Error ? err.message : String(err), false);
      return;
    }
    console.debug("[oldgh] dispatch adapter failure:", err.name, err.message);
    if (err.status === 404) {
      insertBodyNotFound(err.message, inMountedRepo);
      return;
    }
    const rateLimited = err.status === 429 || (err.status === 403 && isApiRateLimited()) || /rate-limited/i.test(err.message);
    insertBodyError(err.message, rateLimited);
  } finally {
    if (isCurrentNavigation(nav)) {
      hideProgress();
      if (!scrollToHashIfPresent(loc) && options.scrollTop) window.scrollTo(0, 0);
    }
  }
}

function bodyKey(route: MountableRoute, pathname: string, search: string): string {
  if (route.kind === "repo-other") {
    return JSON.stringify({ kind: route.kind, owner: route.owner, repo: route.repo, pathname, search });
  }
  return JSON.stringify(route);
}

function scrollToHashIfPresent(loc: Location | URL): boolean {
  const hash = loc.hash || "";
  if (!hash || hash === "#") return false;
  const id = hash.replace(/^#/, "");
  const tryScroll = (): boolean => {
    let el: Element | null = null;
    try {
      el = document.getElementById(id) ?? document.querySelector(`[id="${CSS.escape(id)}"]`);
    } catch {
      el = document.getElementById(id);
    }
    if (!el) return false;
    el.scrollIntoView({ block: "start" });
    return true;
  };
  if (tryScroll()) return true;
  window.setTimeout(() => { if (!tryScroll()) window.setTimeout(tryScroll, 400); }, 80);
  return true;
}

function insertBodyNotFound(message: string, inRepo: boolean): void {
  document.querySelectorAll(".oldgh-body-error").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "oldgh-body-root oldgh-body-error";
  el.innerHTML = `
    <div class="oldgh-page oldgh-body-error__page">
      <h2>${inRepo ? "This section isn't available." : "This page isn't available."}</h2>
      <p>${inRepo ? "The page you requested couldn't be found in this repository. It may be disabled, moved, or never existed." : "GitHub returned 404 for this page. It may be private, moved, or never existed."}</p>
      <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
      <p>If it's a private repository, <a href="#" data-oldgh-open-options>add a token in OldGitHub options</a> so it can be read.</p>
      <p><a href="#" data-oldgh-show-native>Show GitHub's native page instead</a>.</p>
    </div>
  `;
  const after = document.querySelector(".oldgh-repo-header") || document.querySelector(".oldgh-header");
  if (after && after.parentNode) {
    after.after(el);
  } else {
    insertBeforeFooter(el);
  }
}

function clearMounted(): void {
  document.documentElement.removeAttribute(MOUNTED_ATTR);
  removeAllBodyRoots();
}

function matchRepoList(subPath: string): RepoListKind | null {
  const seg = subPath.replace(/^\//, "").split(/[/?]/)[0];
  if (seg === "tags" || seg === "branches" || seg === "forks" || seg === "stargazers" || seg === "watchers" || seg === "labels" || seg === "milestones") {
    return seg as RepoListKind;
  }
  return null;
}

function repoOtherTitle(owner: string, repo: string, pathname: string): string {
  const prefix = `/${owner}/${repo}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const first = rest.split("/")[0] || "Other";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function teardownRepoHeader(): void {
  unmountRepoHeader();
  mountedRepo = null;
}

async function applyRouteBody(
  route: MountableRoute,
  pathname: string,
  search: string,
  targetKey: string,
  nav: number,
): Promise<void> {
  if (mountedBodyKey === targetKey) return;
  mountedBodyKey = "";
  await mountRoute(route, pathname, search, nav);
  if (isCurrentNavigation(nav)) mountedBodyKey = targetKey;
}

// a view module that finishes loading after a newer navigation must not mount
async function load<T>(nav: number, module: Promise<T>): Promise<T> {
  const loaded = await module;
  if (!isCurrentNavigation(nav)) throw new Error("superseded by a newer navigation");
  return loaded;
}

async function mountRoute(route: MountableRoute, pathname: string, search: string, nav: number): Promise<void> {
  switch (route.kind) {
    case "repo-home":
      await (await load(nav, import("@/views/repo-home"))).mountRepoHome(route.owner, route.repo);
      return;
    case "repo-tree":
      await (await load(nav, import("@/views/repo-tree"))).mountRepoTree(route.owner, route.repo, route.refAndPath);
      return;
    case "repo-blob":
      await (await load(nav, import("@/views/repo-blob"))).mountRepoBlob(route.owner, route.repo, route.refAndPath, route.query);
      return;
    case "repo-commits":
      await (await load(nav, import("@/views/repo-commits"))).mountRepoCommits(route.owner, route.repo, route.refAndPath, route.query);
      return;
    case "repo-commit":
      await (await load(nav, import("@/views/repo-commit"))).mountRepoCommit(route.owner, route.repo, route.sha);
      return;
    case "repo-compare":
      await (await load(nav, import("@/views/repo-compare"))).mountRepoCompare(route.owner, route.repo, route.range);
      return;
    case "repo-issues":
      await (await load(nav, import("@/views/repo-issues"))).mountRepoIssues(route.owner, route.repo, route.query, route.subkind);
      return;
    case "repo-issue":
      await (await load(nav, import("@/views/repo-issue"))).mountRepoIssue(route.owner, route.repo, route.number, route.subkind, route.tab);
      return;
    case "repo-wiki":
      await (await load(nav, import("@/views/repo-wiki"))).mountRepoWiki(route.owner, route.repo, route.page);
      return;
    case "repo-actions":
      await (await load(nav, import("@/views/repo-actions"))).mountRepoActions(route.owner, route.repo, route.query, route.workflowPath ?? null);
      return;
    case "repo-actions-run":
      await (await load(nav, import("@/views/repo-actions-run"))).mountRepoActionsRun(route.owner, route.repo, route.runId);
      return;
    case "repo-pulse":
      await (await load(nav, import("@/views/repo-pulse"))).mountRepoPulse(route.owner, route.repo);
      return;
    case "repo-graphs":
      await (await load(nav, import("@/views/repo-graphs"))).mountRepoGraphs(route.owner, route.repo, route.subkind);
      return;
    case "repo-projects":
      await (await load(nav, import("@/views/repo-projects"))).mountRepoProjects(route.owner, route.repo, route.query);
      return;
    case "repo-security":
      await (await load(nav, import("@/views/repo-security"))).mountRepoSecurity(route.owner, route.repo, route.subkind === "advisories" ? "advisories" : "overview");
      return;
    case "repo-discussions":
      await (await load(nav, import("@/views/repo-discussions"))).mountRepoDiscussions(route.owner, route.repo, route.subPath, route.query);
      return;
    case "repo-discussion":
      await (await load(nav, import("@/views/repo-discussion"))).mountRepoDiscussion(route.owner, route.repo, route.number);
      return;
    case "repo-settings":
      await (await load(nav, import("@/views/repo-settings"))).mountRepoSettings(route.owner, route.repo, route.subPath);
      return;
    case "repo-other": {
      const prefix = `/${route.owner}/${route.repo}`;
      const subPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
      if (subPath === "/releases" || subPath.startsWith("/releases?") || subPath === "/releases/") {
        await (await load(nav, import("@/views/repo-releases"))).mountRepoReleases(route.owner, route.repo, search);
        return;
      }
      if (subPath.startsWith("/releases/latest")) {
        await (await load(nav, import("@/views/repo-releases"))).mountRepoReleases(route.owner, route.repo, "");
        return;
      }
      if (subPath.startsWith("/releases/tag/")) {
        const tag = safeDecodeURIComponent(subPath.slice("/releases/tag/".length).replace(/\/+$/, ""));
        if (tag) {
          await (await load(nav, import("@/views/repo-releases"))).mountRepoReleases(route.owner, route.repo, "", tag);
          return;
        }
      }
      const listMatch = matchRepoList(subPath);
      if (listMatch) {
        await (await load(nav, import("@/views/repo-lists"))).mountRepoList(route.owner, route.repo, listMatch, search);
        return;
      }
      const full = subPath + (search ? "?" + search : "");
      await (await load(nav, import("@/views/repo-section"))).mountRepoSection(route.owner, route.repo, "other", full || "/", repoOtherTitle(route.owner, route.repo, pathname));
      return;
    }
    case "profile":
      await (await load(nav, import("@/views/profile"))).mountProfile(route.login, route.tab, route.query);
      return;
    case "top-level":
      await mountTopLevelRoute(route, nav);
  }
}

async function mountTopLevelRoute(route: Extract<Route, { kind: "top-level" }>, nav: number): Promise<void> {
  switch (route.subkind) {
    case "dashboard":
      await (await load(nav, import("@/views/dashboard"))).mountDashboard();
      return;
    case "notifications":
      await (await load(nav, import("@/views/notifications"))).mountNotifications(route.search);
      return;
    case "search":
      await (await load(nav, import("@/views/search"))).mountSearch(route.pathname, route.search);
      return;
    case "stars":
      await (await load(nav, import("@/views/stars"))).mountStars(route.pathname, route.search);
      return;
    case "trending":
      await (await load(nav, import("@/views/trending"))).mountTrending(route.pathname, route.search);
      return;
    case "explore":
      await (await load(nav, import("@/views/explore"))).mountExplore();
      return;
    case "topic":
      await (await load(nav, import("@/views/topic"))).mountTopic(route.pathname, route.search);
      return;
    case "marketplace":
      await (await load(nav, import("@/views/marketplace"))).mountMarketplace(route.pathname, route.search);
      return;
    case "collections":
      await (await load(nav, import("@/views/collections"))).mountCollections(route.pathname);
      return;
    case "sponsors":
      await (await load(nav, import("@/views/sponsors"))).mountSponsors(route.pathname, route.search);
      return;
    case "watching":
      await (await load(nav, import("@/views/watching"))).mountWatching(route.pathname, route.search);
      return;
    case "topics":
      await (await load(nav, import("@/views/topics"))).mountTopics(route.pathname, route.search);
      return;
    case "issues":
      await (await load(nav, import("@/views/me-issues"))).mountMeIssues("issue", route.pathname, route.search);
      return;
    case "pulls":
      await (await load(nav, import("@/views/me-issues"))).mountMeIssues("pull", route.pathname, route.search);
      return;
    case "settings":
      await (await load(nav, import("@/views/account-settings"))).mountAccountSettings(route.pathname, route.search);
      return;
    default:
      await (await load(nav, import("@/views/top-level"))).mountTopLevel(route.subkind, route.pathname, route.search, route.title);
  }
}

function insertBeforeFooter(el: HTMLElement): void {
  const footer = document.querySelector(".oldgh-footer");
  if (footer && footer.parentNode === document.body) {
    document.body.insertBefore(el, footer);
  } else {
    document.body.append(el);
  }
}

function currentPath(loc: Location | URL): string {
  return "pathname" in loc ? loc.pathname : new URL(String(loc)).pathname;
}

function currentSearch(loc: Location | URL): string {
  const raw = "search" in loc ? loc.search : new URL(String(loc)).search;
  return raw.startsWith("?") ? raw.slice(1) : raw;
}

function titleForRoute(route: Route, pathname: string): string {
  if (route.kind === "out-of-scope") return "";
  if (route.kind === "profile") return `${route.login}`;
  if (route.kind === "top-level") return route.title || "GitHub";
  const nwo = `${route.owner}/${route.repo}`;
  switch (route.kind) {
    case "repo-issues": return `${route.subkind === "pulls" ? "Pull requests" : "Issues"} · ${nwo}`;
    case "repo-issue": return `#${route.number} · ${nwo}`;
    case "repo-wiki": return `${route.page === "Home" ? "Wiki" : route.page} · ${nwo}`;
    case "repo-actions": return `Actions · ${nwo}`;
    case "repo-actions-run": return `Run #${route.runId} · ${nwo}`;
    case "repo-pulse": return `Pulse · ${nwo}`;
    case "repo-graphs": return `Insights · ${nwo}`;
    case "repo-projects": return `Projects · ${nwo}`;
    case "repo-security": return `Security · ${nwo}`;
    case "repo-discussions": return `Discussions · ${nwo}`;
    case "repo-discussion": return `Discussion #${route.number} · ${nwo}`;
    case "repo-settings": return `Settings · ${nwo}`;
    case "repo-commits": return `Commits · ${nwo}`;
    case "repo-commit": return `${route.sha.slice(0, 7)} · ${nwo}`;
    case "repo-compare": return `Compare · ${nwo}`;
    case "repo-blob":
    case "repo-tree": {
      const last = route.refAndPath.split("/").filter(Boolean).slice(-1)[0];
      return last ? `${last} · ${nwo}` : nwo;
    }
    case "repo-other": {
      const sub = pathname.replace(`/${route.owner}/${route.repo}`, "").replace(/^\//, "").split(/[/?]/)[0] || "";
      const label = REPO_OTHER_TITLE[sub];
      return label ? `${label} · ${nwo}` : nwo;
    }
    default: return nwo;
  }
}

const REPO_OTHER_TITLE: Record<string, string> = {
  releases: "Releases",
  tags: "Tags",
  branches: "Branches",
  stargazers: "Stargazers",
  forks: "Forks",
  watchers: "Watchers",
  labels: "Labels",
  milestones: "Milestones",
};
