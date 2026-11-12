import { scrapeSection, type ScrapedSection } from "@/adapters/repo-section";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeText } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-section";

export type SectionKind = "pulse" | "graphs" | "projects" | "security" | "discussions" | "other";

export async function mountRepoSection(
  owner: string,
  repo: string,
  kind: SectionKind,
  subPath: string,
  titleFallback: string,
): Promise<void> {
  const nav = navigationToken();
  // adopt a themed shell with a loading slot first so the stale previous body
  // is swapped out instantly — otherwise the old page sits under the newly
  // active tab for the whole scrape. then fill the content slot when ready.
  const root = document.createElement("div");
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${kind}`;
  root.innerHTML = `
    <div class="oldgh-page">
      <header class="oldgh-section__header">
        <h1>${escapeText(titleFallback)}</h1>
      </header>
      <div class="oldgh-section__content">
        <div class="oldgh-section__loading">Loading&hellip;</div>
      </div>
    </div>
  `;
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const view = await scrapeSection(owner, repo, subPath, { titleFallback });
  const h1 = root.querySelector<HTMLElement>(".oldgh-section__header h1");
  if (h1) h1.textContent = view.title;
  const content = root.querySelector<HTMLElement>(".oldgh-section__content");
  if (content) content.innerHTML = view.contentHtml;
}
