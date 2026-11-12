import { octicon } from "@/icons";
import {
  getNotifications,
  type NotificationsView,
  type NotificationItem,
  type NotificationRepoGroup,
} from "@/adapters/notifications";
import { absoluteTime, relativeTime } from "@/util/time";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-notifications";

export async function mountNotifications(search: string): Promise<void> {
  const nav = navigationToken();
  const view = await getNotifications(search);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, search);
  adoptBodyRoot(root, undefined, nav);
}

export function unmountNotifications(): void {
  removeAllBodyRoots();
}

function renderShell(v: NotificationsView, search: string): string {
  // a non-empty query string means a filter or search is applied, not the default inbox
  const isFiltered = search.trim().length > 0 || v.filters.some((f) => f.isActive && !isDefaultFilter(f.href));
  const emptyIcon = isFiltered ? "search" : "check";
  const emptyCopy = isFiltered
    ? "No notifications match this filter."
    : "No new notifications. You're all caught up.";
  return `
    <div class="oldgh-page oldgh-notif">
      <header class="oldgh-notif__header">
        <h1>${octicon("inbox", { size: 22 })} Notifications</h1>
        <div class="oldgh-notif__counts">
          <span class="oldgh-notif__count">${v.totalUnread} unread</span>
          <span class="oldgh-notif__count-sep">·</span>
          <span class="oldgh-notif__count">${v.totalShown} shown</span>
        </div>
      </header>
      <div class="oldgh-notif__layout">
        <aside class="oldgh-notif__rail">
          ${renderFiltersBox(v)}
          ${renderRepoListBox(v.groups)}
        </aside>
        <main class="oldgh-notif__main">
          ${v.groups.length === 0
            ? `<div class="oldgh-notif__empty">${octicon(emptyIcon, { size: 22 })} <p>${escapeText(emptyCopy)}</p></div>`
            : v.groups.map(renderRepoGroup).join("")}
        </main>
      </div>
    </div>
  `;
}

function isDefaultFilter(href: string): boolean {
  // the default inbox has no extra query, so any /notifications path without a query is non-filtering
  return !href.includes("?");
}

function renderFiltersBox(v: NotificationsView): string {
  if (v.filters.length === 0) return "";
  return `
    <div class="oldgh-notif__box">
      <div class="oldgh-notif__box-head"><h3>Filters</h3></div>
      <ul class="oldgh-notif__filters">
        ${v.filters.map((f) => `
          <li class="${f.isActive ? "is-active" : ""}">
            <a href="${escapeAttr(f.href)}">${escapeText(f.label)}</a>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderRepoListBox(groups: NotificationRepoGroup[]): string {
  if (groups.length === 0) return "";
  return `
    <div class="oldgh-notif__box">
      <div class="oldgh-notif__box-head"><h3>Repositories</h3></div>
      <ul class="oldgh-notif__repo-rail">
        ${groups.map((g) => `
          <li>
            <a href="${escapeAttr("#" + cssId(g.slug))}">${escapeText(g.slug)}</a>
            ${g.unreadCount > 0 ? `<span class="oldgh-notif__repo-count">${g.unreadCount}</span>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderRepoGroup(g: NotificationRepoGroup): string {
  return `
    <section class="oldgh-notif__group" id="${cssId(g.slug)}">
      <header class="oldgh-notif__group-head">
        ${octicon("repo", { size: 14 })}
        <a class="oldgh-notif__group-slug" href="${escapeAttr(g.href)}">${escapeText(g.slug)}</a>
        ${g.unreadCount > 0 ? `<span class="oldgh-notif__group-unread">${g.unreadCount}</span>` : ""}
      </header>
      <ul class="oldgh-notif__list">
        ${g.items.map(renderItem).join("")}
      </ul>
    </section>
  `;
}

function renderItem(item: NotificationItem): string {
  const icon = iconForKind(item.kind);
  const cls = ["oldgh-notif__item"];
  if (item.unread) cls.push("is-unread");
  if (item.starred) cls.push("is-starred");
  return `
    <li class="${cls.join(" ")}">
      <span class="oldgh-notif__item-icon" title="${escapeAttr(item.kind)}">${octicon(icon, { size: 14 })}</span>
      <a class="oldgh-notif__item-link" href="${escapeAttr(item.href)}">
        <span class="oldgh-notif__item-title">${escapeText(item.title)}</span>
        ${item.number !== null ? `<span class="oldgh-notif__item-num">#${item.number}</span>` : ""}
      </a>
      ${item.reason ? `<span class="oldgh-notif__item-reason">${escapeText(item.reason)}</span>` : ""}
      ${item.occurredAt ? `<time class="oldgh-notif__item-time" datetime="${escapeAttr(item.occurredAt)}" title="${escapeAttr(absoluteTime(item.occurredAt))}">${escapeText(relativeTime(item.occurredAt))}</time>` : ""}
    </li>
  `;
}

function iconForKind(kind: NotificationItem["kind"]): string {
  switch (kind) {
    case "pull": return "git-pull-request";
    case "issue": return "issue-opened";
    case "discussion": return "comment-discussion";
    case "release": return "tag";
    case "commit": return "git-commit";
    default: return "bell";
  }
}

function cssId(s: string): string {
  return "oldgh-notif-" + s.replace(/[^\w-]/g, "-");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
