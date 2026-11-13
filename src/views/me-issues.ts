import { octicon } from "@/icons";
import { getMeIssues, type MeIssueFilter, type MeIssueKind, type MeIssuesPage } from "@/adapters/me-issues";
import type { IssueResult } from "@/adapters/search";
import { currentUserLogin } from "@/auth/session";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-me-issues";

export async function mountMeIssues(kind: MeIssueKind, pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const login = currentUserLogin();
  // github redirects /issues?filter=assigned to /issues/assigned
  const filter = parseFilter(pathname.split("/")[2] ?? new URLSearchParams(search).get("filter"), kind);

  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${kind}`;
  root.innerHTML = renderLoading(kind, filter, login);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  let page: MeIssuesPage;
  try {
    page = await getMeIssues(kind, filter, login);
  } catch (e) {
    root.innerHTML = renderError(kind, filter, login, e instanceof Error ? e.message : String(e));
    return;
  }
  root.innerHTML = renderShell(page);
}

function parseFilter(f: string | null, kind: MeIssueKind): MeIssueFilter {
  if (f === "assigned") return "assigned";
  if (f === "mentioned") return "mentioned";
  if (f === "review-requested" && kind === "pull") return "review-requested";
  return "created";
}

function renderShell(p: MeIssuesPage): string {
  if (!p.login) {
    return `
      <div class="oldgh-page oldgh-me-issues__page">
        <h1 class="oldgh-me-issues__heading">${heading(p.kind)}</h1>
        <p class="oldgh-me-issues__signin">Sign in to GitHub to see your ${p.kind === "issue" ? "issues" : "pull requests"}.</p>
      </div>
    `;
  }
  return `
    <div class="oldgh-page oldgh-me-issues__page">
      <h1 class="oldgh-me-issues__heading">${heading(p.kind)}</h1>
      <div class="oldgh-me-issues__layout">
        <aside class="oldgh-me-issues__rail">
          <ul>
            ${tabLinks(p.kind, p.filter).map((t) => `
              <li><a href="${escapeAttr(t.href)}" class="${t.active ? "oldgh-me-issues__tab--active" : ""}">${escapeText(t.label)}</a></li>
            `).join("")}
          </ul>
        </aside>
        <div class="oldgh-me-issues__main">
          <header class="oldgh-me-issues__main-header">
            <h2>${escapeText(filterLabel(p.filter, p.kind))}</h2>
            <span class="oldgh-me-issues__count">${formatCount(p.totalCount)}</span>
          </header>
          ${p.items.length === 0 ? renderEmpty(p.filter, p.kind) : `
            <ul class="oldgh-me-issues__list">
              ${p.items.map(renderItem).join("")}
            </ul>
          `}
          ${p.totalCount > p.items.length ? `<p class="oldgh-me-issues__more"><a href="${escapeAttr(searchHref(p))}">View all ${formatCount(p.totalCount)} in search</a></p>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderLoading(kind: MeIssueKind, filter: MeIssueFilter, login: string | null): string {
  return `
    <div class="oldgh-page oldgh-me-issues__page">
      <h1 class="oldgh-me-issues__heading">${heading(kind)}</h1>
      <div class="oldgh-me-issues__layout">
        <aside class="oldgh-me-issues__rail">
          <ul>
            ${tabLinks(kind, filter).map((t) => `
              <li><a href="${escapeAttr(t.href)}" class="${t.active ? "oldgh-me-issues__tab--active" : ""}">${escapeText(t.label)}</a></li>
            `).join("")}
          </ul>
        </aside>
        <div class="oldgh-me-issues__main">
          <p class="oldgh-me-issues__loading">${login ? "Loading…" : "Sign in to view."}</p>
        </div>
      </div>
    </div>
  `;
}

function renderError(kind: MeIssueKind, filter: MeIssueFilter, _login: string | null, message: string): string {
  return `
    <div class="oldgh-page oldgh-me-issues__page">
      <h1 class="oldgh-me-issues__heading">${heading(kind)}</h1>
      <div class="oldgh-me-issues__layout">
        <aside class="oldgh-me-issues__rail">
          <ul>
            ${tabLinks(kind, filter).map((t) => `
              <li><a href="${escapeAttr(t.href)}" class="${t.active ? "oldgh-me-issues__tab--active" : ""}">${escapeText(t.label)}</a></li>
            `).join("")}
          </ul>
        </aside>
        <div class="oldgh-me-issues__main">
          <p class="oldgh-me-issues__loading">Couldn't load: ${escapeText(message)}</p>
        </div>
      </div>
    </div>
  `;
}

function searchHref(p: MeIssuesPage): string {
  return `/search?${new URLSearchParams({ q: p.query, type: p.kind === "issue" ? "issues" : "pullrequests", s: "updated", o: "desc" })}`;
}

function renderItem(it: IssueResult): string {
  const icon = stateIcon(it);
  const [repoOwner, repoName] = it.repoFullName.split("/");
  const labels = it.labels.slice(0, 6).map((l) => `<span class="oldgh-me-issues__label"${l.color ? ` style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)}"` : ""}>${escapeText(emojify(l.name))}</span>`).join("");
  return `
    <li class="oldgh-me-issues__item">
      <span class="oldgh-me-issues__icon oldgh-me-issues__icon--${itemStateClass(it)}">${icon}</span>
      <div class="oldgh-me-issues__body">
        <div class="oldgh-me-issues__row1">
          <a class="oldgh-me-issues__repo" href="/${escapeAttr(it.repoFullName)}">${escapeText(repoOwner ?? "")}/${escapeText(repoName ?? "")}</a>
          <a class="oldgh-me-issues__title" href="${escapeAttr(it.htmlUrl.replace(/^https:\/\/github\.com/, ""))}">${escapeText(it.title)}</a>
          ${labels ? `<span class="oldgh-me-issues__labels">${labels}</span>` : ""}
        </div>
        <div class="oldgh-me-issues__row2">
          <span>#${it.number}</span>
          ${it.user ? `· opened by <a href="/${escapeAttr(it.user.login)}">${escapeText(it.user.login)}</a>` : ""}
          ${it.createdAt ? `<span title="${escapeAttr(absoluteTime(it.createdAt))}">${escapeText(relativeTime(it.createdAt))}</span>` : ""}
          ${it.commentCount ? `· <span>${octicon("comment", { size: 12 })} ${formatCount(it.commentCount)}</span>` : ""}
        </div>
      </div>
    </li>
  `;
}

function renderEmpty(filter: MeIssueFilter, kind: MeIssueKind): string {
  return `
    <div class="oldgh-me-issues__empty">
      <p>Nothing here — no ${kind === "issue" ? "issues" : "pull requests"} match <em>${escapeText(filterLabel(filter, kind))}</em>.</p>
    </div>
  `;
}

function heading(kind: MeIssueKind): string {
  return kind === "issue" ? "Your issues" : "Your pull requests";
}

function tabLinks(kind: MeIssueKind, active: MeIssueFilter): { label: string; href: string; active: boolean }[] {
  const base = kind === "issue" ? "/issues" : "/pulls";
  const tabs: { label: string; filter: MeIssueFilter }[] = [
    { label: "Created", filter: "created" },
    { label: "Assigned", filter: "assigned" },
    { label: "Mentioned", filter: "mentioned" },
  ];
  if (kind === "pull") tabs.push({ label: "Review requests", filter: "review-requested" });
  return tabs.map((t) => ({
    label: t.label,
    // github keeps /issues on the last view a user opened, so issue tabs use its path urls
    href: kind === "issue" ? `${base}/${t.filter}` : t.filter === "created" ? base : `${base}?filter=${t.filter}`,
    active: t.filter === active,
  }));
}

function filterLabel(f: MeIssueFilter, kind: MeIssueKind): string {
  switch (f) {
    case "created": return kind === "issue" ? "Issues you created" : "Pull requests you created";
    case "assigned": return kind === "issue" ? "Issues assigned to you" : "Pull requests assigned to you";
    case "mentioned": return kind === "issue" ? "Issues mentioning you" : "Pull requests mentioning you";
    case "review-requested": return "Pull requests awaiting your review";
  }
}

function stateIcon(it: IssueResult): string {
  if (it.isPull) return octicon(it.merged ? "git-merge" : "git-pull-request", { size: 14 });
  return octicon(it.state === "closed" ? "issue-closed" : "issue-opened", { size: 14 });
}

function itemStateClass(it: IssueResult): string {
  if (!it.isPull) return it.state;
  return it.merged ? "merged" : it.state === "closed" ? "closed" : it.draft ? "draft" : "open";
}

function labelTextColor(hex: string): string {
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#24292e";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#24292e" : "#ffffff";
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}
