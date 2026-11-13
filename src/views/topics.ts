import { octicon } from "@/icons";
import { fetchPageDoc } from "@/adapters/_page";
import { AdapterFailure } from "@/adapters";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-topics-index";

type Topic = {
  name: string;
  displayName: string;
  description: string | null;
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
    slot.innerHTML = renderContent(...(await fetchTopics()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slot.innerHTML = `<div class="oldgh-topics-index__empty">Couldn't load topics: ${escapeText(msg)}</div>`;
  }
}

async function fetchTopics(): Promise<[Topic[], Topic[]]> {
  const doc = await fetchPageDoc("https://github.com/topics");
  const section = (heading: RegExp): Element | null =>
    Array.from(doc.querySelectorAll("main h2")).find((h) => heading.test(h.textContent ?? ""))?.parentElement ?? null;
  const featured = Array.from(section(/featured topics/i)?.querySelectorAll("a[href^='/topics/']:has(p.f3)") ?? []).map((a) => ({
    name: a.getAttribute("href")!.slice("/topics/".length),
    displayName: a.querySelector("p.f3")?.textContent?.trim() ?? "",
    description: a.querySelector("p.f5")?.textContent?.trim() || null,
  }));
  const popular = Array.from(section(/popular topics/i)?.querySelectorAll("a[href^='/topics/']") ?? []).map((a) => {
    const name = a.getAttribute("href")!.slice("/topics/".length);
    return { name, displayName: a.textContent?.trim() || name, description: null };
  });
  if (featured.length === 0 && popular.length === 0) throw new AdapterFailure("getTopics", "the topics page listed no topics");
  return [featured, popular];
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
  const featuredNames = new Set(featured.map((t) => t.name));
  const rest = popular.filter((t) => !featuredNames.has(t.name));

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
        <h2>${octicon("flame", { size: 14 })} Popular topics</h2>
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
  return `
    <li class="oldgh-topics-index__card">
      <a class="oldgh-topics-index__card-link" href="/topics/${escapeAttr(t.name)}">
        <h3 class="oldgh-topics-index__card-name">${escapeText(label)}</h3>
        ${label.toLowerCase() !== t.name ? `<code class="oldgh-topics-index__card-slug">${escapeText(t.name)}</code>` : ""}
        ${t.description ? `<p class="oldgh-topics-index__card-desc">${escapeText(t.description)}</p>` : ""}
      </a>
    </li>
  `;
}
