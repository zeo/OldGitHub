import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-projects";

type LinkedProject = {
  number: number;
  title: string;
  description: string | null;
  url: string;
  ownerLogin: string;
  ownerAvatar: string | null;
  state: "open" | "closed" | null;
  itemCount: number | null;
};

export async function mountRepoProjects(owner: string, repo: string, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(owner, repo);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-projects__main");
  if (!main) return;

  try {
    const projects = await scrapeProjects(owner, repo, search);
    main.innerHTML = renderBody(owner, repo, projects);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-projects__empty">Couldn't load projects: ${escapeText(msg)}</div>`;
  }
}

async function scrapeProjects(owner: string, repo: string, search: string): Promise<LinkedProject[]> {
  const url = `https://github.com/${owner}/${repo}/projects${search ? `?${search}` : ""}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) throw new Error(`${url} responded ${resp.status}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const projects: LinkedProject[] = [];
  // Modern V2 project rows: anchors like /owner/repo/projects/N
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const m = /^\/[\w.-]+\/[\w.-]+\/projects\/(\d+)(?:$|[?#])/.exec(href);
    if (!m) continue;
    const num = parseInt(m[1]!, 10);
    if (projects.some((p) => p.number === num)) continue;
    const card = a.closest("li, .Box-row, article") || a.parentElement;
    if (!card) continue;
    const titleEl = card.querySelector<HTMLElement>("h3, h4, .h4, .markdown-title, [data-target*='title']") || a;
    const title = (titleEl.textContent || "").trim();
    if (!title || title.length > 200) continue;
    // skip GitHub's lazy-hydration placeholder text — projects render
    // "There was an error while loading" inside a <p> while the real
    // description loads via JS we can't run.
    const descEls = Array.from(card.querySelectorAll<HTMLElement>("p.color-fg-muted, p.color-fg-subtle, .text-small.color-fg-muted"));
    let desc: string | null = null;
    for (const el of descEls) {
      const t = (el.textContent || "").trim();
      if (!t) continue;
      if (/There was an error while loading/i.test(t)) continue;
      if (/^Loading\.?\.?\.?$/i.test(t)) continue;
      desc = t;
      break;
    }
    const stateEl = card.querySelector<HTMLElement>("[data-state], .State");
    const stateText = stateEl?.textContent?.trim().toLowerCase() || "";
    // null when no state element scraped so we don't assert a confident "Open" on closed projects
    const state: "open" | "closed" | null = stateEl ? (stateText.includes("closed") ? "closed" : "open") : null;
    const itemCountEl = card.querySelector<HTMLElement>("[data-test-selector='item-count'], .Counter");
    const countText = (itemCountEl?.textContent || "").trim();
    // abbreviated/overflow counters ("1.2k", "999+") aren't exact, so drop the count rather than show a wrong number
    const itemCount = itemCountEl && !/[km+]/i.test(countText) ? parseInt(countText.replace(/,/g, ""), 10) : NaN;
    const ownerLogin = href.replace(/^\/+/, "").split("/")[0] || owner;
    projects.push({
      number: num,
      title,
      description: desc,
      url: href.replace(/[?#].*$/, ""),
      ownerLogin,
      ownerAvatar: `https://github.com/${ownerLogin}.png?size=40`,
      state,
      itemCount: Number.isFinite(itemCount) ? (itemCount as number) : null,
    });
  }
  return projects;
}

function renderShell(owner: string, repo: string): string {
  return `
    <div class="oldgh-page oldgh-projects">
      <header class="oldgh-projects__header">
        <h1>${octicon("project", { size: 22 })} Projects</h1>
        <p class="oldgh-projects__sub">Projects linked to <strong>${escapeText(owner)}/${escapeText(repo)}</strong>.</p>
      </header>
      <div class="oldgh-projects__main">
        <div class="oldgh-projects__loading">Loading projects&hellip;</div>
      </div>
    </div>
  `;
}

function renderBody(owner: string, repo: string, projects: LinkedProject[]): string {
  if (projects.length === 0) {
    return `
      <div class="oldgh-projects__empty">
        ${octicon("project", { size: 48 })}
        <h2>No projects are linked yet.</h2>
        <p>Projects on GitHub let you plan work alongside the code. Roadmaps, milestone boards, sprint tracking — all linked to issues and pull requests in this repo.</p>
        <p class="oldgh-projects__cta">
          <a class="oldgh-btn oldgh-btn--primary" href="https://github.com/${escapeAttr(owner)}/${escapeAttr(repo)}/projects?query=is%3Aopen">${octicon("link", { size: 14 })}<span>Link a project</span></a>
          <a class="oldgh-btn" href="https://github.com/${escapeAttr(owner)}/${escapeAttr(repo)}/projects/new">${octicon("plus", { size: 14 })}<span>New project</span></a>
        </p>
      </div>
    `;
  }
  return `
    <div class="oldgh-projects__bar">
      <div class="oldgh-projects__count"><strong>${projects.length}</strong> ${projects.length === 1 ? "linked project" : "linked projects"}</div>
      <a class="oldgh-btn oldgh-btn--primary" href="https://github.com/${escapeAttr(owner)}/${escapeAttr(repo)}/projects/new">${octicon("plus", { size: 14 })}<span>New project</span></a>
    </div>
    <ul class="oldgh-projects__list">
      ${projects.map(renderProjectRow).join("")}
    </ul>
  `;
}

function renderProjectRow(p: LinkedProject): string {
  const stateChip = p.state === null
    ? ""
    : p.state === "open"
      ? `<span class="oldgh-projects__state oldgh-projects__state--open">${octicon("primitive-dot", { size: 11 })} Open</span>`
      : `<span class="oldgh-projects__state oldgh-projects__state--closed">${octicon("check", { size: 11 })} Closed</span>`;
  return `
    <li class="oldgh-projects__row">
      <div class="oldgh-projects__row-icon">${octicon("project", { size: 18 })}</div>
      <div class="oldgh-projects__row-main">
        <h3 class="oldgh-projects__row-title">
          <a href="${escapeAttr(p.url)}">${escapeText(p.title)}</a>
          <span class="oldgh-projects__row-num">#${p.number}</span>
        </h3>
        ${p.description ? `<p class="oldgh-projects__row-desc">${escapeText(p.description)}</p>` : ""}
        <div class="oldgh-projects__row-meta">
          ${stateChip}
          ${p.itemCount !== null ? `<span>${octicon("list-unordered", { size: 11 })} ${p.itemCount} ${p.itemCount === 1 ? "item" : "items"}</span>` : ""}
          <span>${octicon("person", { size: 11 })} owned by <a href="/${escapeAttr(p.ownerLogin)}">${escapeText(p.ownerLogin)}</a></span>
        </div>
      </div>
    </li>
  `;
}
