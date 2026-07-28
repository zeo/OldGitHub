import { octicon } from "@/icons";
import { getRepoOverview, type RepoOverview } from "@/adapters/repo-overview";
import { getRepoLanguages } from "@/adapters/repo";
import { fetchApi } from "@/adapters/rate-limit";
import { languageColor, canonicalLanguageName } from "@/util/language-color";
import { absoluteTime, relativeTime } from "@/util/time";
import { hydrateTreeTable, renderTreeTable } from "./_tree-table";
import { adoptBodyRoot, removeAllBodyRoots } from "./_body";

const ROOT_CLASS = "oldgh-repo-home";

export async function mountRepoHome(owner: string, repo: string): Promise<void> {
  const overview = await getRepoOverview(owner, repo);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = overview.isEmpty ? renderEmptyShell(overview) : renderShell(overview);
  adoptBodyRoot(root, ".oldgh-repo-header");

  bindCloneTabs(root);
  bindCopyButtons(root);

  // an empty repo has no tree/commits/languages to hydrate — the quick-setup
  // panel is fully rendered up front.
  if (overview.isEmpty) return;

  bindBranchPicker(root, { owner, repo, branch: overview.branch });

  void hydrateTreeTable(root, {
    owner,
    repo,
    branch: overview.branch,
    basePath: "",
  });

  void hydrateLanguagesBar(root, owner, repo);
  void hydrateLatestCommit(root, { owner, repo, branch: overview.branch });
  void hydrateRepoNumbers(root, owner, repo);
  void hydrateLatestRelease(root, owner, repo);
}

type ReleaseAsset = { name: string; url: string; size: number };
type LatestRelease = {
  tag: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  isPrerelease: boolean;
  assets: ReleaseAsset[];
  zipUrl: string;
};

// surface the latest release on the repo home with a direct download — without
// the extension a user can grab a new build from the repo home's release
// shortcut; we restore that. fetched from the REST releases/latest endpoint;
// the slot stays empty (no layout shift) when a repo has no releases.
async function hydrateLatestRelease(root: HTMLElement, owner: string, repo: string): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-repo-home__release-slot");
  if (!slot) return;
  try {
    const res = await fetchApi(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const data = parseLatestRelease(await res.json());
    if (!data) return;
    slot.innerHTML = renderLatestRelease(owner, repo, data);
  } catch (err) {
    console.debug("[oldgh] latest release fetch failed:", err);
  }
}

function parseLatestRelease(raw: unknown): LatestRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tag = typeof r["tag_name"] === "string" ? (r["tag_name"] as string) : "";
  if (!tag) return null;
  const assetsRaw = Array.isArray(r["assets"]) ? (r["assets"] as unknown[]) : [];
  const assets: ReleaseAsset[] = [];
  for (const a of assetsRaw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const url = typeof o["browser_download_url"] === "string" ? (o["browser_download_url"] as string) : "";
    const name = typeof o["name"] === "string" ? (o["name"] as string) : "";
    if (url && name) assets.push({ name, url, size: typeof o["size"] === "number" ? (o["size"] as number) : 0 });
  }
  return {
    tag,
    name: typeof r["name"] === "string" && r["name"] ? (r["name"] as string) : tag,
    publishedAt: typeof r["published_at"] === "string" ? (r["published_at"] as string) : "",
    htmlUrl: typeof r["html_url"] === "string" ? (r["html_url"] as string) : "",
    isPrerelease: r["prerelease"] === true,
    assets,
    zipUrl: typeof r["zipball_url"] === "string" ? (r["zipball_url"] as string) : "",
  };
}

function renderLatestRelease(owner: string, repo: string, rel: LatestRelease): string {
  const releaseHref = `/${owner}/${repo}/releases/tag/${encodeURIComponent(rel.tag)}`;
  const time = rel.publishedAt
    ? `<time class="oldgh-release-callout__time" datetime="${escapeAttr(rel.publishedAt)}" title="${escapeAttr(absoluteTime(rel.publishedAt))}">${escapeText(relativeTime(rel.publishedAt))}</time>`
    : "";
  // one binary asset → download it directly; several → go to the release page
  // where our releases view lists them all; none → offer the source zip.
  let download: string;
  if (rel.assets.length === 1) {
    const a = rel.assets[0]!;
    download = `<a class="oldgh-btn oldgh-btn--primary oldgh-release-callout__dl" href="${escapeAttr(a.url)}" download>${octicon("cloud-download", { size: 14 })}<span>Download</span></a>`;
  } else if (rel.assets.length > 1) {
    download = `<a class="oldgh-btn oldgh-btn--primary oldgh-release-callout__dl" href="${escapeAttr(releaseHref)}">${octicon("cloud-download", { size: 14 })}<span>Download (${rel.assets.length})</span></a>`;
  } else {
    download = `<a class="oldgh-btn oldgh-release-callout__dl" href="${escapeAttr(rel.zipUrl || releaseHref)}"${rel.zipUrl ? " download" : ""}>${octicon("cloud-download", { size: 14 })}<span>Source zip</span></a>`;
  }
  const pre = rel.isPrerelease ? `<span class="oldgh-release-callout__pre">Pre-release</span>` : "";
  return `
    <div class="oldgh-release-callout">
      ${octicon("tag", { size: 16 })}
      <span class="oldgh-release-callout__label">Latest release</span>
      <a class="oldgh-release-callout__tag" href="${escapeAttr(releaseHref)}">${escapeText(rel.tag)}</a>
      ${rel.name && rel.name !== rel.tag ? `<a class="oldgh-release-callout__name" href="${escapeAttr(releaseHref)}" title="${escapeAttr(rel.name)}">${escapeText(rel.name)}</a>` : ""}
      ${pre}
      ${time}
      ${download}
    </div>
  `;
}

// brand-new repo with no commits: 2013 "Quick setup" panel — clone box + the
// git push instructions, instead of the scary generic adapter error.
function renderEmptyShell(o: RepoOverview): string {
  const httpsUrl = o.clone.https ?? `https://github.com/${o.owner}/${o.repo}.git`;
  const sshUrl = o.clone.ssh ?? `git@github.com:${o.owner}/${o.repo}.git`;
  const createCmds = [
    "echo \"# " + o.repo + "\" >> README.md",
    "git init",
    "git add README.md",
    'git commit -m "first commit"',
    `git branch -M ${o.branch}`,
    `git remote add origin ${httpsUrl}`,
    `git push -u origin ${o.branch}`,
  ].join("\n");
  const existingCmds = [
    `git remote add origin ${httpsUrl}`,
    `git branch -M ${o.branch}`,
    `git push -u origin ${o.branch}`,
  ].join("\n");
  return `
    <div class="oldgh-page">
      <div class="oldgh-quick-setup">
        <h2 class="oldgh-quick-setup__title">Quick setup — if you've done this kind of thing before</h2>
        ${renderCloneBox(o)}
        <p class="oldgh-quick-setup__hint">Get started by <a href="https://docs.github.com/articles/creating-a-new-repository" rel="noopener">creating a new file</a> or pushing an existing repository from the command line.</p>
        <section class="oldgh-quick-setup__block">
          <h3>…or create a new repository on the command line</h3>
          <pre class="oldgh-quick-setup__cmds"><code>${escapeText(createCmds)}</code></pre>
        </section>
        <section class="oldgh-quick-setup__block">
          <h3>…or push an existing repository from the command line</h3>
          <pre class="oldgh-quick-setup__cmds"><code>${escapeText(existingCmds)}</code></pre>
        </section>
        <p class="oldgh-quick-setup__ssh">SSH: <code>${escapeText(sshUrl)}</code></p>
      </div>
    </div>
  `;
}

// 2013's numbers strip used commits, branches, tags, and contributors
// counts come from the REST API's last page or the returned array length
async function hydrateRepoNumbers(root: HTMLElement, owner: string, repo: string): Promise<void> {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const [branches, tags, contributors] = await Promise.all([
    fetchCount(`${base}/branches?per_page=1`),
    fetchCount(`${base}/tags?per_page=1`),
    fetchCount(`${base}/contributors?per_page=1&anon=1`),
  ]);
  setNumber(root, "branches", branches, "branch", "branches");
  setNumber(root, "tags", tags, "tag", "tags");
  setNumber(root, "contributors", contributors, "contributor", "contributors");
}

async function fetchCount(url: string): Promise<number | null> {
  try {
    const res = await fetchApi(url, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const link = res.headers.get("Link") || res.headers.get("link");
    if (link) {
      const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
      if (m) return parseInt(m[1]!, 10);
    }
    const arr = (await res.json()) as unknown;
    return Array.isArray(arr) ? arr.length : null;
  } catch {
    return null;
  }
}

function setNumber(root: HTMLElement, key: string, count: number | null, singular: string, plural: string): void {
  const li = root.querySelector<HTMLElement>(`.oldgh-repo-numbers li[data-numbers="${key}"]`);
  if (!li) return;
  if (count === null) {
    li.remove();
    return;
  }
  const numEl = li.querySelector<HTMLElement>(".oldgh-repo-numbers__num");
  const labelEl = li.querySelector<HTMLElement>(".oldgh-repo-numbers__label");
  if (numEl) numEl.textContent = count.toLocaleString();
  if (labelEl) labelEl.textContent = count === 1 ? singular : plural;
}

type LatestCommitData = {
  sha: string;
  message: string;
  date: string;
  authorLogin: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
};

async function hydrateLatestCommit(
  root: HTMLElement,
  ctx: { owner: string; repo: string; branch: string },
): Promise<void> {
  const slot = root.querySelector<HTMLElement>(".oldgh-repo-home__latest-slot");
  if (!slot) return;
  try {
    const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/commits?sha=${encodeURIComponent(ctx.branch)}&per_page=1`;
    // omit, not include: api.github.com returns Access-Control-Allow-Origin:*,
    // which the browser rejects for a credentialed request — include throws on
    // every repo. anon works for public repos; private repos just skip the ribbon.
    const res = await fetchApi(url, { credentials: "omit" });
    if (!res.ok) return;
    const arr = (await res.json()) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return;
    const data = parseLatestCommit(arr[0]);
    if (!data) return;
    slot.innerHTML = renderLatestCommit(ctx, data);
  } catch (err) {
    console.debug("[oldgh] latest commit fetch failed:", err);
  }
}

function parseLatestCommit(raw: unknown): LatestCommitData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sha = typeof r["sha"] === "string" ? (r["sha"] as string) : "";
  if (!sha) return null;
  const commit = r["commit"] as Record<string, unknown> | undefined;
  const commitAuthor = commit?.["author"] as Record<string, unknown> | undefined;
  const apiAuthor = r["author"] as Record<string, unknown> | undefined;
  const message = typeof commit?.["message"] === "string" ? (commit["message"] as string) : "";
  const date = typeof commitAuthor?.["date"] === "string"
    ? (commitAuthor["date"] as string)
    : typeof (commit?.["committer"] as Record<string, unknown> | undefined)?.["date"] === "string"
      ? ((commit?.["committer"] as Record<string, unknown>)["date"] as string)
      : "";
  return {
    sha,
    message: message.split("\n")[0] ?? "",
    date,
    authorLogin: typeof apiAuthor?.["login"] === "string" ? (apiAuthor["login"] as string) : null,
    authorName: typeof commitAuthor?.["name"] === "string" ? (commitAuthor["name"] as string) : "unknown",
    authorAvatarUrl: typeof apiAuthor?.["avatar_url"] === "string" ? (apiAuthor["avatar_url"] as string) : null,
  };
}

function renderLatestCommit(ctx: { owner: string; repo: string }, c: LatestCommitData): string {
  const commitUrl = `/${ctx.owner}/${ctx.repo}/commit/${c.sha}`;
  const authorHref = c.authorLogin ? `/${c.authorLogin}` : null;
  const displayName = c.authorLogin ?? c.authorName;
  const avatar = c.authorAvatarUrl
    ? `<img class="oldgh-latest-commit__avatar" src="${escapeAttr(c.authorAvatarUrl)}" alt="" width="20" height="20" />`
    : "";
  const author = authorHref
    ? `<a class="oldgh-latest-commit__author" href="${escapeAttr(authorHref)}">${escapeText(displayName)}</a>`
    : `<span class="oldgh-latest-commit__author">${escapeText(displayName)}</span>`;
  const time = c.date
    ? `<time class="oldgh-latest-commit__time" datetime="${escapeAttr(c.date)}" title="${escapeAttr(absoluteTime(c.date))}">${escapeText(relativeTime(c.date))}</time>`
    : "";
  return `
    <div class="oldgh-latest-commit">
      ${avatar}
      ${author}
      <a class="oldgh-latest-commit__message" href="${escapeAttr(commitUrl)}" title="${escapeAttr(c.message)}">${escapeText(c.message) || "(no commit message)"}</a>
      <a class="oldgh-latest-commit__sha" href="${escapeAttr(commitUrl)}" title="${escapeAttr(c.sha)}"><code>${escapeText(c.sha.slice(0, 7))}</code></a>
      ${time}
    </div>
  `;
}

async function hydrateLanguagesBar(root: HTMLElement, owner: string, repo: string): Promise<void> {
  try {
    const langs = await getRepoLanguages(owner, repo);
    if (langs.length === 0) return;
    const slot = root.querySelector<HTMLElement>(".oldgh-repo-home__langs-slot");
    if (!slot) return;
    slot.innerHTML = renderLanguageBar(langs);
  } catch {
    // ignore — language bar is decorative
  }
}

function renderLanguageBar(langs: Array<{ name: string; bytes: number; percent: number }>): string {
  const top = langs.slice(0, 8).map((l) => ({ ...l, display: canonicalLanguageName(l.name) }));
  const restPercent = langs.slice(8).reduce((s, l) => s + l.percent, 0);
  const segs = top.map((l) => `<span class="oldgh-repo-home__lang-seg" style="width:${l.percent.toFixed(2)}%;background:${languageColor(l.name)}" title="${escapeAttr(l.display)} ${l.percent.toFixed(1)}%"></span>`).join("");
  const otherSeg = restPercent > 0.1 ? `<span class="oldgh-repo-home__lang-seg oldgh-repo-home__lang-seg--other" style="width:${restPercent.toFixed(2)}%" title="Other ${restPercent.toFixed(1)}%"></span>` : "";
  const labels = top.map((l) => `<span class="oldgh-repo-home__lang-label"><span class="oldgh-repo-home__lang-dot" style="background:${languageColor(l.name)}"></span>${escapeText(l.display)} <strong>${l.percent.toFixed(1)}%</strong></span>`).join(" ");
  return `
    <div class="oldgh-repo-home__langs" tabindex="0" aria-label="Repository languages" title="Show language breakdown">
      <div class="oldgh-repo-home__lang-bar">${segs}${otherSeg}</div>
      <div class="oldgh-repo-home__lang-labels">${labels}${restPercent > 0.1 ? ` <span class="oldgh-repo-home__lang-label"><span class="oldgh-repo-home__lang-dot oldgh-repo-home__lang-dot--other"></span>Other <strong>${restPercent.toFixed(1)}%</strong></span>` : ""}</div>
    </div>
  `;
}

export function unmountRepoHome(): void {
  removeAllBodyRoots();
}

function renderShell(o: RepoOverview): string {
  return `
    <div class="oldgh-page">
      ${renderNumbersBar(o)}
      <div class="oldgh-repo-home__langs-slot"></div>
      <div class="oldgh-repo-home__release-slot"></div>
      ${renderTopBar(o)}
      <div class="oldgh-repo-home__latest-slot"></div>
      ${renderTreeTable({ owner: o.owner, repo: o.repo, branch: o.branch, basePath: "" }, o.tree)}
      ${renderReadme(o)}
    </div>
  `;
}

function renderNumbersBar(o: RepoOverview): string {
  const commits = o.commitCount
    ? `<li class="oldgh-repo-numbers__item"><a href="/${o.owner}/${o.repo}/commits/${escapeAttr(o.branch)}">${octicon("history", { size: 16 })}<span class="oldgh-repo-numbers__num">${escapeText(o.commitCount)}</span> <span class="oldgh-repo-numbers__label">${o.commitCount === "1" ? "commit" : "commits"}</span></a></li>`
    : "";
  // branches, tags, and contributors fill in via hydrateRepoNumbers
  // they start with a thin placeholder and each drops out if its fetch fails.
  const pending = (key: string, icon: string, href: string, label: string): string =>
    `<li class="oldgh-repo-numbers__item" data-numbers="${key}"><a href="${escapeAttr(href)}">${octicon(icon, { size: 16 })}<span class="oldgh-repo-numbers__num">&middot;&middot;</span> <span class="oldgh-repo-numbers__label">${label}</span></a></li>`;
  return `
    <ul class="oldgh-repo-numbers">
      ${commits}
      ${pending("branches", "git-branch", `/${o.owner}/${o.repo}/branches`, "branches")}
      ${pending("tags", "tag", `/${o.owner}/${o.repo}/tags`, "tags")}
      ${pending("contributors", "organization", `/${o.owner}/${o.repo}/graphs/contributors`, "contributors")}
    </ul>
  `;
}

function renderTopBar(o: RepoOverview): string {
  const branchIcon = octicon("git-branch", { size: 14 });
  return `
    <div class="oldgh-repo-home__topbar">
      <div class="oldgh-repo-home__refbox">
        <details class="oldgh-branch-picker">
          <summary class="oldgh-btn oldgh-branch-picker__button" aria-haspopup="menu">
            ${branchIcon}
            <span>branch:</span>
            <strong>${escapeText(o.branch)}</strong>
            ${octicon("triangle-down", { className: "oldgh-chevron" })}
          </summary>
          <div class="oldgh-branch-picker__panel" role="menu">
            <div class="oldgh-branch-picker__filter">
              <input type="text" placeholder="Filter branches" aria-label="Filter branches" autocomplete="off" />
            </div>
            <ul class="oldgh-branch-picker__list" data-loading="pending">
              <li class="oldgh-branch-picker__status">Loading branches&hellip;</li>
            </ul>
            <a class="oldgh-branch-picker__footer" href="/${o.owner}/${o.repo}/branches">View all branches</a>
          </div>
        </details>
      </div>
      ${renderCloneBox(o)}
    </div>
  `;
}

function renderCloneBox(o: RepoOverview): string {
  const tabs: { key: string; label: string; url: string | null }[] = [
    { key: "https", label: "HTTPS", url: o.clone.https },
    { key: "ssh", label: "SSH", url: o.clone.ssh },
  ];
  const enabled = tabs.filter((t): t is { key: string; label: string; url: string } => !!t.url);
  if (enabled.length === 0 && !o.clone.zip) return "";

  const first = enabled[0];
  const zipBtn = o.clone.zip
    ? `<a class="oldgh-btn oldgh-repo-home__zip" href="${escapeAttr(o.clone.zip)}">${octicon("cloud-download", { size: 14 })}<span>Download ZIP</span></a>`
    : "";

  if (!first) {
    return `<div class="oldgh-repo-home__clone-actions">${zipBtn}</div>`;
  }

  return `
    <div class="oldgh-repo-home__clone">
      <div class="oldgh-repo-home__clone-tabs" role="tablist">
        ${enabled
          .map(
            (t, i) =>
              `<button type="button" class="oldgh-repo-home__clone-tab" role="tab" data-tab="${t.key}"${i === 0 ? ' aria-selected="true"' : ""}>${escapeText(t.label)}</button>`,
          )
          .join("")}
      </div>
      <div class="oldgh-repo-home__clone-body">
        ${enabled
          .map(
            (t, i) => `
            <div class="oldgh-repo-home__clone-pane" data-pane="${t.key}"${i === 0 ? "" : " hidden"}>
              <input type="text" readonly value="${escapeAttr(t.url)}" aria-label="${escapeAttr(t.label)} clone URL" />
              <button type="button" class="oldgh-btn oldgh-repo-home__copy" data-copy="${escapeAttr(t.url)}" aria-label="Copy to clipboard">${octicon("clippy", { size: 14 })}</button>
            </div>`,
          )
          .join("")}
      </div>
      <div class="oldgh-repo-home__clone-actions">${zipBtn}</div>
    </div>
  `;
}

function renderReadme(o: RepoOverview): string {
  if (!o.readme) return "";
  return `
    <section class="oldgh-repo-home__readme">
      <div class="oldgh-repo-home__readme-head">
        ${octicon("book", { size: 16 })}
        <a href="/${o.owner}/${o.repo}/blob/${encodeURIComponent(o.branch)}/${escapeAttr(pathSegments(o.readme.path))}">${escapeText(o.readme.path)}</a>
      </div>
      <div class="oldgh-repo-home__readme-body">${sanitizeBodyHtml(o.readme.html)}</div>
    </section>
  `;
}

function pathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function bindCloneTabs(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const tab = (e.target as Element | null)?.closest<HTMLButtonElement>(".oldgh-repo-home__clone-tab");
    if (!tab) return;
    const key = tab.dataset["tab"];
    if (!key) return;
    root.querySelectorAll<HTMLElement>(".oldgh-repo-home__clone-tab").forEach((t) => {
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    root.querySelectorAll<HTMLElement>(".oldgh-repo-home__clone-pane").forEach((p) => {
      p.hidden = p.dataset["pane"] !== key;
    });
  });
}

const branchCache = new Map<string, string[]>();
let branchPickerOutsideClickInstalled = false;

function installBranchPickerOutsideClick(): void {
  if (branchPickerOutsideClickInstalled) return;
  branchPickerOutsideClickInstalled = true;
  document.addEventListener("click", (e) => {
    document.querySelectorAll<HTMLDetailsElement>(".oldgh-branch-picker[open]").forEach((d) => {
      if (!d.contains(e.target as Node)) d.open = false;
    });
  });
}

function bindBranchPicker(root: HTMLElement, ctx: { owner: string; repo: string; branch: string }): void {
  installBranchPickerOutsideClick();
  const details = root.querySelector<HTMLDetailsElement>(".oldgh-branch-picker");
  if (!details) return;
  const list = details.querySelector<HTMLUListElement>(".oldgh-branch-picker__list");
  const input = details.querySelector<HTMLInputElement>(".oldgh-branch-picker__filter input");

  details.addEventListener("toggle", () => {
    if (!details.open) return;
    if (input) {
      input.value = "";
      // focus after the toggle paint so the input is actually visible
      window.setTimeout(() => input.focus(), 0);
    }
    // clear stale filter visibility from a prior open so the full list shows
    list?.querySelectorAll<HTMLElement>("li[data-name]").forEach((li) => {
      li.hidden = false;
    });
    void loadBranches(list, ctx);
  });

  input?.addEventListener("input", () => {
    if (!list) return;
    const q = input.value.trim().toLowerCase();
    list.querySelectorAll<HTMLElement>("li[data-name]").forEach((li) => {
      const match = q === "" || (li.dataset["name"] ?? "").toLowerCase().includes(q);
      li.hidden = !match;
    });
  });

  details.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      details.open = false;
      (details.querySelector<HTMLElement>("summary"))?.focus();
    }
  });
}

async function loadBranches(list: HTMLUListElement | null, ctx: { owner: string; repo: string; branch: string }): Promise<void> {
  if (!list || list.dataset["loading"] !== "pending") return;
  list.dataset["loading"] = "done";
  const key = `${ctx.owner}/${ctx.repo}`;
  let names = branchCache.get(key);
  if (!names) {
    try {
      // omit, not include — api.github.com sends ACAO:* which fails a
      // credentialed CORS request; include threw and the picker never loaded
      const res = await fetchApi(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/branches?per_page=100`, { credentials: "omit" });
      if (!res.ok) throw new Error(`branches ${res.status}`);
      const data = await res.json() as Array<{ name: string }>;
      names = data.map((b) => b.name);
      // current branch first, then alphabetic
      names.sort((a, b) => {
        if (a === ctx.branch) return -1;
        if (b === ctx.branch) return 1;
        return a.localeCompare(b);
      });
      branchCache.set(key, names);
    } catch (err) {
      console.debug("[oldgh] branch list fetch failed:", err);
      list.innerHTML = `<li class="oldgh-branch-picker__status">Couldn't load branches.</li>`;
      return;
    }
  }
  if (names.length === 0) {
    list.innerHTML = `<li class="oldgh-branch-picker__status">No branches.</li>`;
    return;
  }
  const checkIcon = octicon("check", { size: 14 });
  list.innerHTML = names.map((name) => {
    const isCurrent = name === ctx.branch;
    const href = `/${ctx.owner}/${ctx.repo}/tree/${encodeURIComponent(name)}`;
    return `<li data-name="${escapeAttr(name)}"${isCurrent ? " data-current" : ""}><a href="${escapeAttr(href)}">${isCurrent ? checkIcon : `<span class="oldgh-branch-picker__check-spacer" aria-hidden="true"></span>`}<span class="oldgh-branch-picker__name">${escapeText(name)}</span></a></li>`;
  }).join("");
}

function bindCopyButtons(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>(".oldgh-repo-home__copy");
    if (!btn) return;
    const text = btn.dataset["copy"];
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      const prev = btn.innerHTML;
      btn.innerHTML = octicon("check", { size: 14 });
      btn.classList.add("is-copied");
      window.setTimeout(() => {
        btn.innerHTML = prev;
        btn.classList.remove("is-copied");
      }, 1200);
    });
  });
}

function sanitizeBodyHtml(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href=(["'])https?:\/\/github\.com(\/[^"']*)\1/gi, 'href=$1$2$1');
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
