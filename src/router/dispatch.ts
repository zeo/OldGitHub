import { AdapterFailure } from "@/adapters";
import { mountRepoHeader, unmountRepoHeader, updateActiveTab, prefetchRepoSummary } from "@/views/repo-header";
import { updateTopNavActive, syncHeaderRepositoryContext, syncSearchInput } from "@/views/header";
import type { RepoListKind } from "@/views/repo-lists";
import type { TopLevelKind } from "@/views/top-level";
import { removeAllBodyRoots } from "@/views/_body";
import { resolveRoute, type Route } from "./resolve";

const MOUNTED_ATTR = "data-oldgh-mounted";

type RepoKey = { owner: string; repo: string };

type BodyState =
  | { kind: "none" }
  | { kind: "home"; owner: string; repo: string }
  | { kind: "tree"; owner: string; repo: string; refAndPath: string }
  | { kind: "blob"; owner: string; repo: string; refAndPath: string }
  | { kind: "commits"; owner: string; repo: string; refAndPath: string; query: string }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | { kind: "compare"; owner: string; repo: string; range: string }
  | { kind: "issues"; owner: string; repo: string; query: string; subkind: "issues" | "pulls" }
  | { kind: "issue"; owner: string; repo: string; number: number; subkind: "issue" | "pull"; tab: "conversation" | "files" | "commits" | "checks" }
  | { kind: "wiki"; owner: string; repo: string; page: string }
  | { kind: "actions"; owner: string; repo: string; query: string; workflowPath: string | null }
  | { kind: "actions-run"; owner: string; repo: string; runId: string }
  | { kind: "pulse"; owner: string; repo: string }
  | { kind: "graphs"; owner: string; repo: string; subkind: "contributors" | "commit-activity" | "code-frequency" | "traffic" | "community" | "network" }
  | { kind: "projects"; owner: string; repo: string; query: string }
  | { kind: "security"; owner: string; repo: string; subkind: "overview" | "advisories" }
  | { kind: "discussions"; owner: string; repo: string; subPath: string; query: string }
  | { kind: "discussion"; owner: string; repo: string; number: number }
  | { kind: "settings"; owner: string; repo: string; subPath: string }
  | { kind: "repo-other"; owner: string; repo: string; pathname: string; search: string; title: string }
  | { kind: "top-level"; subkind: TopLevelKind; pathname: string; search: string; title: string }
  | { kind: "profile"; login: string; tab: string; query: string };

let mountedRepo: RepoKey | null = null;
let bodyState: BodyState = { kind: "none" };
let progressBarEl: HTMLElement | null = null;
let progressTimer: number | null = null;

function insertBodyError(message: string): void {
  document.querySelectorAll(".oldgh-body-placeholder, .oldgh-body-error").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "oldgh-body-root oldgh-body-error";
  const rateLimited = /responded 403\b/.test(message) || /responded 429\b/.test(message) || /rate-limited/i.test(message);
  el.innerHTML = rateLimited
    ? `
      <div class="oldgh-page oldgh-body-error__page">
        <h2>GitHub rate-limited this request.</h2>
        <p>OldGitHub talks to the public GitHub API without authentication, which caps you at 60 requests per hour. You've hit that ceiling.</p>
        <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
        <p>Wait an hour, or <a href="javascript:void(0)" data-oldgh-show-native>show GitHub's native page instead</a>.</p>
      </div>
    `
    : `
      <div class="oldgh-page oldgh-body-error__page">
        <h2>Couldn't render this page natively.</h2>
        <p>The OldGitHub adapter for this URL didn't return data we could use, so the original GitHub UI is hidden to avoid showing two skins at once.</p>
        <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
        <p><a href="${escapeAttr(window.location.href)}">Reload</a> or <a href="javascript:void(0)" data-oldgh-show-native>show GitHub's native page instead</a>.</p>
      </div>
    `;
  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.matches("[data-oldgh-show-native]")) {
      e.preventDefault();
      document.documentElement.removeAttribute("data-oldgh-mounted");
      document.querySelectorAll(".oldgh-body-root").forEach((n) => n.remove());
    }
  });
  const after = document.querySelector(".oldgh-repo-header") || document.querySelector(".oldgh-header");
  if (after && after.parentNode) {
    after.after(el);
  } else {
    insertBeforeFooter(el);
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function insertBodyPlaceholder(): void {
  if (document.querySelector(".oldgh-body-placeholder")) return;
  const el = document.createElement("div");
  el.className = "oldgh-body-placeholder oldgh-body-root";
  el.setAttribute("aria-hidden", "true");
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

export async function dispatchRoute(loc: Location | URL): Promise<void> {
  const pathname = currentPath(loc);
  const search = currentSearch(loc);
  const route = resolveRoute(pathname, search);

  // fire-and-forget: the message may throw synchronously when the SW has been
  // replaced under us (auto-update, manual reload, idle-recycle), and the
  // returned promise may reject for the same reason. swallow both.
  try {
    void chrome.runtime.sendMessage({ type: "oldgh:route-change", pathname, search }).catch(() => {});
  } catch {}

  const willMount = route.kind !== "out-of-scope" && route.kind !== "todo";
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

  // No pre-emptive wipe on cross-kind transitions. Keep the old shell visible
  // (it acts as a "still" of the previous page) while fetches run; the orange
  // progress bar is the loading affordance. Body and header each swap atomically
  // when their fetches resolve. Body is applied BEFORE the header on cross-kind
  // transitions so the user never sees a new repo header above a stale profile
  // body. For cross-repo navigation we pre-fetch the repo summary in parallel
  // with the body to minimise the gap between body-swap and header-swap.

  try {
    if (route.kind === "out-of-scope") {
      // github.com responds with X-Frame-Options: deny, so iframe-wrapping the
      // native page never works. Drop our themed body and let the native page
      // render below our themed header. POST-only endpoints (logout/session)
      // never render a body, so this is also a no-op there.
      await applyBodyState({ kind: "none" });
      teardownRepoHeader();
      clearMounted();
      return;
    }

    if (
      route.kind === "repo-home" ||
      route.kind === "repo-tree" ||
      route.kind === "repo-blob" ||
      route.kind === "repo-commits" ||
      route.kind === "repo-commit" ||
      route.kind === "repo-compare" ||
      route.kind === "repo-issues" ||
      route.kind === "repo-issue" ||
      route.kind === "repo-wiki" ||
      route.kind === "repo-actions" ||
      route.kind === "repo-actions-run" ||
      route.kind === "repo-pulse" ||
      route.kind === "repo-graphs" ||
      route.kind === "repo-projects" ||
      route.kind === "repo-security" ||
      route.kind === "repo-settings" ||
      route.kind === "repo-discussions" ||
      route.kind === "repo-discussion" ||
      route.kind === "repo-other"
    ) {
      const target = targetBodyForRoute(route);
      if (!sameBody(bodyState, target)) {
        bodyState = { kind: "none" };
      }
      const sameRepo = mountedRepo && mountedRepo.owner === route.owner && mountedRepo.repo === route.repo;
      if (sameRepo) {
        // header is already correct; tab swap is synchronous
        updateActiveTab(route.owner, route.repo, pathname);
        await applyBodyState(target);
        return;
      }
      // cross-repo or cross-kind: pre-fetch summary in parallel with body so
      // the two swaps happen back-to-back rather than serially.
      const summaryPromise = prefetchRepoSummary(route.owner, route.repo);
      await applyBodyState(target);
      await mountRepoHeader(route.owner, route.repo, summaryPromise);
      mountedRepo = { owner: route.owner, repo: route.repo };
      return;
    }

    if (route.kind === "profile") {
      const target: BodyState = { kind: "profile", login: route.login, tab: route.tab, query: route.query };
      if (!sameBody(bodyState, target)) {
        bodyState = { kind: "none" };
      }
      // body first — old shell (incl. repo header if leaving a repo) stays
      // visible until the new profile body is in place, then header tears down.
      await applyBodyState(target);
      teardownRepoHeader();
      return;
    }

    if (route.kind === "top-level") {
      const target: BodyState = { kind: "top-level", subkind: route.subkind, pathname: route.pathname, search: route.search, title: route.title };
      if (!sameBody(bodyState, target)) {
        bodyState = { kind: "none" };
      }
      await applyBodyState(target);
      teardownRepoHeader();
      return;
    }

    await applyBodyState({ kind: "none" });
    teardownRepoHeader();
    clearMounted();
  } catch (err) {
    if (err instanceof AdapterFailure) {
      console.debug("[oldgh] dispatch adapter failure:", err.name, err.message);
      bodyState = { kind: "none" };
      removeAllBodyRoots();
      if (/responded 404\b/.test(err.message)) {
        // If the repo header successfully mounted, it's a sub-section 404 (e.g.
        // discussions disabled). Keep the header and show a friendly message.
        if (mountedRepo) {
          insertBodyNotFound(err.message);
          return;
        }
        document.documentElement.removeAttribute(MOUNTED_ATTR);
        teardownRepoHeader();
        return;
      }
      insertBodyError(err.message);
      return;
    }
    throw err;
  } finally {
    hideProgress();
    scrollToHashIfPresent(loc);
  }
}

function scrollToHashIfPresent(loc: Location | URL): void {
  const hash = (loc instanceof URL ? loc.hash : loc.hash) || "";
  if (!hash || hash === "#") return;
  const id = hash.replace(/^#/, "");
  // Try immediately and again after a short delay to handle async content
  // (highlight loaders, hydrated tabs, scraped frames) that paint after dispatch returns.
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
  if (tryScroll()) return;
  window.setTimeout(() => { if (!tryScroll()) window.setTimeout(tryScroll, 400); }, 80);
}

function insertBodyNotFound(message: string): void {
  document.querySelectorAll(".oldgh-body-placeholder, .oldgh-body-error").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "oldgh-body-root oldgh-body-error";
  el.innerHTML = `
    <div class="oldgh-page oldgh-body-error__page">
      <h2>This section isn't available.</h2>
      <p>The page you requested couldn't be found in this repository. It may be disabled, moved, or never existed.</p>
      <p class="oldgh-body-error__detail"><code>${escapeText(message)}</code></p>
      <p><a href="javascript:void(0)" data-oldgh-show-native>Show GitHub's native page instead</a>.</p>
    </div>
  `;
  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.matches("[data-oldgh-show-native]")) {
      e.preventDefault();
      document.documentElement.removeAttribute("data-oldgh-mounted");
      document.querySelectorAll(".oldgh-body-root").forEach((n) => n.remove());
    }
  });
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

function targetBodyForRoute(route: Route): BodyState {
  if (route.kind === "repo-home") return { kind: "home", owner: route.owner, repo: route.repo };
  if (route.kind === "repo-tree") return { kind: "tree", owner: route.owner, repo: route.repo, refAndPath: route.refAndPath };
  if (route.kind === "repo-blob") return { kind: "blob", owner: route.owner, repo: route.repo, refAndPath: route.refAndPath };
  if (route.kind === "repo-commits") return { kind: "commits", owner: route.owner, repo: route.repo, refAndPath: route.refAndPath, query: route.query };
  if (route.kind === "repo-commit") return { kind: "commit", owner: route.owner, repo: route.repo, sha: route.sha };
  if (route.kind === "repo-compare") return { kind: "compare", owner: route.owner, repo: route.repo, range: route.range };
  if (route.kind === "repo-issues") return { kind: "issues", owner: route.owner, repo: route.repo, query: route.query, subkind: route.subkind };
  if (route.kind === "repo-issue") return { kind: "issue", owner: route.owner, repo: route.repo, number: route.number, subkind: route.subkind, tab: route.tab };
  if (route.kind === "repo-wiki") return { kind: "wiki", owner: route.owner, repo: route.repo, page: route.page };
  if (route.kind === "repo-actions") return { kind: "actions", owner: route.owner, repo: route.repo, query: route.query, workflowPath: route.workflowPath ?? null };
  if (route.kind === "repo-actions-run") return { kind: "actions-run", owner: route.owner, repo: route.repo, runId: route.runId };
  if (route.kind === "repo-pulse") return { kind: "pulse", owner: route.owner, repo: route.repo };
  if (route.kind === "repo-graphs") return { kind: "graphs", owner: route.owner, repo: route.repo, subkind: route.subkind };
  if (route.kind === "repo-projects") return { kind: "projects", owner: route.owner, repo: route.repo, query: route.query };
  if (route.kind === "repo-security") return { kind: "security", owner: route.owner, repo: route.repo, subkind: route.subkind };
  if (route.kind === "repo-discussions") return { kind: "discussions", owner: route.owner, repo: route.repo, subPath: route.subPath, query: route.query };
  if (route.kind === "repo-discussion") return { kind: "discussion", owner: route.owner, repo: route.repo, number: route.number };
  if (route.kind === "repo-settings") return { kind: "settings", owner: route.owner, repo: route.repo, subPath: route.subPath };
  if (route.kind === "repo-other") {
    const path = repoOtherPath(route.owner, route.repo);
    return { kind: "repo-other", owner: route.owner, repo: route.repo, pathname: path.pathname, search: path.search, title: path.title };
  }
  return { kind: "none" };
}

function matchRepoList(subPath: string): RepoListKind | null {
  const seg = subPath.replace(/^\//, "").split(/[\/?]/)[0];
  if (seg === "tags" || seg === "branches" || seg === "forks" || seg === "stargazers" || seg === "watchers" || seg === "labels" || seg === "milestones") {
    return seg as RepoListKind;
  }
  return null;
}

function repoOtherPath(owner: string, repo: string): { pathname: string; search: string; title: string } {
  const pathname = window.location.pathname;
  const search = window.location.search.startsWith("?") ? window.location.search.slice(1) : window.location.search;
  const prefix = `/${owner}/${repo}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const first = rest.split("/")[0] || "Other";
  const title = first.charAt(0).toUpperCase() + first.slice(1);
  return { pathname, search, title };
}

function teardownRepoHeader(): void {
  if (mountedRepo) {
    unmountRepoHeader();
    mountedRepo = null;
  }
}

async function applyBodyState(target: BodyState): Promise<void> {
  if (sameBody(bodyState, target)) return;
  if (target.kind === "none") {
    unmountBody();
    bodyState = { kind: "none" };
    return;
  }
  // don't wipe the old root here either — mountX will adopt the new root
  // when ready, swapping atomically. on failure, the catch in dispatchRoute
  // calls removeAllBodyRoots so we don't end up with stale content.
  bodyState = { kind: "none" };
  if (target.kind === "home") {
    await (await import("@/views/repo-home")).mountRepoHome(target.owner, target.repo);
    bodyState = target;
    return;
  }
  if (target.kind === "tree") {
    await (await import("@/views/repo-tree")).mountRepoTree(target.owner, target.repo, target.refAndPath);
    bodyState = target;
    return;
  }
  if (target.kind === "blob") {
    await (await import("@/views/repo-blob")).mountRepoBlob(target.owner, target.repo, target.refAndPath);
    bodyState = target;
    return;
  }
  if (target.kind === "commits") {
    await (await import("@/views/repo-commits")).mountRepoCommits(target.owner, target.repo, target.refAndPath, target.query);
    bodyState = target;
    return;
  }
  if (target.kind === "commit") {
    await (await import("@/views/repo-commit")).mountRepoCommit(target.owner, target.repo, target.sha);
    bodyState = target;
    return;
  }
  if (target.kind === "compare") {
    await (await import("@/views/repo-compare")).mountRepoCompare(target.owner, target.repo, target.range);
    bodyState = target;
    return;
  }
  if (target.kind === "issues") {
    await (await import("@/views/repo-issues")).mountRepoIssues(target.owner, target.repo, target.query, target.subkind);
    bodyState = target;
    return;
  }
  if (target.kind === "issue") {
    await (await import("@/views/repo-issue")).mountRepoIssue(target.owner, target.repo, target.number, target.subkind, target.tab);
    bodyState = target;
    return;
  }
  if (target.kind === "wiki") {
    await (await import("@/views/repo-wiki")).mountRepoWiki(target.owner, target.repo, target.page);
    bodyState = target;
    return;
  }
  if (target.kind === "actions") {
    await (await import("@/views/repo-actions")).mountRepoActions(target.owner, target.repo, target.query, target.workflowPath);
    bodyState = target;
    return;
  }
  if (target.kind === "actions-run") {
    await (await import("@/views/repo-actions-run")).mountRepoActionsRun(target.owner, target.repo, target.runId);
    bodyState = target;
    return;
  }
  if (target.kind === "pulse") {
    await (await import("@/views/repo-pulse")).mountRepoPulse(target.owner, target.repo);
    bodyState = target;
    return;
  }
  if (target.kind === "graphs") {
    await (await import("@/views/repo-graphs")).mountRepoGraphs(target.owner, target.repo, target.subkind);
    bodyState = target;
    return;
  }
  if (target.kind === "projects") {
    await (await import("@/views/repo-projects")).mountRepoProjects(target.owner, target.repo, target.query);
    bodyState = target;
    return;
  }
  if (target.kind === "security") {
    await (await import("@/views/repo-security")).mountRepoSecurity(target.owner, target.repo, target.subkind === "advisories" ? "advisories" : "overview");
    bodyState = target;
    return;
  }
  if (target.kind === "discussions") {
    await (await import("@/views/repo-discussions")).mountRepoDiscussions(target.owner, target.repo, target.subPath, target.query);
    bodyState = target;
    return;
  }
  if (target.kind === "discussion") {
    await (await import("@/views/repo-discussion")).mountRepoDiscussion(target.owner, target.repo, target.number);
    bodyState = target;
    return;
  }
  if (target.kind === "settings") {
    await (await import("@/views/repo-settings")).mountRepoSettings(target.owner, target.repo, target.subPath);
    bodyState = target;
    return;
  }
  if (target.kind === "repo-other") {
    const prefix = `/${target.owner}/${target.repo}`;
    const subPath = target.pathname.startsWith(prefix) ? target.pathname.slice(prefix.length) : target.pathname;
    if (subPath === "/releases" || subPath.startsWith("/releases?") || subPath === "/releases/") {
      await (await import("@/views/repo-releases")).mountRepoReleases(target.owner, target.repo, target.search);
      bodyState = target;
      return;
    }
    if (subPath.startsWith("/releases/latest")) {
      await (await import("@/views/repo-releases")).mountRepoReleases(target.owner, target.repo, "");
      bodyState = target;
      return;
    }
    if (subPath.startsWith("/releases/tag/")) {
      const tag = decodeURIComponent(subPath.slice("/releases/tag/".length).split("/")[0] ?? "");
      if (tag) {
        await (await import("@/views/repo-releases")).mountRepoReleases(target.owner, target.repo, "", tag);
        bodyState = target;
        return;
      }
    }
    const listMatch = matchRepoList(subPath);
    if (listMatch) {
      await (await import("@/views/repo-lists")).mountRepoList(target.owner, target.repo, listMatch, target.search);
      bodyState = target;
      return;
    }
    const full = subPath + (target.search ? "?" + target.search : "");
    await (await import("@/views/repo-section")).mountRepoSection(target.owner, target.repo, "other", full || "/", target.title);
    bodyState = target;
    return;
  }
  if (target.kind === "profile") {
    await (await import("@/views/profile")).mountProfile(target.login, target.tab, target.query);
    bodyState = target;
    return;
  }
  if (target.kind === "top-level") {
    if (target.subkind === "dashboard") {
      await (await import("@/views/dashboard")).mountDashboard();
    } else if (target.subkind === "notifications") {
      await (await import("@/views/notifications")).mountNotifications(target.search);
    } else if (target.subkind === "search") {
      await (await import("@/views/search")).mountSearch(target.pathname, target.search);
    } else if (target.subkind === "stars") {
      await (await import("@/views/stars")).mountStars(target.pathname, target.search);
    } else if (target.subkind === "trending") {
      await (await import("@/views/trending")).mountTrending(target.pathname, target.search);
    } else if (target.subkind === "explore") {
      await (await import("@/views/explore")).mountExplore();
    } else if (target.subkind === "topic") {
      await (await import("@/views/topic")).mountTopic(target.pathname, target.search);
    } else if (target.subkind === "marketplace") {
      await (await import("@/views/marketplace")).mountMarketplace(target.pathname, target.search);
    } else if (target.subkind === "collections") {
      await (await import("@/views/collections")).mountCollections(target.pathname);
    } else if (target.subkind === "sponsors") {
      await (await import("@/views/sponsors")).mountSponsors(target.pathname, target.search);
    } else if (target.subkind === "watching") {
      await (await import("@/views/watching")).mountWatching(target.pathname, target.search);
    } else if (target.subkind === "topics") {
      await (await import("@/views/topics")).mountTopics(target.pathname, target.search);
    } else if (target.subkind === "issues") {
      await (await import("@/views/me-issues")).mountMeIssues("issue", target.pathname, target.search);
    } else if (target.subkind === "pulls") {
      await (await import("@/views/me-issues")).mountMeIssues("pull", target.pathname, target.search);
    } else if (target.subkind === "settings") {
      await (await import("@/views/account-settings")).mountAccountSettings(target.pathname);
    } else {
      await (await import("@/views/top-level")).mountTopLevel(target.subkind, target.pathname, target.search, target.title);
    }
    bodyState = target;
    return;
  }
}

function sameBody(a: BodyState, b: BodyState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "home" && b.kind === "home") {
    return a.owner === b.owner && a.repo === b.repo;
  }
  if (a.kind === "tree" && b.kind === "tree") {
    return a.owner === b.owner && a.repo === b.repo && a.refAndPath === b.refAndPath;
  }
  if (a.kind === "blob" && b.kind === "blob") {
    return a.owner === b.owner && a.repo === b.repo && a.refAndPath === b.refAndPath;
  }
  if (a.kind === "commits" && b.kind === "commits") {
    return a.owner === b.owner && a.repo === b.repo && a.refAndPath === b.refAndPath && a.query === b.query;
  }
  if (a.kind === "commit" && b.kind === "commit") {
    return a.owner === b.owner && a.repo === b.repo && a.sha === b.sha;
  }
  if (a.kind === "compare" && b.kind === "compare") {
    return a.owner === b.owner && a.repo === b.repo && a.range === b.range;
  }
  if (a.kind === "issues" && b.kind === "issues") {
    return a.owner === b.owner && a.repo === b.repo && a.query === b.query && a.subkind === b.subkind;
  }
  if (a.kind === "issue" && b.kind === "issue") {
    return a.owner === b.owner && a.repo === b.repo && a.number === b.number && a.subkind === b.subkind && a.tab === b.tab;
  }
  if (a.kind === "wiki" && b.kind === "wiki") {
    return a.owner === b.owner && a.repo === b.repo && a.page === b.page;
  }
  if (a.kind === "actions" && b.kind === "actions") {
    return a.owner === b.owner && a.repo === b.repo && a.query === b.query && a.workflowPath === b.workflowPath;
  }
  if (a.kind === "actions-run" && b.kind === "actions-run") {
    return a.owner === b.owner && a.repo === b.repo && a.runId === b.runId;
  }
  if (a.kind === "pulse" && b.kind === "pulse") {
    return a.owner === b.owner && a.repo === b.repo;
  }
  if (a.kind === "graphs" && b.kind === "graphs") {
    return a.owner === b.owner && a.repo === b.repo && a.subkind === b.subkind;
  }
  if (a.kind === "projects" && b.kind === "projects") {
    return a.owner === b.owner && a.repo === b.repo && a.query === b.query;
  }
  if (a.kind === "security" && b.kind === "security") {
    return a.owner === b.owner && a.repo === b.repo && a.subkind === b.subkind;
  }
  if (a.kind === "discussions" && b.kind === "discussions") {
    return a.owner === b.owner && a.repo === b.repo && a.subPath === b.subPath && a.query === b.query;
  }
  if (a.kind === "discussion" && b.kind === "discussion") {
    return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
  }
  if (a.kind === "settings" && b.kind === "settings") {
    return a.owner === b.owner && a.repo === b.repo && a.subPath === b.subPath;
  }
  if (a.kind === "repo-other" && b.kind === "repo-other") {
    return a.owner === b.owner && a.repo === b.repo && a.pathname === b.pathname && a.search === b.search;
  }
  if (a.kind === "profile" && b.kind === "profile") {
    return a.login === b.login && a.tab === b.tab && a.query === b.query;
  }
  if (a.kind === "top-level" && b.kind === "top-level") {
    return a.subkind === b.subkind && a.pathname === b.pathname && a.search === b.search;
  }
  return a.kind === "none" && b.kind === "none";
}

function unmountBody(): void {
  removeAllBodyRoots();
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
  if (route.kind === "out-of-scope" || route.kind === "todo") return "";
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
      const sub = pathname.replace(`/${route.owner}/${route.repo}`, "").replace(/^\//, "").split(/[\/?]/)[0] || "";
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
