import { octicon } from "@/icons";
import { formatCount } from "@/util/format";
import { fetchApi } from "@/adapters/rate-limit";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-topics-index";

type Topic = {
  name: string;
  displayName: string | null;
  shortDescription: string | null;
  featured: boolean;
  curated: boolean;
  repoCount: number | null;
};

export async function mountTopics(_pathname: string, _search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell();
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const slot = root.querySelector<HTMLElement>(".oldgh-topics-index__slot");
  if (!slot) return;

  try {
    const [featured, popular] = await Promise.all([
      fetchFeaturedTopics(),
      fetchPopularTopics(),
    ]);
    slot.innerHTML = renderContent(featured, popular);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slot.innerHTML = `<div class="oldgh-topics-index__empty">Couldn't load topics: ${escapeText(msg)}</div>`;
  }
}

async function fetchFeaturedTopics(): Promise<Topic[]> {
  const resp = await fetchApi(
    "https://api.github.com/search/topics?q=is:featured&per_page=30",
    { credentials: "omit", headers: { Accept: "application/vnd.github.mercy-preview+json" } },
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as Record<string, unknown>;
  return parseTopics(data, true);
}

async function fetchPopularTopics(): Promise<Topic[]> {
  const resp = await fetchApi(
    "https://api.github.com/search/topics?q=is:curated&per_page=30",
    { credentials: "omit", headers: { Accept: "application/vnd.github.mercy-preview+json" } },
  );
  if (!resp.ok) return [];
  const data = (await resp.json()) as Record<string, unknown>;
  return parseTopics(data, false);
}

function parseTopics(data: Record<string, unknown>, isFeatured: boolean): Topic[] {
  const items = Array.isArray(data["items"]) ? (data["items"] as unknown[]) : [];
  return items.map((raw) => {
    if (!raw || typeof raw !== "object") return null;
    const t = raw as Record<string, unknown>;
    const name = typeof t["name"] === "string" ? t["name"] : null;
    if (!name) return null;
    return {
      name,
      displayName: typeof t["display_name"] === "string" ? t["display_name"] : null,
      shortDescription: typeof t["short_description"] === "string" ? t["short_description"] : null,
      featured: t["featured"] === true || isFeatured,
      curated: t["curated"] === true,
      repoCount: typeof t["repository_count"] === "number" ? t["repository_count"] : null,
    };
  }).filter((t): t is Topic => t !== null);
}

function renderShell(): string {
  return `
    <div class="oldgh-page oldgh-topics-index__page">
      <header class="oldgh-topics-index__header">
        <h1>${octicon("tag", { size: 22 })} Topics</h1>
        <p class="oldgh-topics-index__sub">Browse repositories by topic. Curated lists of repositories tagged with a common theme.</p>
      </header>
      <div class="oldgh-topics-index__slot">
        <div class="oldgh-topics-index__loading">Loading topics&hellip;</div>
      </div>
    </div>
  `;
}

function renderContent(featured: Topic[], popular: Topic[]): string {
  // Deduplicate: popular without the featured ones
  const featuredNames = new Set(featured.map((t) => t.name));
  // strip featured so curated-section cards label as Curated (is:featured is capped at 30)
  const rest = popular
    .filter((t) => !featuredNames.has(t.name))
    .map((t) => ({ ...t, featured: false }));

  const sections: string[] = [];

  if (featured.length > 0) {
    sections.push(`
      <section class="oldgh-topics-index__section">
        <h2>${octicon("star", { size: 14 })} Featured topics</h2>
        <ul class="oldgh-topics-index__grid">
          ${featured.map(renderCard).join("")}
        </ul>
      </section>
    `);
  }

  if (rest.length > 0) {
    sections.push(`
      <section class="oldgh-topics-index__section">
        <h2>${octicon("checklist", { size: 14 })} Curated topics</h2>
        <ul class="oldgh-topics-index__grid">
          ${rest.map(renderCard).join("")}
        </ul>
      </section>
    `);
  }

  if (sections.length === 0) {
    return `<div class="oldgh-topics-index__empty">${octicon("tag", { size: 40 })}<p>No topics found.</p></div>`;
  }

  return sections.join("");
}

function renderCard(t: Topic): string {
  const label = t.displayName || t.name;
  const badges = [
    t.featured ? `<span class="oldgh-topics-index__badge oldgh-topics-index__badge--featured">${octicon("star", { size: 10 })} Featured</span>` : "",
    t.curated && !t.featured ? `<span class="oldgh-topics-index__badge">${octicon("checklist", { size: 10 })} Curated</span>` : "",
    t.repoCount != null ? `<span class="oldgh-topics-index__badge">${octicon("repo", { size: 10 })} ${formatCount(t.repoCount)} ${t.repoCount === 1 ? "repository" : "repositories"}</span>` : "",
  ].join("");
  return `
    <li class="oldgh-topics-index__card">
      <a class="oldgh-topics-index__card-link" href="/topics/${escapeAttr(t.name)}">
        <h3 class="oldgh-topics-index__card-name">${escapeText(label)}</h3>
        <code class="oldgh-topics-index__card-slug">${escapeText(t.name)}</code>
        ${t.shortDescription ? `<p class="oldgh-topics-index__card-desc">${escapeText(t.shortDescription)}</p>` : ""}
        ${badges ? `<div class="oldgh-topics-index__card-footer">${badges}</div>` : ""}
      </a>
    </li>
  `;
}
