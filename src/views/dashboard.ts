import { octicon } from "@/icons";
import {
  getDashboard,
  type DashboardView,
  type FeedItem,
  type FeedRepoCard,
  type TopRepo,
  type ChangelogItem,
} from "@/adapters/dashboard";
import { absoluteTime, relativeTime } from "@/util/time";
import { languageColor } from "@/util/language-color";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-dashboard";

export async function mountDashboard(): Promise<void> {
  const nav = navigationToken();
  const view = await getDashboard();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  if (!adoptBodyRoot(root, undefined, nav)) return;
  bindRepoFilter(root);
}

// live client-side filter over the already-rendered "Your Repositories" list
function bindRepoFilter(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>(".oldgh-dash__repo-filter-input");
  if (!input) return;
  const rows = Array.from(root.querySelectorAll<HTMLElement>(".oldgh-dash__repo-row"));
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    for (const row of rows) {
      const name = (row.dataset["name"] ?? "").toLowerCase();
      row.hidden = q !== "" && !name.includes(q);
    }
  });
}

export function unmountDashboard(): void {
  removeAllBodyRoots();
}

function renderShell(v: DashboardView): string {
  return `
    <div class="oldgh-page oldgh-dash">
      <div class="oldgh-dash__layout">
        <main class="oldgh-dash__main">
          <div class="oldgh-dash__feed-head">
            <h2>News Feed</h2>
            <ul class="oldgh-dash__feed-tabs">
              <li class="is-active"><a href="/">${octicon("rss", { size: 14 })} News Feed</a></li>
              <li><a href="/pulls">${octicon("git-pull-request", { size: 14 })} Pull Requests</a></li>
              <li><a href="/issues">${octicon("issue-opened", { size: 14 })} Issues</a></li>
            </ul>
          </div>
          ${v.feed.length === 0
            ? `<div class="oldgh-dash__empty">No recent activity.</div>`
            : `<ul class="oldgh-dash__feed">${v.feed.map(renderFeedItem).join("")}</ul>`}
        </main>
        <aside class="oldgh-dash__rail">
          ${renderRepoBox(v.topRepos)}
          ${renderTrendingBox("Trending repositories", "flame", "/trending", v.trendingRepos)}
          ${renderTrendingBox("Recommended for you", "rocket", "/explore", v.recommendedRepos)}
          ${renderBroadcastBox(v.changelog)}
          ${renderProTipBox()}
        </aside>
      </div>
    </div>
  `;
}

function renderTrendingBox(title: string, icon: string, seeMoreHref: string, repos: FeedRepoCard[]): string {
  if (repos.length === 0) return "";
  return `
    <div class="oldgh-dash__box">
      <div class="oldgh-dash__box-head">
        <h3>${octicon(icon, { size: 14 })} ${escapeText(title)}</h3>
        <a class="oldgh-dash__box-link" href="${escapeAttr(seeMoreHref)}">See more</a>
      </div>
      <ul class="oldgh-dash__trending-list">
        ${repos.map((r) => `
          <li class="oldgh-dash__trending-row">
            <a class="oldgh-dash__trending-slug" href="${escapeAttr(r.href)}">${escapeText(r.slug)}</a>
            ${r.description ? `<p class="oldgh-dash__trending-desc">${escapeText(r.description)}</p>` : ""}
            <div class="oldgh-dash__trending-meta">
              ${r.language ? `<span><span class="oldgh-lang-dot" style="background:${languageColor(r.language)}"></span>${escapeText(r.language)}</span>` : ""}
              ${r.starCount ? `<span>${octicon("star", { size: 12 })} ${escapeText(r.starCount)}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderFeedItem(item: FeedItem): string {
  const icon = iconForCard(item.cardType);
  const avatar = item.actor?.avatarUrl
    ? `<img class="oldgh-dash__feed-avatar" src="${escapeAttr(item.actor.avatarUrl)}" alt="" />`
    : "";
  const headline = item.actor
    ? formatHeadline(item.actor.login, item.headline)
    : escapeText(item.headline);
  // relativeTime returns "" for unparseable datetimes; skip the element so we
  // never render a visible but empty <time>
  const rel = item.occurredAt ? relativeTime(item.occurredAt) : "";
  const time = rel
    ? `<time class="oldgh-dash__feed-time" datetime="${escapeAttr(item.occurredAt!)}" title="${escapeAttr(absoluteTime(item.occurredAt!))}">${escapeText(rel)}</time>`
    : "";

  const title = item.bodyTextLink
    ? `<div class="oldgh-dash__feed-title"><a href="${escapeAttr(item.bodyTextLink.href)}">${escapeText(item.bodyTextLink.text)}</a></div>`
    : "";

  const body = item.bodyExcerpt ? renderFeedBody(item.bodyExcerpt) : "";

  const repoCards = item.repoCards.length > 0
    ? `<ul class="oldgh-dash__repo-cards">${item.repoCards.map(renderRepoCard).join("")}</ul>`
    : "";

  // skip the tooltip for the default UNKNOWN card type so it never reads title="unknown"
  const iconTitle = item.cardType !== "UNKNOWN"
    ? ` title="${escapeAttr(item.cardType.toLowerCase().replace(/_/g, " "))}"`
    : "";

  return `
    <li class="oldgh-dash__feed-item">
      <span class="oldgh-dash__feed-icon"${iconTitle}>${octicon(icon, { size: 22 })}</span>
      <div class="oldgh-dash__feed-body-wrap">
        <div class="oldgh-dash__feed-headline">
          ${avatar}
          <span class="oldgh-dash__feed-text">${headline}</span>
          ${time}
        </div>
        ${title}
        ${body}
        ${repoCards}
      </div>
    </li>
  `;
}

// AI-generated commit summaries arrive with a leading "Summary " token that
// reads weirdly inline ("Summary npm run sync now passes..."). Break it out
// into its own pill so the body text reads as prose.
function renderFeedBody(excerpt: string): string {
  const m = /^Summary[\s ]+(.+)$/s.exec(excerpt);
  if (m) {
    return `<div class="oldgh-dash__feed-body"><span class="oldgh-dash__feed-body-label">Summary</span>${escapeText(m[1]!)}</div>`;
  }
  return `<div class="oldgh-dash__feed-body">${escapeText(excerpt)}</div>`;
}

function formatHeadline(actorLogin: string, headline: string): string {
  const escaped = escapeText(headline);
  const re = new RegExp(`^${escapeRegex(actorLogin)}\\b`);
  if (re.test(escaped)) {
    return `<a href="/${escapeAttr(actorLogin)}" class="oldgh-dash__feed-actor">${escapeText(actorLogin)}</a>${escaped.slice(actorLogin.length)}`;
  }
  return escaped;
}

function renderRepoCard(c: FeedRepoCard): string {
  return `
    <li class="oldgh-dash__repo-card">
      <div class="oldgh-dash__repo-card-head">
        <a href="${escapeAttr(c.href)}" class="oldgh-dash__repo-card-slug">${escapeText(c.slug)}</a>
        ${c.starCount ? `<span class="oldgh-dash__repo-card-stars">${octicon("star", { size: 12 })} ${escapeText(c.starCount)}</span>` : ""}
      </div>
      ${c.description ? `<div class="oldgh-dash__repo-card-desc">${escapeText(c.description)}</div>` : ""}
      ${c.language ? `<div class="oldgh-dash__repo-card-lang">${escapeText(c.language)}</div>` : ""}
    </li>
  `;
}

function renderRepoBox(repos: TopRepo[]): string {
  return `
    <div class="oldgh-dash__box">
      <div class="oldgh-dash__box-head">
        <h3>Your Repositories</h3>
        <a href="/new" class="oldgh-btn oldgh-btn--sm" title="New repository">${octicon("plus", { size: 12 })} New</a>
      </div>
      <div class="oldgh-dash__repo-filter">
        <input type="text" placeholder="Find a repository…" class="oldgh-dash__repo-filter-input" aria-label="Find a repository" autocomplete="off" />
      </div>
      ${repos.length === 0
        ? `<div class="oldgh-dash__empty-row">No repositories yet.</div>`
        : `<ul class="oldgh-dash__repo-list">${repos.map(renderRepoRow).join("")}</ul>`}
    </div>
  `;
}

function renderRepoRow(r: TopRepo): string {
  return `
    <li class="oldgh-dash__repo-row" data-name="${escapeAttr(r.slug)}">
      ${octicon("repo", { size: 14 })}
      <a href="${escapeAttr(r.href)}">${escapeText(r.slug)}</a>
    </li>
  `;
}

function renderBroadcastBox(items: ChangelogItem[]): string {
  if (items.length === 0) return "";
  return `
    <div class="oldgh-dash__box oldgh-dash__broadcast">
      <div class="oldgh-dash__box-head">
        <h3>${octicon("broadcast", { size: 14 })} Latest from GitHub</h3>
      </div>
      <ul class="oldgh-dash__broadcast-list">
        ${items.map((c) => {
          // relativeTime returns "" for unparseable dates; skip the element so we
          // never render a visible but empty date span
          const rel = c.date ? relativeTime(c.date) : "";
          const date = rel
            ? `<span class="oldgh-dash__broadcast-date" title="${escapeAttr(absoluteTime(c.date!))}">${escapeText(rel)}</span>`
            : "";
          return `
          <li>
            <a href="${escapeAttr(c.href)}">${escapeText(c.title)}</a>
            ${date}
          </li>
        `;
        }).join("")}
      </ul>
    </div>
  `;
}

// Authentic 2013 dashboard cycled through a small library of ProTips on
// every page load — keyboard shortcuts, navigation hints, the occasional
// piece of trivia. We rotate the same way (random pick per render) so
// returning to the dashboard surfaces something new.
const PRO_TIPS: string[] = [
  `Use <kbd>g</kbd> then <kbd>i</kbd> on any repository to jump to its Issues.`,
  `Use <kbd>g</kbd> then <kbd>p</kbd> on any repository to jump to its Pull Requests.`,
  `Use <kbd>g</kbd> then <kbd>c</kbd> on any repository to jump to its Code.`,
  `Use <kbd>g</kbd> then <kbd>w</kbd> on any repository to jump to its Wiki.`,
  `Use <kbd>g</kbd> then <kbd>n</kbd> to jump to your Notifications.`,
  `Use <kbd>g</kbd> then <kbd>b</kbd> on any repository to jump to its Branches.`,
  `Use <kbd>s</kbd> or <kbd>/</kbd> from anywhere to focus the search bar.`,
  `Hold <kbd>shift</kbd> while clicking a link to open it in a new tab.`,
  `Star a repository to keep it close — your stars live at <a href="/stars">your stars</a>.`,
  `Subscribe to the <a href="https://github.blog" rel="noopener">GitHub Blog</a> for engineering deep-dives.`,
  `Pin up to six repositories on your profile to show off what you're proud of.`,
  `Append <code>.diff</code> or <code>.patch</code> to any PR URL for a plain-text view.`,
];

function renderProTipBox(): string {
  const tip = PRO_TIPS[Math.floor(Math.random() * PRO_TIPS.length)]!;
  return `
    <div class="oldgh-dash__protip">
      <strong>ProTip!</strong> ${tip}
    </div>
  `;
}

function iconForCard(cardType: string): string {
  switch (cardType) {
    case "FOLLOW": return "person";
    case "MERGED_PULL_REQUEST": return "git-merge";
    case "OPENED_PULL_REQUEST":
    case "PULL_REQUEST":
    case "OPENED_PR": return "git-pull-request";
    case "OPENED_ISSUE":
    case "ISSUE": return "issue-opened";
    case "CLOSED_ISSUE": return "issue-closed";
    case "REOPENED_ISSUE": return "issue-reopened";
    case "TRENDING_REPOSITORY": return "flame";
    case "REPOSITORY_RECOMMENDATION":
    case "RECOMMENDED_REPOSITORY": return "rocket";
    case "STARRED":
    case "STAR": return "star";
    case "FORK":
    case "FORKED": return "repo-forked";
    case "CREATED_REPO":
    case "CREATED_REPOSITORY":
    case "REPOSITORY_CREATED": return "repo";
    case "RELEASE":
    case "RELEASED": return "tag";
    case "COMMIT":
    case "PUSH":
    case "PUSHED": return "git-commit";
    case "WIKI": return "book";
    case "COMMENT": return "comment";
    case "BRANCH_CREATED": return "git-branch";
    default: return "rss";
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
