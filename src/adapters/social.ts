import { AdapterFailure } from "./index";
import { fetchRepoPage, forgetRepoPage, parseRepoPage } from "./_page";

export type WatchMode = "participating" | "watching" | "ignoring";

export type RepoSocial = {
  starred: boolean;
  canStar: boolean;
  watch: WatchMode;
  canWatch: boolean;
  repositoryId: string;
  nonce: string;
};

export type FollowForms = {
  following: boolean;
  follow: { action: string; token: string };
  unfollow: { action: string; token: string };
};

const SUBSCRIBE_DO: Record<WatchMode, string> = {
  participating: "included",
  watching: "subscribed",
  ignoring: "ignore",
};

// star and watch state lives in the repo page's react payload; the keys are found by name so payload reshuffles don't matter
export async function getRepoSocial(owner: string, repo: string): Promise<RepoSocial | null> {
  const doc = parseRepoPage(await fetchRepoPage(owner, repo));
  const nonce = doc.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content;
  if (!nonce) return null;
  let star: Record<string, unknown> | null = null;
  let watch: Record<string, unknown> | null = null;
  for (const script of Array.from(doc.querySelectorAll('script[type="application/json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || "");
    } catch {
      continue;
    }
    star ??= findObject(data, (o) => typeof o["viewerHasStarred"] === "boolean");
    watch ??= findObject(data, (o) => "watchData" in o);
    if (star && watch) break;
  }
  const watchData = watch?.["watchData"] as Record<string, unknown> | undefined;
  const repositoryId = watchData?.["repositoryId"];
  if (!star || !watchData || (typeof repositoryId !== "string" && typeof repositoryId !== "number")) return null;
  const type = String(watchData["subscriptionType"] ?? "none");
  return {
    starred: star["viewerHasStarred"] === true,
    canStar: star["canStar"] !== false,
    watch: type === "none" ? "participating" : /ignor/i.test(type) ? "ignoring" : "watching",
    canWatch: watch?.["canWatch"] !== false,
    repositoryId: String(repositoryId),
    nonce,
  };
}

export async function setStarred(owner: string, repo: string, starred: boolean, nonce: string): Promise<void> {
  await verifiedPost(`/${owner}/${repo}/${starred ? "star" : "unstar"}`, nonce);
  forgetRepoPage(owner, repo);
}

export async function setWatchMode(owner: string, repo: string, social: RepoSocial, mode: WatchMode): Promise<void> {
  const body = new FormData();
  body.append("do", SUBSCRIBE_DO[mode]);
  body.append("thread_types[]", "");
  body.append("repository_id", social.repositoryId);
  await verifiedPost("/notifications/subscribe", social.nonce, body);
  forgetRepoPage(owner, repo);
}

export function readFollowForms(doc: Document): FollowForms | null {
  const read = (verb: "follow" | "unfollow") => {
    const form = doc.querySelector<HTMLFormElement>(`form[action^="/users/${verb}?"]`);
    const token = form?.querySelector<HTMLInputElement>('input[name="authenticity_token"]')?.value;
    const action = form?.getAttribute("action");
    return form && token && action ? { form, action, token } : null;
  };
  const follow = read("follow");
  const unfollow = read("unfollow");
  if (!follow || !unfollow) return null;
  return {
    following: follow.form.hidden && !unfollow.form.hidden,
    follow: { action: follow.action, token: follow.token },
    unfollow: { action: unfollow.action, token: unfollow.token },
  };
}

export async function setFollowing(forms: FollowForms, following: boolean): Promise<void> {
  const form = following ? forms.follow : forms.unfollow;
  const url = new URL(form.action, "https://github.com");
  // the action comes from scraped markup; the csrf token must never leave github
  if (url.origin !== "https://github.com") throw new AdapterFailure("setFollowing", `refusing to post to ${form.action}`);
  const resp = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body: new URLSearchParams({ authenticity_token: form.token, commit: following ? "Follow" : "Unfollow" }),
  });
  if (!resp.ok) throw new AdapterFailure("setFollowing", `${url.pathname} responded ${resp.status}`);
}

// mirrors the headers github's own react code sends for these endpoints
async function verifiedPost(path: string, nonce: string, body: FormData | null = null): Promise<void> {
  const resp = await fetch(`https://github.com${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "GitHub-Verified-Fetch": "true", "X-Requested-With": "XMLHttpRequest", "X-Fetch-Nonce": nonce },
    body,
  });
  if (!resp.ok) throw new AdapterFailure("verifiedPost", `${path} responded ${resp.status}`);
}

function findObject(node: unknown, match: (o: Record<string, unknown>) => boolean, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 12) return null;
  if (!Array.isArray(node) && match(node as Record<string, unknown>)) return node as Record<string, unknown>;
  for (const value of Object.values(node)) {
    const found = findObject(value, match, depth + 1);
    if (found) return found;
  }
  return null;
}
