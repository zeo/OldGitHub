import { AdapterFailure } from "./index";

const HEADERS = { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" } as const;

export type FeedActor = { login: string; avatarUrl: string | null };

export type FeedRepoCard = {
  slug: string;
  href: string;
  description: string | null;
  language: string | null;
  starCount: string | null;
  forkCount: string | null;
  ownerAvatarUrl: string | null;
};

export type FeedItem = {
  cardType: string;
  actor: FeedActor | null;
  headline: string;
  bodyTextLink: { text: string; href: string } | null;
  bodyExcerpt: string | null;
  occurredAt: string | null;
  repoCards: FeedRepoCard[];
};

export type TopRepo = { slug: string; href: string; avatarUrl: string | null };

export type ChangelogItem = { title: string; href: string; date: string | null };

export type DashboardView = {
  feed: FeedItem[];
  trendingRepos: FeedRepoCard[];
  recommendedRepos: FeedRepoCard[];
  topRepos: TopRepo[];
  changelog: ChangelogItem[];
  viewerLogin: string | null;
};

export async function getDashboard(): Promise<DashboardView> {
  const [feedRes, topRes, changeRes] = await Promise.allSettled([
    fetchFragment("/conduit/for_you_feed"),
    fetchFragment("/dashboard/my_top_repositories"),
    fetchFragment("/dashboard/changelog"),
  ]);

  // the feed is the page; sidebars may fail quietly but an empty feed would read as no activity
  if (feedRes.status === "rejected") throw feedRes.reason;
  const feedHtml = feedRes.value;
  const topReposHtml = topRes.status === "fulfilled" ? topRes.value : "";
  const changelogHtml = changeRes.status === "fulfilled" ? changeRes.value : "";

  const allFeed = parseFeed(feedHtml);
  const trendingRepos: FeedRepoCard[] = [];
  const recommendedRepos: FeedRepoCard[] = [];
  const feed: FeedItem[] = [];
  for (const item of allFeed) {
    if (item.cardType === "TRENDING_REPOSITORY") {
      trendingRepos.push(...item.repoCards);
    } else if (item.cardType === "REPOSITORY_RECOMMENDATION" || item.cardType === "RECOMMENDED_REPOSITORY") {
      recommendedRepos.push(...item.repoCards);
    } else {
      feed.push(item);
    }
  }

  const topRepos = parseTopRepos(topReposHtml);
  const changelog = parseChangelog(changelogHtml);
  const viewerLogin = readViewerLogin();

  return {
    feed,
    trendingRepos: dedupRepos(trendingRepos).slice(0, 5),
    recommendedRepos: dedupRepos(recommendedRepos).slice(0, 5),
    topRepos,
    changelog,
    viewerLogin,
  };
}

function dedupRepos(items: FeedRepoCard[]): FeedRepoCard[] {
  const seen = new Set<string>();
  const out: FeedRepoCard[] = [];
  for (const r of items) {
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    out.push(r);
  }
  return out;
}

async function fetchFragment(path: string): Promise<string> {
  const resp = await fetch(`https://github.com${path}`, {
    credentials: "include",
    headers: HEADERS,
  });
  if (!resp.ok) {
    throw new AdapterFailure("getDashboard", `${path} responded ${resp.status}`);
  }
  return resp.text();
}

function parseFeed(html: string): FeedItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const articles = Array.from(doc.querySelectorAll("article"));
  return articles.map(parseFeedArticle).filter((x): x is FeedItem => x !== null);
}

function parseFeedArticle(art: Element): FeedItem | null {
  stripNoise(art);

  let cardType = "UNKNOWN";
  try {
    const raw = (art as HTMLElement).dataset.hydroView;
    if (raw) {
      const parsed = JSON.parse(raw) as { payload?: { feed_card?: { card_type?: string } } };
      cardType = parsed?.payload?.feed_card?.card_type ?? "UNKNOWN";
    }
  } catch {
    // ignore
  }

  const header = art.querySelector("header");
  const headline = header ? cleanText(headerWithoutTime(header)) : cleanText(art.textContent || "");
  if (!headline) return null;

  const avatarImg = art.querySelector<HTMLImageElement>("header img");
  const actor = parseActor(art, avatarImg);

  // prefer the header time (the event's own timestamp). a fallback to any
  // time in the article catches quieter card types whose header omits one,
  // but without the fallback being first, a body excerpt's embedded time
  // can shadow the event time and make a 2-minute-old event read as "1
  // week ago".
  const time = art.querySelector("header relative-time, header time-ago, header time")
    ?? art.querySelector("relative-time, time-ago, time");
  const occurredAt = time?.getAttribute("datetime") ?? null;

  const titleLink = findPrimaryTitleLink(art, actor?.login || null);
  const bodyExcerpt = findBodyExcerpt(art);

  const repoCards = isRepoListCard(cardType) ? parseRepoCards(art) : [];

  return {
    cardType,
    actor,
    headline,
    bodyTextLink: titleLink,
    bodyExcerpt,
    occurredAt,
    repoCards,
  };
}

function stripNoise(art: Element): void {
  const selectors = [
    "action-menu",
    "anchored-position",
    ".Overlay",
    "focus-group",
    "dialog",
    "tool-tip",
    "[hidden]",
    "script",
    "style",
    "button.Button--invisible",
  ];
  for (const sel of selectors) {
    art.querySelectorAll(sel).forEach((n) => n.remove());
  }
  for (const node of Array.from(art.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  }
}

function headerWithoutTime(header: Element): string {
  const clone = header.cloneNode(true) as Element;
  clone.querySelectorAll("relative-time, time-ago, time").forEach((n) => n.remove());
  return clone.textContent || "";
}

function parseActor(art: Element, avatarImg: HTMLImageElement | null): FeedActor | null {
  const link = art.querySelector<HTMLAnchorElement>("header a[href^='/']");
  const href = link?.getAttribute("href") || "";
  const login = href.startsWith("/") ? href.slice(1).split("/")[0] || "" : "";
  if (!login) return null;
  return { login, avatarUrl: avatarImg?.getAttribute("src") || null };
}

function findPrimaryTitleLink(art: Element, actorLogin: string | null): { text: string; href: string } | null {
  // first preference: an h1/h2/h3 anchor pointing at a specific thing — PR,
  // issue, commit, release. these are unambiguous title links.
  const direct = art.querySelector<HTMLAnchorElement>(
    "h3 a[href*='/pull/'], h3 a[href*='/issues/'], h3 a[href*='/commit/'], h3 a[href*='/releases/'], h1 a, h2 a",
  );
  if (direct) {
    const href = direct.getAttribute("href") || "";
    const text = cleanText(direct.textContent || "");
    if (text && href) return { text, href };
  }
  // fallback: pick the first anchor whose href looks like /:owner/:repo
  // (exactly two non-empty segments, no further path). this catches FORK,
  // CREATED_REPO, STAR, FOLLOW-target-repo, etc. — events whose title link is
  // the target repository itself.
  for (const a of Array.from(art.querySelectorAll<HTMLAnchorElement>("h3 a[href^='/'], h2 a[href^='/'], a.Link--primary[href^='/']"))) {
    const href = a.getAttribute("href") || "";
    const segs = href.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
    if (segs.length !== 2) continue;
    const text = cleanText(a.textContent || "");
    if (!text || !href) continue;
    // skip when the link text is just the actor name (some templates put a
    // bare actor mention in the body).
    if (actorLogin && text.toLowerCase() === actorLogin.toLowerCase()) continue;
    return { text, href };
  }
  // final fallback: any Link--primary anchor, even if not a repo nwo
  const fallback = art.querySelector<HTMLAnchorElement>("a.Link--primary");
  if (fallback) {
    const href = fallback.getAttribute("href") || "";
    const text = cleanText(fallback.textContent || "");
    if (text && href && !(actorLogin && text.toLowerCase() === actorLogin.toLowerCase())) {
      return { text, href };
    }
  }
  return null;
}

function findBodyExcerpt(art: Element): string | null {
  const md = art.querySelector(".markdown-body, .comment-body, .lazy-load-prerender-text");
  if (md) {
    const txt = cleanText(md.textContent || "");
    if (txt) return txt.slice(0, 280);
  }
  return null;
}

function isRepoListCard(cardType: string): boolean {
  return (
    cardType === "TRENDING_REPOSITORY" ||
    cardType === "REPOSITORY_RECOMMENDATION" ||
    cardType === "RECOMMENDED_REPOSITORY"
  );
}

function parseRepoCards(art: Element): FeedRepoCard[] {
  const cards: FeedRepoCard[] = [];
  const seen = new Set<string>();
  const links = Array.from(art.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const m = href.match(/^\/([\w.-]+)\/([\w.-]+)(?:[/?#].*)?$/);
    if (!m) continue;
    const slug = `${m[1]}/${m[2]}`;
    if (seen.has(slug)) continue;
    const text = cleanText(link.textContent || "");
    if (text !== slug && !text.endsWith("/" + m[2])) continue;
    seen.add(slug);
    const container = link.closest("article, div") || art;
    const description = pickDescription(container);
    const language = pickLanguage(container);
    const starCount = pickStars(container);
    cards.push({
      slug,
      href: `/${slug}`,
      description,
      language,
      starCount,
      forkCount: null,
      ownerAvatarUrl: null,
    });
    if (cards.length >= 6) break;
  }
  return cards;
}

function pickDescription(container: Element): string | null {
  const sel = container.querySelector("p, .text-small");
  const txt = cleanText(sel?.textContent || "");
  return txt ? txt.slice(0, 200) : null;
}

function pickLanguage(container: Element): string | null {
  // Walk up looking for an [itemprop]. Cards routinely have the avatar and
  // title BOTH link to /owner/repo, so dedupe by normalized URL — what we
  // want to detect is multiple *distinct* repos in scope (a sign we've
  // walked past the per-card boundary).
  let scope: Element | null = container;
  for (let i = 0; i < 8 && scope; i++) {
    const itemProp = scope.querySelector("[itemprop='programmingLanguage']");
    const dot = !itemProp ? scope.querySelector('span[style*="background-color"]') : null;
    if (itemProp || dot) {
      const distinctRepos = new Set<string>();
      for (const a of Array.from(scope.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") || "";
        // normalize to just /owner/repo so trailing /stargazers, /forks
        // etc. don't count as different repos
        const m = href.match(/^(\/[\w.-]+\/[\w.-]+)(?:[/?#]|$)/);
        if (m) {
          distinctRepos.add(m[1]!);
          if (distinctRepos.size > 1) break;
        }
      }
      if (distinctRepos.size > 1) return null;
      if (itemProp) {
        const txt = cleanText(itemProp.textContent || "");
        if (txt) return txt;
      }
      if (dot && dot.nextElementSibling) {
        const txt = cleanText(dot.nextElementSibling.textContent || "");
        if (txt) return txt;
      }
    }
    scope = scope.parentElement;
  }
  return null;
}

function pickStars(container: Element): string | null {
  const m = (container.textContent || "").match(/(\d[\d.,kKmM]*)\s*star/i);
  return m ? m[1]! : null;
}

function parseTopRepos(html: string): TopRepo[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll("li"));
  const out: TopRepo[] = [];
  for (const li of items) {
    const a = li.querySelector<HTMLAnchorElement>("a[href]");
    if (!a) continue;
    const href = a.getAttribute("href") || "";
    const m = href.match(/^\/([\w.-]+)\/([\w.-]+)$/);
    if (!m) continue;
    const slug = `${m[1]}/${m[2]}`;
    const img = li.querySelector<HTMLImageElement>("img");
    out.push({
      slug,
      href,
      avatarUrl: img?.getAttribute("src") || null,
    });
  }
  return out;
}

function parseChangelog(html: string): ChangelogItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const out: ChangelogItem[] = [];
  const seen = new Set<string>();
  for (const a of links) {
    const href = a.getAttribute("href") || "";
    if (!/changelog|github\.blog|github\.com/.test(href)) continue;
    if (href.endsWith("/changelog") || href.endsWith("/changelog/")) continue;
    const title = cleanText(a.textContent || "");
    if (!title || title.length < 8) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const wrapper = a.closest("li, div, article") || a;
    const t = wrapper.querySelector("relative-time, time");
    const date = t?.getAttribute("datetime") || null;
    out.push({ title, href, date });
    if (out.length >= 6) break;
  }
  return out;
}

function readViewerLogin(): string | null {
  const meta = document.querySelector<HTMLMetaElement>("meta[name='user-login']");
  const v = meta?.getAttribute("content");
  return v ? v.trim() : null;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
