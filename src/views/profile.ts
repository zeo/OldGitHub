import { octicon } from "@/icons";
import { AdapterFailure } from "@/adapters";
import { fetchApi } from "@/adapters/rate-limit";
import { getProfile, type PinnedRepo, type ProfileView } from "@/adapters/profile";
import { getProfileRepos, type ProfileReposView, type RepoListItem } from "@/adapters/profile-repos";
import { absoluteTime, relativeTime } from "@/util/time";
import { languageColor } from "@/util/language-color";
import { adoptBodyRoot, removeAllBodyRoots } from "./_body";

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
  const view = await getProfile(login, query);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view, tab);
  adoptBodyRoot(root, ".oldgh-header");

  if (tab === "repositories") {
    void hydrateRepos(root, login, query);
  } else if (tab === "stars") {
    void hydrateStars(root, login);
  } else if (tab !== "overview") {
    void hydrateScrapedTab(root, login, tab, query);
  }
  if (tab === "overview" && view.kind === "user") {
    void hydrateProfileReadme(root, login);
    // public events API only goes back ~90 days; if the viewer is looking at
    // a prior year, the current activity list is misleading — hide it.
    if (!isViewingPastYear(query)) {
      void hydrateActivity(root, login);
    }
  }
  if (tab === "overview" && view.kind === "org") {
    void hydrateOrgReadme(root, login);
  }
  decorateContributionCells(root);
  // tool-tip custom elements relocate themselves asynchronously; retry once they have
  setTimeout(() => decorateContributionCells(root), 100);
  setTimeout(() => decorateContributionCells(root), 500);
  renderContributionStreaks(root);
  bindContributionTooltips(root);
}

function bindContributionTooltips(root: HTMLElement): void {
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  if (graph.dataset["oldghTipBound"] === "1") return;
  graph.dataset["oldghTipBound"] = "1";

  let tip = document.querySelector<HTMLDivElement>(".oldgh-contrib-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "oldgh-contrib-tip";
    tip.setAttribute("hidden", "");
    document.body.appendChild(tip);
  }

  const show = (cell: HTMLElement): void => {
    const text = cell.getAttribute("title") || cell.getAttribute("aria-label") || "";
    if (!text) return;
    cell.dataset["oldghTitle"] = text;
    cell.removeAttribute("title");
    if (!tip) return;
    tip.textContent = text;
    tip.removeAttribute("hidden");
    const r = cell.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    const top = window.scrollY + r.top - tip.offsetHeight - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = (cell: HTMLElement): void => {
    if (cell.dataset["oldghTitle"]) {
      cell.setAttribute("title", cell.dataset["oldghTitle"] || "");
    }
    if (tip) tip.setAttribute("hidden", "");
  };
  graph.addEventListener("mouseover", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const cell = t.closest<HTMLElement>(".ContributionCalendar-day, td.day");
    if (cell) show(cell);
  });
  graph.addEventListener("mouseout", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const cell = t.closest<HTMLElement>(".ContributionCalendar-day, td.day");
    if (cell) hide(cell);
  });
}

function renderContributionStreaks(root: HTMLElement): void {
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  const cells = Array.from(graph.querySelectorAll<HTMLElement>(".ContributionCalendar-day[data-date], td.day[data-date]"));
  if (cells.length === 0) return;
  type Day = { date: string; active: boolean };
  const days: Day[] = cells
    .map((c) => ({
      date: c.getAttribute("data-date") || "",
      active: parseInt(c.getAttribute("data-level") || "0", 10) > 0,
    }))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return;

  let longest = 0;
  let longestStart: string | null = null;
  let longestEnd: string | null = null;
  let runStart: string | null = null;
  let runLen = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (d.active) {
      if (runLen === 0) runStart = d.date;
      runLen++;
      if (runLen > longest) {
        longest = runLen;
        longestStart = runStart;
        longestEnd = d.date;
      }
    } else {
      runLen = 0;
      runStart = null;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let current = 0;
  let currentStart: string | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.date > today) continue;
    if (d.active) {
      current++;
      currentStart = d.date;
    } else {
      if (current > 0) break;
      // skip leading inactive days (today might be active later)
      if (d.date < today) break;
    }
  }

  const totalActive = days.filter((d) => d.active).length;

  const wrapper = document.createElement("div");
  wrapper.className = "oldgh-profile__contribs-stats";
  wrapper.innerHTML = `
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${totalActive}</span>
      <span class="oldgh-profile__streak-label">total days with contributions</span>
    </div>
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${longest}</span>
      <span class="oldgh-profile__streak-label">longest streak${longest > 0 && longestStart && longestEnd ? ` <small>${formatRange(longestStart, longestEnd)}</small>` : ""}</span>
    </div>
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${current}</span>
      <span class="oldgh-profile__streak-label">current streak${current > 0 && currentStart ? ` <small>${formatRange(currentStart, today)}</small>` : ""}</span>
    </div>
  `;
  const contribsSection = root.querySelector<HTMLElement>(".oldgh-profile__contribs");
  contribsSection?.appendChild(wrapper);
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const fmt = (d: Date): string => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (startIso === endIso) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

function decorateContributionCells(root: HTMLElement): void {
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  // Build a map of tool-tip[for] -> text, searching the whole document since
  // GitHub's custom element relocates tool-tips to the document body.
  const tipMap = new Map<string, string>();
  for (const tip of Array.from(document.querySelectorAll<HTMLElement>("tool-tip[for]"))) {
    const forId = tip.getAttribute("for");
    if (!forId) continue;
    const text = tip.textContent?.replace(/\s+/g, " ").trim();
    if (text) tipMap.set(forId, text);
  }
  for (const cell of Array.from(graph.querySelectorAll<HTMLElement>(".ContributionCalendar-day, td.day"))) {
    const existing = cell.getAttribute("title");
    if (existing && /contributions? on/i.test(existing)) continue;
    let label: string | null = null;
    const cellId = cell.getAttribute("id");
    if (cellId && tipMap.has(cellId)) {
      label = tipMap.get(cellId) || null;
    }
    if (!label) {
      const labelId = cell.getAttribute("aria-labelledby");
      if (labelId) {
        label = document.getElementById(labelId)?.textContent?.replace(/\s+/g, " ").trim() || null;
      }
    }
    if (!label) {
      const tipNeighbor = cell.querySelector<HTMLElement>("tool-tip, .sr-only, span");
      if (tipNeighbor) label = tipNeighbor.textContent?.replace(/\s+/g, " ").trim() || null;
    }
    if (!label) {
      // Synthesize from data-date + data-level when GitHub didn't ship a tool-tip.
      const date = cell.getAttribute("data-date");
      const level = cell.getAttribute("data-level");
      if (date) {
        const human = formatGraphDate(date);
        if (level === "0" || !level) label = `No contributions on ${human}`;
        else if (level === "1") label = `1–3 contributions on ${human}`;
        else if (level === "2") label = `4–6 contributions on ${human}`;
        else if (level === "3") label = `7–9 contributions on ${human}`;
        else label = `10+ contributions on ${human}`;
      }
    }
    if (label) cell.setAttribute("title", label);
  }
}

function formatGraphDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}


async function hydrateActivity(root: HTMLElement, login: string): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-profile__activity-slot");
  if (!slot) return;
  try {
    const resp = await fetchApi(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=30`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return;
    const events = (await resp.json()) as unknown[];
    if (!Array.isArray(events) || events.length === 0) return;
    const groups = groupEventsByMonth(events);
    if (groups.length === 0) return;
    slot.innerHTML = `
      <section class="oldgh-profile__activity">
        <h3 class="oldgh-profile__section-title">${octicon("clock", { size: 14 })} Public activity</h3>
        <div class="oldgh-activity">
          ${groups.map((g) => `
            <details class="oldgh-activity__group" ${g.isLatest ? "open" : ""}>
              <summary class="oldgh-activity__month">
                <span class="oldgh-activity__month-label">${escapeText(g.label)}</span>
                <span class="oldgh-activity__month-count">${g.items.length} ${g.items.length === 1 ? "event" : "events"}</span>
              </summary>
              <ul class="oldgh-activity__list">
                ${g.items.map(renderActivityItem).join("")}
              </ul>
            </details>
          `).join("")}
        </div>
      </section>
    `;
  } catch {
    // silent — activity is optional
  }
}

type ActivityItem = {
  type: string;
  iconName: string;
  line: string;
  occurredAt: string;
};

type ActivityGroup = {
  label: string;
  isLatest: boolean;
  items: ActivityItem[];
};

function groupEventsByMonth(events: unknown[]): ActivityGroup[] {
  const grouped = new Map<string, ActivityItem[]>();
  for (const raw of events) {
    const item = parseEvent(raw);
    if (!item) continue;
    const monthKey = item.occurredAt.slice(0, 7);
    const list = grouped.get(monthKey) ?? [];
    list.push(item);
    grouped.set(monthKey, list);
  }
  const out: ActivityGroup[] = [];
  let first = true;
  for (const [key, items] of grouped) {
    const d = new Date(key + "-01T00:00:00Z");
    const label = Number.isNaN(d.getTime())
      ? key
      : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    out.push({ label, isLatest: first, items });
    first = false;
  }
  return out;
}

function parseEvent(raw: unknown): ActivityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const type = typeof e["type"] === "string" ? (e["type"] as string) : "";
  if (!type) return null;
  const repoRaw = e["repo"] && typeof e["repo"] === "object" ? (e["repo"] as Record<string, unknown>) : null;
  const repoName = repoRaw && typeof repoRaw["name"] === "string" ? (repoRaw["name"] as string) : "";
  const repoLink = repoName ? `<a href="/${escapeAttr(repoName)}">${escapeText(repoName)}</a>` : "this repository";
  const payload = e["payload"] && typeof e["payload"] === "object" ? (e["payload"] as Record<string, unknown>) : {};
  const createdAt = typeof e["created_at"] === "string" ? (e["created_at"] as string) : "";
  const when = createdAt
    ? `<span class="oldgh-activity__when" title="${escapeAttr(absoluteTime(createdAt))}">${escapeText(relativeTime(createdAt))}</span>`
    : "";

  const built = buildLine(type, repoName, repoLink, payload, when);
  if (!built) return null;
  return { type, iconName: built.icon, line: built.line, occurredAt: createdAt };
}

function buildLine(
  type: string,
  repoName: string,
  repoLink: string,
  payload: Record<string, unknown>,
  when: string,
): { icon: string; line: string } | null {
  switch (type) {
    case "PushEvent": {
      const commits = Array.isArray(payload["commits"]) ? (payload["commits"] as unknown[]) : [];
      const sizeRaw = payload["size"];
      const size = typeof sizeRaw === "number" ? (sizeRaw as number) : commits.length;
      const ref = typeof payload["ref"] === "string" ? (payload["ref"] as string).replace(/^refs\/heads\//, "") : "";
      const refLabel = ref ? `<code>${escapeText(ref)}</code>` : "";
      if (size > 0) {
        return { icon: "git-commit", line: `Pushed <strong>${size}</strong> commit${size === 1 ? "" : "s"} to ${refLabel} in ${repoLink} ${when}` };
      }
      return { icon: "git-commit", line: `Pushed to ${refLabel} in ${repoLink} ${when}` };
    }
    case "PullRequestEvent": {
      const action = typeof payload["action"] === "string" ? (payload["action"] as string) : "";
      const pr = payload["pull_request"] && typeof payload["pull_request"] === "object" ? (payload["pull_request"] as Record<string, unknown>) : null;
      const num = pr && typeof pr["number"] === "number" ? (pr["number"] as number) : (typeof payload["number"] === "number" ? (payload["number"] as number) : 0);
      const title = pr && typeof pr["title"] === "string" ? (pr["title"] as string) : "";
      const merged = action === "merged" || (pr && pr["merged"] === true);
      const verb = merged ? "Merged" : action === "closed" ? "Closed" : action === "opened" ? "Opened" : action === "reopened" ? "Reopened" : capitalize(action);
      const icon = merged ? "git-merge" : "git-pull-request";
      const link = num
        ? `<a href="/${escapeAttr(repoName)}/pull/${num}">${escapeText(title || "#" + num)}</a>`
        : escapeText(title);
      return { icon, line: `${escapeText(verb)} pull request ${link} in ${repoLink} ${when}` };
    }
    case "PullRequestReviewEvent": {
      const pr = payload["pull_request"] && typeof payload["pull_request"] === "object" ? (payload["pull_request"] as Record<string, unknown>) : null;
      const num = pr && typeof pr["number"] === "number" ? (pr["number"] as number) : 0;
      const link = num ? `<a href="/${escapeAttr(repoName)}/pull/${num}">#${num}</a>` : "";
      return { icon: "eye", line: `Reviewed pull request ${link} in ${repoLink} ${when}` };
    }
    case "PullRequestReviewCommentEvent": {
      const pr = payload["pull_request"] && typeof payload["pull_request"] === "object" ? (payload["pull_request"] as Record<string, unknown>) : null;
      const num = pr && typeof pr["number"] === "number" ? (pr["number"] as number) : 0;
      const link = num ? `<a href="/${escapeAttr(repoName)}/pull/${num}">#${num}</a>` : "";
      return { icon: "comment", line: `Commented on pull request ${link} in ${repoLink} ${when}` };
    }
    case "IssuesEvent": {
      const action = typeof payload["action"] === "string" ? (payload["action"] as string) : "";
      const issue = payload["issue"] && typeof payload["issue"] === "object" ? (payload["issue"] as Record<string, unknown>) : null;
      const num = issue && typeof issue["number"] === "number" ? (issue["number"] as number) : (typeof payload["number"] === "number" ? (payload["number"] as number) : 0);
      const title = issue && typeof issue["title"] === "string" ? (issue["title"] as string) : "";
      const verb = action === "closed" ? "Closed" : action === "opened" ? "Opened" : action === "reopened" ? "Reopened" : capitalize(action);
      const icon = action === "closed" ? "issue-closed" : action === "reopened" ? "issue-reopened" : "issue-opened";
      const link = num
        ? `<a href="/${escapeAttr(repoName)}/issues/${num}">${escapeText(title || "#" + num)}</a>`
        : escapeText(title);
      return { icon, line: `${escapeText(verb)} issue ${link} in ${repoLink} ${when}` };
    }
    case "IssueCommentEvent": {
      const issue = payload["issue"] && typeof payload["issue"] === "object" ? (payload["issue"] as Record<string, unknown>) : null;
      const num = issue && typeof issue["number"] === "number" ? (issue["number"] as number) : 0;
      const title = issue && typeof issue["title"] === "string" ? (issue["title"] as string) : "";
      const isPull = issue && !!issue["pull_request"];
      const path = isPull ? "pull" : "issues";
      const link = num
        ? `<a href="/${escapeAttr(repoName)}/${path}/${num}">${escapeText(title || "#" + num)}</a>`
        : "";
      return { icon: "comment", line: `Commented on ${isPull ? "pull request" : "issue"} ${link} in ${repoLink} ${when}` };
    }
    case "CreateEvent": {
      const refType = typeof payload["ref_type"] === "string" ? (payload["ref_type"] as string) : "";
      const ref = typeof payload["ref"] === "string" ? (payload["ref"] as string) : "";
      if (refType === "repository") {
        return { icon: "repo", line: `Created repository ${repoLink} ${when}` };
      }
      const label = ref ? `<code>${escapeText(ref)}</code>` : refType;
      return { icon: refType === "tag" ? "tag" : "git-branch", line: `Created ${escapeText(refType)} ${label} in ${repoLink} ${when}` };
    }
    case "DeleteEvent": {
      const refType = typeof payload["ref_type"] === "string" ? (payload["ref_type"] as string) : "";
      const ref = typeof payload["ref"] === "string" ? (payload["ref"] as string) : "";
      return { icon: "trashcan", line: `Deleted ${escapeText(refType)} <code>${escapeText(ref)}</code> in ${repoLink} ${when}` };
    }
    case "ForkEvent": {
      const fork = payload["forkee"] && typeof payload["forkee"] === "object" ? (payload["forkee"] as Record<string, unknown>) : null;
      const forkName = fork && typeof fork["full_name"] === "string" ? (fork["full_name"] as string) : "";
      const forkLink = forkName ? `<a href="/${escapeAttr(forkName)}">${escapeText(forkName)}</a>` : "a fork";
      return { icon: "repo-forked", line: `Forked ${repoLink} to ${forkLink} ${when}` };
    }
    case "WatchEvent":
      return { icon: "star", line: `Starred ${repoLink} ${when}` };
    case "ReleaseEvent": {
      const action = typeof payload["action"] === "string" ? (payload["action"] as string) : "";
      const release = payload["release"] && typeof payload["release"] === "object" ? (payload["release"] as Record<string, unknown>) : null;
      const tag = release && typeof release["tag_name"] === "string" ? (release["tag_name"] as string) : "";
      const name = release && typeof release["name"] === "string" ? (release["name"] as string) : tag;
      const html = release && typeof release["html_url"] === "string" ? (release["html_url"] as string) : "";
      const link = html ? `<a href="${escapeAttr(html)}">${escapeText(name || tag || "release")}</a>` : escapeText(name);
      const verb = action === "published" ? "Released" : capitalize(action);
      return { icon: "tag", line: `${escapeText(verb)} ${link} in ${repoLink} ${when}` };
    }
    case "PublicEvent":
      return { icon: "repo", line: `Made ${repoLink} public ${when}` };
    case "MemberEvent": {
      const member = payload["member"] && typeof payload["member"] === "object" ? (payload["member"] as Record<string, unknown>) : null;
      const memberLogin = member && typeof member["login"] === "string" ? (member["login"] as string) : "";
      const link = memberLogin ? `<a href="/${escapeAttr(memberLogin)}">${escapeText(memberLogin)}</a>` : "a collaborator";
      return { icon: "person", line: `Added ${link} as a collaborator on ${repoLink} ${when}` };
    }
    case "CommitCommentEvent": {
      const comment = payload["comment"] && typeof payload["comment"] === "object" ? (payload["comment"] as Record<string, unknown>) : null;
      const sha = comment && typeof comment["commit_id"] === "string" ? (comment["commit_id"] as string).slice(0, 7) : "";
      const link = sha ? `<a href="/${escapeAttr(repoName)}/commit/${escapeAttr(sha)}"><code>${escapeText(sha)}</code></a>` : "";
      return { icon: "comment", line: `Commented on commit ${link} in ${repoLink} ${when}` };
    }
    case "GollumEvent": {
      const pages = Array.isArray(payload["pages"]) ? (payload["pages"] as unknown[]) : [];
      return { icon: "book", line: `Updated <strong>${pages.length}</strong> wiki page${pages.length === 1 ? "" : "s"} in ${repoLink} ${when}` };
    }
    default:
      return null;
  }
}

function renderActivityItem(item: ActivityItem): string {
  return `
    <li class="oldgh-activity__item">
      <span class="oldgh-activity__icon">${octicon(item.iconName, { size: 14 })}</span>
      <span class="oldgh-activity__line">${item.line}</span>
    </li>
  `;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

async function hydrateStars(root: HTMLElement, login: string): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-profile__scraped");
  if (!container) return;
  try {
    const resp = await fetchApi(`https://api.github.com/users/${encodeURIComponent(login)}/starred?per_page=30`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (resp.ok) {
      const data = (await resp.json()) as unknown[];
      if (Array.isArray(data) && data.length > 0) {
        container.innerHTML = `
          <ul class="oldgh-profile__repos-list">
            ${data.map((r) => renderStarItem(r)).join("")}
          </ul>
        `;
        return;
      }
    }
    // Fall back to scraping the page (catches private stars / API gaps).
    const html = await scrapeStarsPage(login);
    if (html) {
      container.innerHTML = html;
      return;
    }
    container.innerHTML = `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No starred repositories.</p></div>`;
  } catch {
    container.innerHTML = `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Couldn't load stars.</p></div>`;
  }
}

async function scrapeStarsPage(login: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://github.com/${encodeURIComponent(login)}?tab=stars`, {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items: string[] = [];
    const seen = new Set<string>();
    // modern GH wraps each starred entry in a div with a repo title <h3> and a
    // description <p>. itemprop attributes are gone from current markup, so
    // walk every h3 with a /:owner/:repo anchor instead and read its siblings.
    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("h3 a[href^='/']"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const m = /^\/([\w.-]+)\/([\w.-]+)\/?$/.exec(href);
      if (!m || !m[1] || !m[2]) continue;
      const full = `${m[1]}/${m[2]}`;
      if (seen.has(full)) continue;
      seen.add(full);
      // walk up to a card-like container — turbo-frame items, divs, articles, list rows
      const card: Element = a.closest("article, li, .Box-row, [class*='border-bottom'], div.py-3, div.py-4") || a.parentElement?.parentElement || a.parentElement || a;
      // description: pinned-item-desc OR a generic <p> after the h3. skip any
      // <p> whose text matches GitHub's hydration-error placeholder.
      const descCandidates = [
        ...Array.from(card.querySelectorAll<HTMLElement>(".pinned-item-desc, p[itemprop='description'], p.color-fg-muted")),
        ...Array.from(card.querySelectorAll<HTMLElement>("h3 + p, h3 + div p")),
      ];
      let desc = "";
      for (const el of descCandidates) {
        const t = el.textContent?.replace(/\s+/g, " ").trim() || "";
        if (!t) continue;
        if (/There was an error while loading/i.test(t)) continue;
        if (/^Loading\.?\.?\.?$/i.test(t)) continue;
        desc = t;
        break;
      }
      // language: span next to a color swatch, or repo-language-color sibling
      const langSwatch = card.querySelector<HTMLElement>(".repo-language-color, [style*='background-color'][class*='language']");
      const langColor = langSwatch ? langSwatch.style.backgroundColor || null : null;
      const langText =
        card.querySelector<HTMLElement>("[itemprop='programmingLanguage'], span.color-fg-default + span, span.f6.color-fg-muted span")?.textContent?.replace(/\s+/g, " ").trim() ||
        (langSwatch ? (langSwatch.nextElementSibling?.textContent?.trim() || langSwatch.parentElement?.textContent?.trim() || null) : null);
      // stars count
      const starsEl = card.querySelector<HTMLAnchorElement>('a[href*="/stargazers"]');
      const starsTxt = starsEl?.textContent?.replace(/\s+/g, " ").trim() || "";
      // updated time
      const timeEl = card.querySelector<HTMLElement>("relative-time, time-ago, time");
      const updatedIso = timeEl?.getAttribute("datetime") || "";
      const langDot = langText
        ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(langColor || languageColor(langText))}"></span>`
        : "";
      const meta: string[] = [];
      if (langText) meta.push(`<span>${langDot}${escapeText(langText)}</span>`);
      if (starsTxt) meta.push(`<span>${octicon("star", { size: 12 })}${escapeText(starsTxt)}</span>`);
      if (updatedIso) meta.push(`<span title="${escapeAttr(absoluteTime(updatedIso))}">updated ${escapeText(relativeTime(updatedIso))}</span>`);
      items.push(`
        <li class="oldgh-profile__repo">
          <h3 class="oldgh-profile__repo-name"><a href="/${escapeAttr(full)}">${escapeText(full)}</a></h3>
          ${desc ? `<p class="oldgh-profile__repo-desc">${escapeText(desc)}</p>` : ""}
          ${meta.length > 0 ? `<p class="oldgh-profile__repo-meta">${meta.join("")}</p>` : ""}
        </li>
      `);
    }
    if (items.length === 0) return null;
    return `<ul class="oldgh-profile__repos-list">${items.join("")}</ul>`;
  } catch {
    return null;
  }
}

function renderStarItem(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  const full = typeof r["full_name"] === "string" ? (r["full_name"] as string) : "";
  if (!full) return "";
  const desc = typeof r["description"] === "string" ? (r["description"] as string) : "";
  const stars = typeof r["stargazers_count"] === "number" ? (r["stargazers_count"] as number) : 0;
  const forks = typeof r["forks_count"] === "number" ? (r["forks_count"] as number) : 0;
  const lang = typeof r["language"] === "string" ? (r["language"] as string) : null;
  const updated = typeof r["pushed_at"] === "string" ? (r["pushed_at"] as string) : "";
  const langDot = lang
    ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(languageColor(lang))}"></span>`
    : "";
  return `
    <li class="oldgh-profile__repo">
      <h3 class="oldgh-profile__repo-name"><a href="/${escapeAttr(full)}">${escapeText(full)}</a></h3>
      ${desc ? `<p class="oldgh-profile__repo-desc">${escapeText(desc)}</p>` : ""}
      <p class="oldgh-profile__repo-meta">
        ${lang ? `<span>${langDot}${escapeText(lang)}</span>` : ""}
        <span>${octicon("star", { size: 12 })}${formatNum(stars)}</span>
        <span>${octicon("repo-forked", { size: 12 })}${formatNum(forks)}</span>
        ${updated ? `<span>updated <span title="${escapeAttr(absoluteTime(updated))}">${escapeText(relativeTime(updated))}</span></span>` : ""}
      </p>
    </li>
  `;
}

function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function unmountProfile(): void {
  removeAllBodyRoots();
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
    return `<div class="oldgh-profile__repos" data-state="loading">${renderReposLoading()}</div>`;
  }
  if (tab !== "overview") {
    return `<div class="oldgh-profile__scraped" data-state="loading"><div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Loading&hellip;</p></div></div>`;
  }
  if (v.kind === "org") {
    return `
      ${v.pinned.length > 0 ? renderPinned(v) : ""}
      <div class="oldgh-profile__org-readme-slot">${v.pinned.length === 0 ? renderOrgEmptyState(v) : ""}</div>
    `;
  }
  return `
    <div class="oldgh-profile__readme-slot"></div>
    ${v.pinned.length > 0 ? renderPinned(v) : ""}
    ${renderContributions(v)}
    <div class="oldgh-profile__activity-slot"></div>
  `;
}

// shown when an org overview has neither pinned repos nor a .github profile
// readme, so the main column never renders empty. replaced wholesale by
// hydrateOrgReadme when a readme is found
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

async function hydrateOrgReadme(root: HTMLElement, login: string): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-profile__org-readme-slot");
  if (!slot) return;
  const url = `https://api.github.com/repos/${encodeURIComponent(login)}/.github/readme`;
  try {
    const htmlResp = await fetchApi(url, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github.html" },
    });
    if (!htmlResp.ok) return;
    const ct = htmlResp.headers.get("content-type") || "";
    const text = await htmlResp.text();
    const looksHtml = ct.includes("html") || /^\s*</.test(text);
    if (!looksHtml || !text.trim()) return;
    slot.innerHTML = `
      <section class="oldgh-profile__readme">
        <h3 class="oldgh-profile__section-title">${octicon("book", { size: 14 })} ${escapeText(login)}/<strong>.github</strong></h3>
        <article class="oldgh-profile__readme-body markdown-body">${sanitizeBodyHtml(text)}</article>
      </section>
    `;
  } catch {
    // silent — no readme is fine
  }
}

async function hydrateProfileReadme(root: HTMLElement, login: string): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-profile__readme-slot");
  if (!slot) return;
  const url = `https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`;
  try {
    const htmlResp = await fetchApi(url, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github.html" },
    });
    if (htmlResp.ok) {
      const ct = htmlResp.headers.get("content-type") || "";
      const text = await htmlResp.text();
      const looksHtml = ct.includes("html") || /^\s*</.test(text);
      if (looksHtml && text.trim()) {
        slot.innerHTML = `
          <section class="oldgh-profile__readme">
            <h3 class="oldgh-profile__section-title">${octicon("book", { size: 14 })} ${escapeText(login)}/<strong>${escapeText(login)}</strong></h3>
            <article class="oldgh-profile__readme-body markdown-body">${sanitizeBodyHtml(text)}</article>
          </section>
        `;
        return;
      }
    } else if (htmlResp.status === 404) {
      return;
    }
    const rawResp = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(login)}/${encodeURIComponent(login)}/HEAD/README.md`, {
      credentials: "omit",
    });
    if (!rawResp.ok) return;
    const md = await rawResp.text();
    slot.innerHTML = `
      <section class="oldgh-profile__readme">
        <h3 class="oldgh-profile__section-title">${octicon("book", { size: 14 })} ${escapeText(login)}/<strong>${escapeText(login)}</strong></h3>
        <article class="oldgh-profile__readme-body markdown-body"><pre style="white-space:pre-wrap">${escapeText(md.slice(0, 50000))}</pre></article>
      </section>
    `;
  } catch {
    // silent — no readme is fine
  }
}

function renderReposLoading(): string {
  return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Loading repositories&hellip;</p></div>`;
}

async function hydrateScrapedTab(root: HTMLElement, login: string, tab: string, query: string): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-profile__scraped");
  if (!container) return;
  const url = `https://github.com/${encodeURIComponent(login)}?tab=${encodeURIComponent(tab)}${query && !/^tab=/.test(query) ? "&" + query.replace(/^tab=[^&]*&?/, "") : ""}`;
  try {
    const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const frame: Element =
      doc.querySelector("turbo-frame#user-profile-frame") ||
      doc.querySelector("turbo-frame[id*='profile']") ||
      doc.querySelector("turbo-frame[id]") ||
      doc.querySelector("main") ||
      doc.body;
    if (tab === "achievements") {
      container.innerHTML = renderAchievementsFromFrame(frame);
      return;
    }
    if (tab === "followers" || tab === "following" || tab === "people") {
      container.innerHTML = renderPeopleFromFrame(frame);
      return;
    }
    if (tab === "packages") {
      container.innerHTML = renderPackagesFromFrame(frame, login);
      return;
    }
    if (tab === "sponsoring") {
      container.innerHTML = renderSponsoringFromFrame(frame, login);
      return;
    }
    if (tab === "projects") {
      container.innerHTML = renderProjectsFromFrame(frame, login);
      return;
    }
    for (const node of Array.from(frame.querySelectorAll("script, style, iframe, object, embed"))) node.remove();
    for (const node of Array.from(frame.querySelectorAll<HTMLElement>("*"))) {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      }
    }
    container.innerHTML = frame.innerHTML;
  } catch {
    container.innerHTML = `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">Couldn't load this tab.</p></div>`;
  }
}

function renderPeopleFromFrame(frame: Element): string {
  type P = { login: string; name: string | null; avatarUrl: string; bio: string | null; location: string | null };
  const people: P[] = [];
  const seen = new Set<string>();

  // Walk every hovercard-anchor; pull bio/location/name from the closest card
  // container if one exists, but don't require it. Modern GitHub renders the
  // org people list as a flat grid where most "cards" are siblings, not <li>s.
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[data-hovercard-type='user']"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/?$/.exec(href);
    if (!m || !m[1]) continue;
    const login = m[1];
    if (seen.has(login)) continue;
    seen.add(login);

    const card: Element | null =
      a.closest("li") ||
      a.closest("div.d-table") ||
      a.closest(".user-list-item") ||
      a.closest("[data-testid*='member']") ||
      a.parentElement;

    // Look for an avatar only inside the anchor itself — the scraped list often
    // wraps cards in shared ancestors, so a broader query returns the same image
    // for every member. Fall back to the login-based redirect URL.
    let avatarImg = a.querySelector<HTMLImageElement>("img[src*='avatars']") ?? null;
    const avatarUrl = avatarImg?.getAttribute("src") || `https://github.com/${login}.png?size=64`;

    let name: string | null = null;
    if (card) {
      const nameEl = card.querySelector(".f4.lh-condensed, .text-bold[itemprop='name'], h3.f4");
      if (nameEl) name = (nameEl.textContent || "").trim() || null;
    }
    let bio: string | null = null;
    if (card) {
      const bioEl = card.querySelector(".user-profile-bio, .pinned-item-desc, p.color-fg-muted, [data-bio-text]");
      if (bioEl) bio = (bioEl.textContent || "").trim().slice(0, 200) || null;
    }
    let location: string | null = null;
    if (card) {
      const locEl = card.querySelector("[itemprop='homeLocation'], li[itemprop='homeLocation'] span");
      if (locEl) location = (locEl.textContent || "").trim() || null;
    }
    // github puts the username in the name slot when there is no display name
    people.push({ login, name: name && name !== login ? name : null, avatarUrl, bio, location });
  }
  if (people.length === 0) {
    return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No users to show.</p></div>`;
  }
  return `
    <ul class="oldgh-people">
      ${people.map((p) => `
        <li class="oldgh-people__item">
          <a class="oldgh-people__avatar" href="/${escapeAttr(p.login)}">
            <img src="${escapeAttr(p.avatarUrl)}" width="48" height="48" alt="${escapeAttr(p.login)}" />
          </a>
          <div class="oldgh-people__body">
            <div class="oldgh-people__name">
              ${p.name ? `<a href="/${escapeAttr(p.login)}"><strong>${escapeText(p.name)}</strong></a> ` : ""}
              <a href="/${escapeAttr(p.login)}" class="oldgh-people__login">${escapeText(p.login)}</a>
            </div>
            ${p.bio ? `<p class="oldgh-people__bio">${escapeText(p.bio)}</p>` : ""}
            ${p.location ? `<p class="oldgh-people__location">${octicon("location", { size: 12 })} ${escapeText(p.location)}</p>` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPackagesFromFrame(frame: Element, login: string): string {
  type P = {
    name: string;
    href: string;
    registry: string | null;
    description: string | null;
    version: string | null;
    isPrivate: boolean;
    repo: string | null;
  };
  const packages: P[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[href*='/packages']"))) {
    const href = a.getAttribute("href") || "";
    const m = /\/([\w.-]+)\/packages\/([\w.-]+)\/package\/([\w.\-@/+%]+)/.exec(href);
    if (!m) continue;
    const registry = m[2]!;
    const name = decodeURIComponent(m[3]!);
    const key = `${registry}:${name}`;
    if (seen.has(key)) continue;
    const card = a.closest("li, article, .Box-row, .d-flex") || a;
    const titleText = (a.textContent || "").trim();
    const cleanName = titleText || name;
    const descEl = card.querySelector<HTMLElement>("p.color-fg-muted, [data-test-selector='package-description']");
    const description = descEl?.textContent?.trim() || null;
    const versionEl = card.querySelector<HTMLElement>("[data-test-selector*='package-version'], [class*='version']");
    const version = versionEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    const isPrivate = !!card.querySelector("svg.octicon-lock, [aria-label*='Private']");
    const repoAnchor = Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .find((x) => /^\/[\w.-]+\/[\w.-]+\/?$/.test(x.getAttribute("href") || ""));
    const repo = repoAnchor?.getAttribute("href")?.replace(/^\/+/, "") || null;
    seen.add(key);
    packages.push({
      name: cleanName,
      href,
      registry,
      description,
      version,
      isPrivate,
      repo,
    });
  }
  if (packages.length === 0) {
    return `
      <section class="oldgh-packages">
        <div class="oldgh-packages__empty">
          ${octicon("package", { size: 40 })}
          <h2>No packages published yet.</h2>
          <p>Container, npm, NuGet, Maven, RubyGems and other packages published from @${escapeText(login)}'s repositories will appear here.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-packages">
      <header class="oldgh-packages__head">
        <h3>${octicon("package", { size: 16 })} Packages <span class="oldgh-packages__count">${packages.length}</span></h3>
      </header>
      <ul class="oldgh-packages__list">
        ${packages.map(renderPackageRow).join("")}
      </ul>
    </section>
  `;
}

function renderPackageRow(p: { name: string; href: string; registry: string | null; description: string | null; version: string | null; isPrivate: boolean; repo: string | null }): string {
  const registryIcon = packageRegistryIcon(p.registry);
  return `
    <li class="oldgh-packages__row">
      <span class="oldgh-packages__icon">${registryIcon}</span>
      <div class="oldgh-packages__main">
        <h3 class="oldgh-packages__name">
          <a href="${escapeAttr(p.href)}">${escapeText(p.name)}</a>
          ${p.isPrivate ? `<span class="oldgh-packages__chip">Private</span>` : ""}
        </h3>
        ${p.description ? `<p class="oldgh-packages__desc">${escapeText(p.description)}</p>` : ""}
        <div class="oldgh-packages__meta">
          ${p.registry ? `<span class="oldgh-packages__registry">${escapeText(formatRegistry(p.registry))}</span>` : ""}
          ${p.version ? `<span>${octicon("tag", { size: 11 })} ${escapeText(p.version)}</span>` : ""}
          ${p.repo ? `<span>${octicon("repo", { size: 11 })} <a href="/${escapeAttr(p.repo)}">${escapeText(p.repo)}</a></span>` : ""}
        </div>
      </div>
    </li>
  `;
}

function packageRegistryIcon(registry: string | null): string {
  switch (registry) {
    case "npm": return octicon("package", { size: 18 });
    case "container": case "docker": return octicon("package", { size: 18 });
    case "rubygems": return octicon("ruby", { size: 18 });
    case "maven": return octicon("file-binary", { size: 18 });
    case "nuget": return octicon("file-binary", { size: 18 });
    default: return octicon("package", { size: 18 });
  }
}

function formatRegistry(registry: string): string {
  switch (registry) {
    case "npm": return "npm";
    case "container": return "Container";
    case "docker": return "Docker";
    case "rubygems": return "RubyGems";
    case "maven": return "Maven";
    case "nuget": return "NuGet";
    default: return registry;
  }
}

function renderSponsoringFromFrame(frame: Element, login: string): string {
  type S = { login: string; name: string | null; avatarUrl: string; tier: string | null };
  const sponsorees: S[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[data-hovercard-type='user'], a[href^='/']"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/([\w.-]+)\/?$/.exec(href);
    if (!m) continue;
    const candidateLogin = m[1]!;
    if (candidateLogin === login) continue;
    if (seen.has(candidateLogin)) continue;
    const card = a.closest("li, article, .Box-row, .d-flex");
    if (!card) continue;
    // Only count cards that look like sponsoring cards (have a sponsor button or tier hint).
    if (!card.querySelector("a[href*='/sponsors/'], a[href*='sponsor'], [class*='tier']")) continue;
    const avatarImg = card.querySelector<HTMLImageElement>("img.avatar, img[src*='avatars']");
    const avatarUrl = avatarImg?.getAttribute("src") || `https://github.com/${candidateLogin}.png?size=64`;
    const nameEl = card.querySelector<HTMLElement>("h3, .h3, .f4, [class*='heading']");
    const name = nameEl?.textContent?.trim() || null;
    const tierEl = card.querySelector<HTMLElement>("[class*='tier']");
    const tier = tierEl?.textContent?.replace(/\s+/g, " ").trim() || null;
    seen.add(candidateLogin);
    sponsorees.push({ login: candidateLogin, name: name !== candidateLogin ? name : null, avatarUrl, tier });
  }
  if (sponsorees.length === 0) {
    return `
      <section class="oldgh-sponsoring">
        <div class="oldgh-sponsoring__empty">
          ${octicon("heart", { size: 40 })}
          <h2>Not sponsoring anyone yet.</h2>
          <p>Sponsorships fund maintainers of open-source projects. Open the <a href="/sponsors/explore">Sponsors directory</a> to find people @${escapeText(login)} relies on.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-sponsoring">
      <header class="oldgh-sponsoring__head">
        <h3>${octicon("heart", { size: 16 })} Sponsoring <span class="oldgh-sponsoring__count">${sponsorees.length}</span></h3>
        <p>Maintainers @${escapeText(login)} financially supports.</p>
      </header>
      <ul class="oldgh-sponsoring__grid">
        ${sponsorees.map((s) => `
          <li class="oldgh-sponsoring__card">
            <a class="oldgh-sponsoring__avatar" href="/${escapeAttr(s.login)}" aria-label="View ${escapeAttr(s.login)}'s profile">
              <img src="${escapeAttr(s.avatarUrl)}" width="56" height="56" alt="" />
            </a>
            <div class="oldgh-sponsoring__main">
              ${s.name ? `<a class="oldgh-sponsoring__name" href="/${escapeAttr(s.login)}"><strong>${escapeText(s.name)}</strong></a>` : ""}
              <a class="oldgh-sponsoring__login" href="/${escapeAttr(s.login)}">@${escapeText(s.login)}</a>
              ${s.tier ? `<span class="oldgh-sponsoring__tier">${escapeText(s.tier)}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderProjectsFromFrame(frame: Element, login: string): string {
  type P = { number: number; title: string; description: string | null; href: string; status: "open" | "closed"; itemCount: number | null };
  const projects: P[] = [];
  const seen = new Set<number>();
  for (const a of Array.from(frame.querySelectorAll<HTMLAnchorElement>("a[href*='/projects/']"))) {
    const href = a.getAttribute("href") || "";
    const m = new RegExp(`^/${login}/projects/(\\d+)`).exec(href) || /^\/users\/[\w.-]+\/projects\/(\d+)/.exec(href) || new RegExp(`^/orgs/${login}/projects/(\\d+)`).exec(href);
    if (!m) continue;
    const num = parseInt(m[1]!, 10);
    if (seen.has(num)) continue;
    const card = a.closest("li, article, .Box-row");
    if (!card) continue;
    const title = (a.textContent || "").trim();
    if (!title || title.length > 200) continue;
    const descEl = card.querySelector<HTMLElement>("p.color-fg-muted, .text-small.color-fg-muted");
    const description = descEl?.textContent?.trim() || null;
    const stateEl = card.querySelector<HTMLElement>("[data-state], .State");
    const status: "open" | "closed" = /closed/i.test(stateEl?.textContent || "") ? "closed" : "open";
    const itemCountText = card.querySelector<HTMLElement>(".Counter")?.textContent || "";
    const itemCount = parseInt(itemCountText.replace(/\D/g, ""), 10) || null;
    seen.add(num);
    projects.push({ number: num, title, description, href, status, itemCount });
  }
  if (projects.length === 0) {
    return `
      <section class="oldgh-user-projects">
        <div class="oldgh-user-projects__empty">
          ${octicon("project", { size: 40 })}
          <h2>No projects yet.</h2>
          <p>Projects let @${escapeText(login)} plan work across repositories — roadmaps, todo boards, and so on.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-user-projects">
      <header class="oldgh-user-projects__head">
        <h3>${octicon("project", { size: 16 })} Projects <span class="oldgh-user-projects__count">${projects.length}</span></h3>
      </header>
      <ul class="oldgh-user-projects__list">
        ${projects.map((p) => `
          <li class="oldgh-user-projects__row">
            <span class="oldgh-user-projects__icon">${octicon("project", { size: 16 })}</span>
            <div class="oldgh-user-projects__main">
              <h3>
                <a href="${escapeAttr(p.href)}">${escapeText(p.title)}</a>
                <span class="oldgh-user-projects__num">#${p.number}</span>
              </h3>
              ${p.description ? `<p class="oldgh-user-projects__desc">${escapeText(p.description)}</p>` : ""}
              <div class="oldgh-user-projects__meta">
                <span class="oldgh-user-projects__status oldgh-user-projects__status--${p.status}">${p.status === "open" ? "Open" : "Closed"}</span>
                ${p.itemCount !== null ? `<span>${p.itemCount} item${p.itemCount === 1 ? "" : "s"}</span>` : ""}
              </div>
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderAchievementsFromFrame(frame: Element): string {
  type A = { slug: string; name: string; iconUrl: string; tier: string | null; description: string | null };
  const earned: A[] = [];
  for (const d of Array.from(frame.querySelectorAll<HTMLElement>("details[data-achievement-slug]"))) {
    const slug = d.getAttribute("data-achievement-slug") || "";
    const img = d.querySelector<HTMLImageElement>("img");
    const iconUrl = img?.getAttribute("src") || "";
    const name = img?.getAttribute("alt")?.replace(/^Achievement:\s*/i, "").trim() || slug;
    const tierEl = d.querySelector(".achievement-tier, [class*='tier']");
    const tier = tierEl?.textContent?.trim() || null;
    // Description: pick the first paragraph from the popover body (skip the title).
    let description: string | null = null;
    for (const p of Array.from(d.querySelectorAll<HTMLElement>(".Popover-message p, .Popover p, .position-absolute p"))) {
      const txt = (p.textContent || "").trim();
      if (txt && txt.length > 4 && !/^achievement:\s/i.test(txt) && txt !== name) {
        description = txt;
        break;
      }
    }
    if (slug && iconUrl) earned.push({ slug, name, iconUrl, tier, description });
  }
  if (earned.length === 0) {
    return `
      <section class="oldgh-achievements">
        <div class="oldgh-achievements__empty">
          ${octicon("star", { size: 36 })}
          <h3>No achievements earned yet.</h3>
          <p>Achievements highlight specific events on GitHub. Open pull requests, ship releases, sponsor maintainers — they accumulate over time.</p>
        </div>
      </section>
    `;
  }
  return `
    <section class="oldgh-achievements">
      <header class="oldgh-achievements__intro">
        <h3>${octicon("star", { size: 18 })} Achievements <span class="oldgh-achievements__count">${earned.length}</span></h3>
        <p>Highlights and milestones earned across GitHub activity.</p>
      </header>
      <ul class="oldgh-achievements__grid">
        ${earned.map((a) => `
          <li class="oldgh-achievements__item" title="${escapeAttr(a.description || a.name)}">
            <div class="oldgh-achievements__icon-wrap">
              <img class="oldgh-achievements__icon" src="${escapeAttr(a.iconUrl)}" alt="${escapeAttr(a.name)}" width="80" height="80" />
              ${a.tier ? `<span class="oldgh-achievements__tier">×${escapeText(a.tier.replace(/^x/i, ""))}</span>` : ""}
            </div>
            <div class="oldgh-achievements__meta">
              <span class="oldgh-achievements__name">${escapeText(a.name)}</span>
              ${a.description ? `<span class="oldgh-achievements__desc">${escapeText(a.description.slice(0, 120))}</span>` : ""}
            </div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

async function hydrateRepos(root: HTMLElement, login: string, query: string): Promise<void> {
  const container = root.querySelector<HTMLElement>(".oldgh-profile__repos");
  if (!container) return;
  let data: ProfileReposView;
  try {
    data = await getProfileRepos(login, query);
  } catch (err) {
    container.innerHTML = `<p class="oldgh-profile__muted">${err instanceof AdapterFailure ? "Couldn't load repositories." : "Couldn't load repositories."}</p>`;
    return;
  }
  container.innerHTML = renderRepos(data);
}

function renderRepos(d: ProfileReposView): string {
  if (d.items.length === 0) {
    return `<div class="oldgh-profile__empty"><p class="oldgh-profile__muted">No repositories.</p></div>`;
  }
  return `
    <ul class="oldgh-repo-list">
      ${d.items.map((r) => renderRepoRow(r)).join("")}
    </ul>
    ${renderRepoPagination(d)}
  `;
}

function renderRepoRow(r: RepoListItem): string {
  const privacy = r.isPrivate
    ? `<span class="oldgh-repo-list__visibility">Private</span>`
    : `<span class="oldgh-repo-list__visibility oldgh-repo-list__visibility--public">Public</span>`;
  const forkLabel = r.isFork ? `<span class="oldgh-repo-list__type">Forked</span>` : "";
  const mirror = r.isMirror ? `<span class="oldgh-repo-list__type">Mirror</span>` : "";
  const template = r.isTemplate ? `<span class="oldgh-repo-list__type">Template</span>` : "";

  const meta: string[] = [];
  if (r.language) {
    const swatch = r.languageColor
      ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(r.languageColor)}"></span>`
      : "";
    meta.push(`<span>${swatch}${escapeText(r.language)}</span>`);
  }
  if (r.stars) meta.push(`<span>${octicon("star", { size: 12 })}${escapeText(r.stars)}</span>`);
  if (r.forks) meta.push(`<span>${octicon("repo-forked", { size: 12 })}${escapeText(r.forks)}</span>`);
  if (r.updatedIso) {
    meta.push(`<span title="${escapeAttr(absoluteTime(r.updatedIso))}">Updated ${escapeText(relativeTime(r.updatedIso))}</span>`);
  }

  return `
    <li class="oldgh-repo-list__item">
      <h3 class="oldgh-repo-list__title">
        <a href="${escapeAttr(r.href)}"><strong>${escapeText(r.name)}</strong></a>
        ${privacy}${forkLabel}${mirror}${template}
      </h3>
      ${r.description ? `<p class="oldgh-repo-list__desc">${escapeText(r.description)}</p>` : ""}
      <p class="oldgh-repo-list__meta">${meta.join("")}</p>
    </li>
  `;
}

function renderRepoPagination(d: ProfileReposView): string {
  if (!d.pagination.prevHref && !d.pagination.nextHref) return "";
  const prev = d.pagination.prevHref
    ? `<a class="oldgh-btn" href="${escapeAttr(d.pagination.prevHref)}">${octicon("triangle-left", { size: 14 })}<span>Previous</span></a>`
    : `<button class="oldgh-btn" type="button" disabled>${octicon("triangle-left", { size: 14 })}<span>Previous</span></button>`;
  const next = d.pagination.nextHref
    ? `<a class="oldgh-btn" href="${escapeAttr(d.pagination.nextHref)}"><span>Next</span>${octicon("triangle-right", { size: 14 })}</a>`
    : `<button class="oldgh-btn" type="button" disabled><span>Next</span>${octicon("triangle-right", { size: 14 })}</button>`;
  return `<div class="oldgh-repo-list__pagination">${prev}${next}</div>`;
}

function renderSidebar(v: ProfileView): string {
  const avatar = `
    <div class="oldgh-profile__avatar">
      <img src="${escapeAttr(v.avatarUrl)}" alt="${escapeAttr(v.displayName)}" />
    </div>
  `;
  const action = v.isViewer
    ? `<a class="oldgh-btn oldgh-profile__edit" href="/settings/profile">Edit profile</a>`
    : `<button type="button" class="oldgh-btn oldgh-profile__follow">${octicon("person", { size: 14 })}<span>Follow</span></button>`;

  const stats: string[] = [];
  if (v.followersCount) stats.push(statItem(v.followersCount, "followers", `/${v.login}?tab=followers`));
  if (v.followingCount) stats.push(statItem(v.followingCount, "following", `/${v.login}?tab=following`));
  if (v.repoCountHint != null) stats.push(statItem(String(v.repoCountHint), "repos", `/${v.login}?tab=repositories`));

  const details: string[] = [];
  if (v.bio) details.push(`<p class="oldgh-profile__bio">${escapeText(v.bio)}</p>`);
  if (v.location) details.push(`<p class="oldgh-profile__detail">${octicon("location", { size: 14 })}<span>${escapeText(v.location)}</span></p>`);
  if (v.homepage) details.push(`<p class="oldgh-profile__detail">${octicon("link", { size: 14 })}<a href="${escapeAttr(v.homepage)}" rel="nofollow noopener">${escapeText(stripUrl(v.homepage))}</a></p>`);

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
          ${v.achievements.slice(0, 8).map((a) => `<li><a href="${escapeAttr(a.href)}" title="${escapeAttr(a.name)}"><img src="${escapeAttr(a.iconUrl)}" alt="${escapeAttr(a.name)}" width="56" height="56" /></a></li>`).join("")}
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

function statItem(value: string, label: string, href: string): string {
  return `<li><a href="${escapeAttr(href)}"><strong>${escapeText(value)}</strong> <span>${escapeText(label)}</span></a></li>`;
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
  const langSwatch = p.languageColor
    ? `<span class="oldgh-profile__lang-swatch" style="background:${escapeAttr(p.languageColor)}"></span>`
    : "";
  const meta: string[] = [];
  if (p.language) meta.push(`<span class="oldgh-profile__pinned-lang">${langSwatch}${escapeText(p.language)}</span>`);
  if (p.stars) meta.push(`<span class="oldgh-profile__pinned-count">${octicon("star", { size: 12 })}${escapeText(p.stars)}</span>`);
  if (p.forks) meta.push(`<span class="oldgh-profile__pinned-count">${octicon("repo-forked", { size: 12 })}${escapeText(p.forks)}</span>`);
  return `
    <li class="oldgh-profile__pinned-card">
      <h4 class="oldgh-profile__pinned-title">
        ${repoIcon}
        <a href="${escapeAttr(p.href)}"><strong>${escapeText(p.nwo.split("/").pop() ?? p.nwo)}</strong></a>
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
          <div class="oldgh-profile__contribs-graph">${sanitizeBodyHtml(v.contributionGraphHtml)}</div>
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

function sanitizeBodyHtml(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
