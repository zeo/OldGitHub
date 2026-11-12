import { AdapterFailure, type AdapterContext } from "./index";

export type NotificationItem = {
  id: string;
  href: string;
  repoSlug: string;
  ownerLogin: string;
  repoName: string;
  kind: "issue" | "pull" | "discussion" | "release" | "commit" | "other";
  number: number | null;
  title: string;
  reason: string | null;
  occurredAt: string | null;
  unread: boolean;
  starred: boolean;
  state: string | null;
};

export type NotificationRepoGroup = {
  slug: string;
  href: string;
  unreadCount: number;
  items: NotificationItem[];
};

export type NotificationFilter = { label: string; href: string; isActive: boolean };

export type NotificationsView = {
  totalUnread: number;
  totalShown: number;
  filters: NotificationFilter[];
  groups: NotificationRepoGroup[];
};

export async function getNotifications(search: string): Promise<NotificationsView> {
  const sourceUrl = `https://github.com/notifications${search ? "?" + search : ""}`;
  const resp = await fetch(sourceUrl, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("getNotifications", `${sourceUrl} responded ${resp.status}`);
  }
  if (new URL(resp.url).pathname === "/login") {
    throw new AdapterFailure("getNotifications", "GitHub asked to sign in again");
  }
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const rawItems = Array.from(doc.querySelectorAll<HTMLElement>(".notifications-list-item"))
    .map(parseNotificationItem)
    .filter((x): x is NotificationItem => x !== null);
  const filters = parseFilters(doc);
  if (rawItems.length === 0 && filters.length === 0) {
    throw new AdapterFailure("getNotifications", "notifications page markup not recognized");
  }
  const groups = groupByRepo(rawItems);
  const totalUnread = rawItems.filter((i) => i.unread).length;
  return {
    totalUnread,
    totalShown: rawItems.length,
    filters,
    groups,
  };
}

function parseNotificationItem(root: HTMLElement): NotificationItem | null {
  const id = root.getAttribute("data-notification-id") || "";
  const link = root.querySelector<HTMLAnchorElement>(".notification-list-item-link, a.no-underline");
  if (!link) return null;
  let href = link.getAttribute("href") || "";
  try {
    const u = new URL(href, "https://github.com");
    href = u.pathname + u.search;
  } catch {}
  const titleEl = root.querySelector(".markdown-title");
  const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();
  const slugInfo = parseRepoSlug(href);
  if (!slugInfo) return null;
  const kind = parseKind(href);
  const number = parseNumber(href);
  const timeEl = root.querySelector("relative-time, time");
  const occurredAt = timeEl?.getAttribute("datetime") || null;
  const unread = !root.classList.contains("notification-read");
  const starred = !!root.querySelector(".notification-action-unstar");
  const reason =
    root.querySelector(".f6.flex-self-center")?.textContent?.replace(/\s+/g, " ").trim() ||
    null;

  return {
    id,
    href,
    repoSlug: slugInfo.slug,
    ownerLogin: slugInfo.owner,
    repoName: slugInfo.repo,
    kind,
    number,
    title: title || "(no title)",
    reason,
    occurredAt,
    unread,
    starred,
    state: null,
  };
}

function parseRepoSlug(href: string): { slug: string; owner: string; repo: string } | null {
  const m = href.match(/^\/([\w.-]+)\/([\w.-]+)\//);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, slug: `${m[1]}/${m[2]}` };
}

function parseKind(href: string): NotificationItem["kind"] {
  if (/\/pull\/\d+/.test(href)) return "pull";
  if (/\/issues\/\d+/.test(href)) return "issue";
  if (/\/discussions\/\d+/.test(href)) return "discussion";
  if (/\/releases\//.test(href)) return "release";
  if (/\/commit\//.test(href)) return "commit";
  return "other";
}

function parseNumber(href: string): number | null {
  const m = href.match(/\/(?:pull|issues|discussions)\/(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

function groupByRepo(items: NotificationItem[]): NotificationRepoGroup[] {
  const map = new Map<string, NotificationRepoGroup>();
  for (const item of items) {
    let g = map.get(item.repoSlug);
    if (!g) {
      g = { slug: item.repoSlug, href: `/${item.repoSlug}`, unreadCount: 0, items: [] };
      map.set(item.repoSlug, g);
    }
    g.items.push(item);
    if (item.unread) g.unreadCount++;
  }
  return Array.from(map.values());
}

function parseFilters(doc: Document): NotificationFilter[] {
  const out: NotificationFilter[] = [];
  const seen = new Set<string>();
  const candidates = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href*='/notifications']"));
  for (const a of candidates) {
    let href = a.getAttribute("href") || "";
    try {
      const u = new URL(href, "https://github.com");
      href = u.pathname + u.search;
    } catch {}
    if (!href.startsWith("/notifications")) continue;
    const label = (a.textContent || "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 32) continue;
    if (seen.has(href + "|" + label)) continue;
    seen.add(href + "|" + label);
    const isActive =
      a.getAttribute("aria-current") === "page" ||
      a.classList.contains("active") ||
      a.classList.contains("selected");
    out.push({ label, href, isActive });
    if (out.length >= 8) break;
  }
  return out;
}

export async function getUnreadCount(_ctx: AdapterContext = { csrfToken: null }): Promise<number> {
  let resp: Response;
  try {
    resp = await fetch("https://github.com/notifications/beacon/count", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new AdapterFailure("getUnreadCount", "network error", { cause: err });
  }
  if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
    return 0;
  }
  if (!resp.ok) {
    throw new AdapterFailure("getUnreadCount", `notifications/beacon/count responded ${resp.status}`);
  }
  let json: unknown;
  try {
    json = (await resp.json()) as unknown;
  } catch (err) {
    throw new AdapterFailure("getUnreadCount", "invalid JSON", { cause: err });
  }
  if (!json || typeof json !== "object") {
    throw new AdapterFailure("getUnreadCount", "unexpected notifications payload");
  }
  const count = (json as { count?: unknown }).count;
  if (typeof count !== "number") {
    throw new AdapterFailure("getUnreadCount", "missing 'count' field");
  }
  return count;
}
