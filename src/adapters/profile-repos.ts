import { AdapterFailure } from "./index";
import { fetchPageDoc } from "./_page";

export type RepoListItem = {
  name: string;
  href: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: string | null;
  forks: string | null;
  updatedIso: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isMirror: boolean;
  isTemplate: boolean;
};

export type ProfileReposView = {
  login: string;
  totalLabel: string | null;
  items: RepoListItem[];
  pagination: {
    prevHref: string | null;
    nextHref: string | null;
  };
};

export async function getProfileRepos(login: string, query: string): Promise<ProfileReposView> {
  const url = `https://github.com/${login}?${ensureRepositoriesTab(query)}`;
  const doc = await fetchPageDoc(url);

  // user profile uses #user-repositories-list, org profile uses #org-repositories
  const list = doc.querySelector<HTMLElement>("#user-repositories-list, #org-repositories");
  if (!list) {
    throw new AdapterFailure("getProfileRepos", "missing repositories container");
  }

  const items: RepoListItem[] = [];
  for (const li of Array.from(list.querySelectorAll<HTMLElement>("li"))) {
    const parsed = parseRow(li);
    if (parsed) items.push(parsed);
  }

  const totalLabel = doc.querySelector(".filter-list a.selected .Counter, [data-tab-item] .Counter")?.textContent?.trim() || null;
  const prevHref = doc.querySelector<HTMLAnchorElement>('.paginate-container a.previous_page')?.getAttribute("href") || null;
  const nextHref = doc.querySelector<HTMLAnchorElement>('.paginate-container a.next_page')?.getAttribute("href") || null;

  return {
    login,
    totalLabel,
    items,
    pagination: { prevHref, nextHref },
  };
}

function ensureRepositoriesTab(query: string): string {
  const params = new URLSearchParams(query);
  params.set("tab", "repositories");
  return params.toString();
}

function parseRow(li: HTMLElement): RepoListItem | null {
  // user repos use <h3><a itemprop="name codeRepository">; org repos use
  // <a class="Link f4 d-inline-block text-bold"> as the title link.
  const anchor =
    li.querySelector<HTMLAnchorElement>('h3 a[itemprop="name codeRepository"], h3 a[href]') ||
    li.querySelector<HTMLAnchorElement>('a.Link.text-bold[href^="/"], a.f4.text-bold[href^="/"]');
  if (!anchor) return null;
  const href = anchor.getAttribute("href") || "";
  const name = anchor.textContent?.trim() || "";
  if (!name || !href) return null;

  const descEl =
    li.querySelector<HTMLElement>('p[itemprop="description"]') ||
    li.querySelector<HTMLElement>('p.tmp-mb-3.color-fg-muted, p.color-fg-muted.wb-break-word');
  const descText = descEl?.textContent?.trim() || "";
  const description = descText && !/There was an error/i.test(descText) ? descText : null;
  const language =
    li.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() ||
    li.querySelector('span[aria-label*="language" i], [data-ga-click*="language"]')?.textContent?.trim() ||
    null;
  const langSwatch = li.querySelector<HTMLElement>('.repo-language-color');
  const languageColor = readBackgroundColor(langSwatch);

  const stars = readCountLink(li, "/stargazers");
  const forks = readCountLink(li, "/forks") || readCountLink(li, "/network/members");

  const updatedIso = li.querySelector("relative-time")?.getAttribute("datetime") || null;

  return {
    name,
    href,
    description,
    language,
    languageColor,
    stars,
    forks,
    updatedIso,
    isPrivate: li.classList.contains("private"),
    isFork: li.classList.contains("fork"),
    isMirror: li.classList.contains("mirror"),
    isTemplate: li.classList.contains("template"),
  };
}

function readCountLink(li: HTMLElement, hrefFragment: string): string | null {
  const a = li.querySelector<HTMLAnchorElement>(`a[href*="${hrefFragment}"]`);
  if (!a) return null;
  const text = a.textContent?.trim();
  if (!text) return null;
  const match = /([\d.,kKmM]+)/.exec(text);
  return match?.[1] ?? null;
}

function readBackgroundColor(el: HTMLElement | null): string | null {
  if (!el) return null;
  const inline = el.getAttribute("style") || "";
  const m = /background(?:-color)?\s*:\s*([^;]+)/i.exec(inline);
  return m && m[1] ? m[1].trim() : null;
}
