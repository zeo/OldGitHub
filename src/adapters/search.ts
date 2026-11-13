import { AdapterFailure } from "./index";
import { loadPagePayload, parseRepoPage } from "./_page";
import { fetchApi } from "./rate-limit";
import { sanitizeTree } from "@/util/html";

export type SearchType =
  | "repositories"
  | "issues"
  | "pullrequests"
  | "users"
  | "code"
  | "commits"
  | "topics";

export type SearchSort =
  | "best-match"
  | "stars"
  | "forks"
  | "updated"
  | "created"
  | "interactions"
  | "reactions"
  | "comments";

export type SearchOrder = "asc" | "desc";

export type RepoResult = {
  fullName: string;
  ownerLogin: string;
  ownerAvatar: string;
  repoName: string;
  description: string | null;
  language: string | null;
  stargazers: number;
  forks: number | null;
  isFork: boolean;
  isPrivate: boolean;
  isArchived: boolean;
  htmlUrl: string;
  updatedAt: string;
  license: string | null;
  topics: string[];
};

export type IssueResult = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: { login: string; avatarUrl: string } | null;
  repoFullName: string;
  htmlUrl: string;
  commentCount: number;
  labels: Array<{ name: string; color: string | null }>;
  isPull: boolean;
  draft: boolean;
  merged: boolean;
  createdAt: string;
};

export type UserResult = {
  login: string;
  type: "User" | "Organization" | null;
  name: string | null;
  location: string | null;
  followers: number | null;
  repos: number | null;
  avatarUrl: string;
  htmlUrl: string;
};

export type CommitResult = {
  sha: string;
  abbrevSha: string;
  messageHeadline: string;
  repoFullName: string;
  htmlUrl: string;
  authorLogin: string | null;
  authorAvatarUrl: string;
  date: string;
};

export type TopicResult = {
  name: string;
  displayName: string | null;
  shortDescription: string | null;
  htmlUrl: string;
  featured: boolean;
};

export type SearchSummary = {
  query: string;
  type: SearchType;
  totalCount: number;
  incompleteResults: boolean;
  page: number;
  pageCount: number;
};

const API = "https://api.github.com";

type Found<T> = { summary: SearchSummary; items: T[] };

export function searchRepositories(query: string, sort: string, order: SearchOrder, page: number): Promise<Found<RepoResult>> {
  return fromPage("repositories", query, sort, order, page, pageRepoResult, async () => {
    const data = await rawSearch("repositories", query, sort, order);
    return summaryAnd(query, "repositories", data, readArray(data["items"]).map(parseRepoResult).filter((r): r is RepoResult => r !== null));
  });
}

export function searchIssues(query: string, sort: string, order: SearchOrder, pullOnly: boolean, page: number): Promise<Found<IssueResult>> {
  const type = pullOnly ? "pullrequests" : "issues";
  return fromPage(type, query, sort, order, page, pageIssueResult, async () => {
    const data = await rawSearch("issues", `${query} ${pullOnly ? "type:pr" : "type:issue"}`, sort, order);
    return summaryAnd(query, type, data, readArray(data["items"]).map(parseIssueResult).filter((r): r is IssueResult => r !== null));
  });
}

export function searchUsers(query: string, sort: string, order: SearchOrder, page: number): Promise<Found<UserResult>> {
  return fromPage("users", query, sort, order, page, pageUserResult, async () => {
    const data = await rawSearch("users", query, sort, order);
    return summaryAnd(query, "users", data, readArray(data["items"]).map(parseUserResult).filter((r): r is UserResult => r !== null));
  });
}

// github's search page embeds the results it renders, so only a page without them spends api quota
async function fromPage<T>(
  type: SearchType,
  query: string,
  sort: string,
  order: SearchOrder,
  page: number,
  parse: (raw: unknown) => T | null,
  viaApi: () => Promise<Found<T>>,
): Promise<Found<T>> {
  const params = new URLSearchParams({ q: query.trim(), type });
  if (sort && sort !== "best-match") {
    params.set("s", sort);
    params.set("o", order);
  }
  if (page > 1) params.set("p", String(page));
  let route: Record<string, unknown> | null;
  try {
    route = readObj(readObj(readObj(await loadPagePayload(`https://github.com/search?${params}`))?.["payload"])?.["blackbirdSearchRoute"]);
  } catch (err) {
    if (!(err instanceof AdapterFailure)) throw err;
    route = null;
  }
  if (!route || !Array.isArray(route["results"])) return viaApi();
  const items = readArray(route["results"]).map(parse).filter((r): r is T => r !== null);
  return {
    summary: {
      query,
      type,
      totalCount: readNumber(route, "result_count") ?? items.length,
      incompleteResults: route["warn_limited_results"] === true,
      page: readNumber(route, "page") ?? page,
      pageCount: readNumber(route, "page_count") ?? 1,
    },
    items,
  };
}

function pageRepoOf(r: Record<string, unknown>, key: string): { owner: string; name: string; full: string; updatedAt: string } | null {
  const repo = readObj(readObj(r[key])?.["repository"]);
  const owner = repo && readString(repo, "owner_login");
  const name = repo && readString(repo, "name");
  return repo && owner && name ? { owner, name, full: `${owner}/${name}`, updatedAt: readString(repo, "updated_at") ?? "" } : null;
}

// highlighted fields wrap matches in <em> and escape entities
function plainText(html: string | null): string | null {
  return html ? new DOMParser().parseFromString(html, "text/html").body.textContent : null;
}

function pageRepoResult(raw: unknown): RepoResult | null {
  const r = readObj(raw);
  const repo = r && pageRepoOf(r, "repo");
  if (!r || !repo) return null;
  return {
    fullName: repo.full,
    ownerLogin: repo.owner,
    ownerAvatar: `https://github.com/${repo.owner}.png?size=40`,
    repoName: repo.name,
    description: plainText(readString(r, "hl_trunc_description")),
    language: readString(r, "language"),
    // the search index calls a repository's stargazers its followers
    stargazers: readNumber(r, "followers") ?? 0,
    forks: null,
    isFork: false,
    isPrivate: r["public"] === false,
    isArchived: r["archived"] === true,
    htmlUrl: `https://github.com/${repo.full}`,
    updatedAt: repo.updatedAt,
    license: null,
    topics: readArray(r["topics"]).filter((t): t is string => typeof t === "string"),
  };
}

function pageIssueResult(raw: unknown): IssueResult | null {
  const r = readObj(raw);
  const repo = r && pageRepoOf(r, "repo");
  const number = r && readNumber(r, "number");
  if (!r || !repo || number == null) return null;
  const isPull = readNumber(readObj(readObj(r["issue"])?.["issue"]) ?? {}, "pull_request_id") != null;
  const state = readString(r, "state");
  const author = readString(r, "author_name");
  return {
    number,
    title: plainText(readString(r, "hl_title")) ?? "",
    state: state === "closed" || state === "merged" ? "closed" : "open",
    user: author ? { login: author, avatarUrl: readString(r, "author_avatar_url") ?? "" } : null,
    repoFullName: repo.full,
    htmlUrl: `https://github.com/${repo.full}/${isPull ? "pull" : "issues"}/${number}`,
    commentCount: readNumber(r, "num_comments") ?? 0,
    labels: readArray(r["labels"]).filter((l): l is string => typeof l === "string").map((name) => ({ name, color: null })),
    isPull,
    draft: state === "draft",
    merged: r["merged"] === true,
    createdAt: readString(r, "created") ?? "",
  };
}

function pageUserResult(raw: unknown): UserResult | null {
  const r = readObj(raw);
  const login = r && readString(r, "login");
  if (!r || !login) return null;
  return {
    login,
    type: null,
    name: readString(r, "name"),
    location: readString(r, "location"),
    followers: readNumber(r, "followers"),
    repos: readNumber(r, "repos"),
    avatarUrl: readString(r, "avatar_url") ?? `https://github.com/${login}.png?size=96`,
    htmlUrl: `https://github.com/${login}`,
  };
}

function pageCommitResult(raw: unknown): CommitResult | null {
  const r = readObj(raw);
  const sha = r && readString(r, "sha");
  const repo = r && pageRepoOf(r, "repository");
  if (!r || !sha || !repo) return null;
  const author = readObj(readArray(r["authors"])[0]);
  return {
    sha,
    abbrevSha: sha.slice(0, 7),
    messageHeadline: (readString(r, "message") ?? "").split("\n")[0] ?? "",
    repoFullName: repo.full,
    htmlUrl: `https://github.com/${repo.full}/commit/${sha}`,
    authorLogin: author && readString(author, "login"),
    authorAvatarUrl: (author && readString(author, "avatar_url")) ?? "",
    date: readString(r, "author_date") ?? "",
  };
}

function pageTopicResult(raw: unknown): TopicResult | null {
  const r = readObj(raw);
  const name = r && readString(r, "name");
  if (!r || !name) return null;
  return {
    name,
    displayName: readString(r, "display_name"),
    shortDescription: readString(r, "short_description"),
    htmlUrl: `https://github.com/topics/${name}`,
    featured: r["featured"] === true,
  };
}

export async function searchCodePage(query: string, sort: string, order: SearchOrder, page: number): Promise<{ summary: SearchSummary; html: string }> {
  const params = new URLSearchParams({ q: query.trim(), type: "code" });
  if (sort && sort !== "best-match") params.set("s", sort);
  if (order) params.set("o", order);
  if (page > 1) params.set("p", String(page));
  const resp = await fetch(`https://github.com/search?${params.toString()}`, {
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  if (!resp.ok) {
    throw new AdapterFailure("search", `/search?type=code responded ${resp.status}`);
  }

  const doc = parseRepoPage(await resp.text());
  const app = doc.querySelector<HTMLElement>('react-app[app-name="blackbird-search"]');
  if (!app) {
    throw new AdapterFailure("search", "code search app was missing");
  }

  let totalCount = 0;
  let pageCount = 1;
  const embedded = app.querySelector<HTMLScriptElement>('script[data-target="react-app.embeddedData"]')?.textContent;
  if (embedded) {
    try {
      type Route = { logged_in?: boolean; result_count?: number; page_count?: number };
      const data = JSON.parse(embedded) as { payload?: Route & { blackbirdSearchRoute?: Route } };
      const route = data.payload?.blackbirdSearchRoute ?? data.payload;
      if (route?.logged_in === false) {
        throw new AdapterFailure("search", "code search did not receive the signed-in GitHub session");
      }
      if (typeof route?.result_count === "number") totalCount = route.result_count;
      if (typeof route?.page_count === "number") pageCount = route.page_count;
    } catch (err) {
      if (err instanceof AdapterFailure) throw err;
    }
  }

  const results = app.querySelector<HTMLElement>('[data-hpc="true"], [class*="dataResults"]');
  if (!results) {
    throw new AdapterFailure("search", "code search results were missing");
  }
  const clone = results.cloneNode(true) as HTMLElement;
  sanitizeTree(clone);

  return {
    summary: {
      query,
      type: "code",
      totalCount,
      incompleteResults: false,
      page,
      pageCount,
    },
    html: clone.innerHTML,
  };
}

export function searchCommits(query: string, sort: string, order: SearchOrder, page: number): Promise<Found<CommitResult>> {
  return fromPage("commits", query, sort, order, page, pageCommitResult, async () => {
    const data = await rawSearch("commits", query, sort, order, "application/vnd.github.cloak-preview+json");
    return summaryAnd(query, "commits", data, readArray(data["items"]).map(parseCommitResult).filter((r): r is CommitResult => r !== null));
  });
}

export function searchTopics(query: string, page: number): Promise<Found<TopicResult>> {
  return fromPage("topics", query, "best-match", "desc", page, pageTopicResult, async () => {
    const data = await rawSearch("topics", query, "best-match", "desc", "application/vnd.github.mercy-preview+json");
    return summaryAnd(query, "topics", data, readArray(data["items"]).map(parseTopicResult).filter((r): r is TopicResult => r !== null));
  });
}

async function rawSearch(
  segment: "repositories" | "issues" | "users" | "commits" | "topics",
  query: string,
  sort: string,
  order: SearchOrder,
  accept = "application/vnd.github+json",
): Promise<Record<string, unknown>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { items: [], total_count: 0, incomplete_results: false };
  }
  const params = new URLSearchParams({ q: trimmed, per_page: "30" });
  if (sort && sort !== "best-match") params.set("sort", sort);
  if (order) params.set("order", order);
  const resp = await fetchApi(`${API}/search/${segment}?${params.toString()}`, {
    credentials: "omit",
    headers: { Accept: accept },
  });
  if (!resp.ok) {
    if (resp.status === 403 || resp.status === 429) {
      throw new AdapterFailure("search", `rate-limited (search/${segment} responded ${resp.status})`);
    }
    throw new AdapterFailure("search", `/search/${segment} responded ${resp.status}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

function summaryAnd<T>(query: string, type: SearchType, data: Record<string, unknown>, items: T[]): { summary: SearchSummary; items: T[] } {
  return {
    summary: {
      query,
      type,
      totalCount: typeof data["total_count"] === "number" ? (data["total_count"] as number) : items.length,
      incompleteResults: data["incomplete_results"] === true,
      page: 1,
      pageCount: 1,
    },
    items,
  };
}

function parseRepoResult(raw: unknown): RepoResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fullName = readString(r, "full_name");
  if (!fullName) return null;
  const owner = readObj(r["owner"]);
  const license = readObj(r["license"]);
  return {
    fullName,
    ownerLogin: (owner && readString(owner, "login")) ?? fullName.split("/")[0] ?? "",
    ownerAvatar: (owner && readString(owner, "avatar_url")) ?? "",
    repoName: readString(r, "name") ?? fullName.split("/")[1] ?? "",
    description: readString(r, "description"),
    language: readString(r, "language"),
    stargazers: readNumber(r, "stargazers_count") ?? 0,
    forks: readNumber(r, "forks_count") ?? 0,
    isFork: r["fork"] === true,
    isPrivate: r["private"] === true,
    isArchived: r["archived"] === true,
    htmlUrl: readString(r, "html_url") ?? `https://github.com/${fullName}`,
    updatedAt: readString(r, "updated_at") ?? "",
    license: license ? readString(license, "spdx_id") ?? readString(license, "name") : null,
    topics: readArray(r["topics"]).filter((t): t is string => typeof t === "string"),
  };
}

function parseIssueResult(raw: unknown): IssueResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = readString(r, "title");
  const num = readNumber(r, "number");
  if (!title || num == null) return null;
  const user = readObj(r["user"]);
  const pull = readObj(r["pull_request"]);
  const htmlUrl = readString(r, "html_url") ?? "";
  const repoFullName = htmlUrl.replace("https://github.com/", "").replace(/\/(issues|pull)\/\d+.*/, "");
  return {
    number: num,
    title,
    state: readString(r, "state") === "closed" ? "closed" : "open",
    user: user ? { login: readString(user, "login") ?? "", avatarUrl: readString(user, "avatar_url") ?? "" } : null,
    repoFullName,
    htmlUrl,
    commentCount: readNumber(r, "comments") ?? 0,
    labels: readArray(r["labels"])
      .map((l) => {
        if (!l || typeof l !== "object") return null;
        const o = l as Record<string, unknown>;
        const n = readString(o, "name");
        if (!n) return null;
        return { name: n, color: readString(o, "color") ?? "ccc" };
      })
      .filter((x): x is { name: string; color: string } => x !== null),
    isPull: !!pull,
    draft: r["draft"] === true,
    merged: pull ? readString(pull, "merged_at") !== null : false,
    createdAt: readString(r, "created_at") ?? "",
  };
}

function parseUserResult(raw: unknown): UserResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const login = readString(r, "login");
  if (!login) return null;
  const type = readString(r, "type") === "Organization" ? "Organization" : "User";
  return {
    login,
    type,
    name: null,
    location: null,
    followers: null,
    repos: null,
    avatarUrl: readString(r, "avatar_url") ?? `https://github.com/${login}.png?size=96`,
    htmlUrl: readString(r, "html_url") ?? `https://github.com/${login}`,
  };
}

function parseCommitResult(raw: unknown): CommitResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sha = readString(r, "sha");
  if (!sha) return null;
  const commit = readObj(r["commit"]);
  const author = commit ? readObj(commit["author"]) : null;
  const ghAuthor = readObj(r["author"]);
  const repo = readObj(r["repository"]);
  const message = (commit && readString(commit, "message")) ?? "";
  return {
    sha,
    abbrevSha: sha.slice(0, 7),
    messageHeadline: message.split("\n")[0] ?? "",
    repoFullName: (repo && readString(repo, "full_name")) ?? "",
    htmlUrl: readString(r, "html_url") ?? "",
    authorLogin: ghAuthor ? readString(ghAuthor, "login") : null,
    authorAvatarUrl: (ghAuthor && readString(ghAuthor, "avatar_url")) ?? "",
    date: (author && readString(author, "date")) ?? "",
  };
}

function parseTopicResult(raw: unknown): TopicResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = readString(r, "name");
  if (!name) return null;
  return {
    name,
    displayName: readString(r, "display_name"),
    shortDescription: readString(r, "short_description") ?? readString(r, "description"),
    htmlUrl: `https://github.com/topics/${name}`,
    featured: r["featured"] === true,
  };
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}
function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}
