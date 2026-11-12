import { octicon } from "@/icons";
import { getMeIssues, type MeIssueFilter, type MeIssueItem, type MeIssueKind, type MeIssuesPage } from "@/adapters/me-issues";
import { currentUserLogin } from "@/auth/session";
import { absoluteTime, relativeTime } from "@/util/time";
import { emojify } from "@/util/emoji";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-me-issues";

export async function mountMeIssues(kind: MeIssueKind, _pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const login = currentUserLogin();
  const filter = parseFilter(search, kind);

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

export function unmountMeIssues(): void {
  removeAllBodyRoots();
}

function parseFilter(search: string, kind: MeIssueKind): MeIssueFilter {
  const params = new URLSearchParams(search);
  const f = params.get("filter");
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

function renderItem(it: MeIssueItem): string {
  const icon = stateIcon(it);
  const labels = it.labels.slice(0, 6).map((l) => `<span class="oldgh-me-issues__label" style="background:#${escapeAttr(l.color)};color:${labelTextColor(l.color)}">${escapeText(emojify(l.name))}</span>`).join("");
  return `
    <li class="oldgh-me-issues__item">
      <span class="oldgh-me-issues__icon oldgh-me-issues__icon--${itemStateClass(it)}">${icon}</span>
      <div class="oldgh-me-issues__body">
        <div class="oldgh-me-issues__row1">
          <a class="oldgh-me-issues__repo" href="${escapeAttr(it.repoUrl)}">${escapeText(it.repoOwner)}/${escapeText(it.repoName)}</a>
          <a class="oldgh-me-issues__title" href="${escapeAttr(it.url)}">${escapeText(it.title)}</a>
          ${labels ? `<span class="oldgh-me-issues__labels">${labels}</span>` : ""}
        </div>
        <div class="oldgh-me-issues__row2">
          <span>#${it.number}</span>
          ${it.author ? `· opened by <a href="/${escapeAttr(it.author.login)}">${escapeText(it.author.login)}</a>` : ""}
          ${it.updatedAt ? `· <span title="${escapeAttr(absoluteTime(it.updatedAt))}">updated ${escapeText(relativeTime(it.updatedAt))}</span>` : ""}
          ${it.comments ? `· <span>${octicon("comment", { size: 12 })} ${formatCount(it.comments)}</span>` : ""}
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
    href: t.filter === "created" ? base : `${base}?filter=${t.filter}`,
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

function stateIcon(it: MeIssueItem): string {
  if (it.isPull) {
    if (it.pullState === "merged") return octicon("git-merge", { size: 14 });
    if (it.pullState === "draft") return octicon("git-pull-request", { size: 14 });
    if (it.pullState === "closed") return octicon("git-pull-request", { size: 14 });
    return octicon("git-pull-request", { size: 14 });
  }
  return it.state === "closed" ? octicon("issue-closed", { size: 14 }) : octicon("issue-opened", { size: 14 });
}

function itemStateClass(it: MeIssueItem): string {
  if (it.isPull) {
    return it.pullState ?? "open";
  }
  return it.state;
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

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
