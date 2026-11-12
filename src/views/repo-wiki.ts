import { octicon } from "@/icons";
import { getWiki, type WikiView } from "@/adapters/repo-wiki";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-repo-wiki";

export async function mountRepoWiki(owner: string, repo: string, page: string): Promise<void> {
  const nav = navigationToken();
  const view = await getWiki(owner, repo, page);

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.innerHTML = renderShell(view);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;
  bindCloneCopy(root);
}

function bindCloneCopy(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>(".oldgh-wiki__clone-copy");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const text = btn.dataset["copy"];
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      const prev = btn.innerHTML;
      btn.innerHTML = octicon("check", { size: 14 });
      window.setTimeout(() => { btn.innerHTML = prev; }, 1200);
    });
  });
}

export function unmountRepoWiki(): void {
  removeAllBodyRoots();
}

function renderShell(v: WikiView): string {
  return `
    <div class="oldgh-page oldgh-wiki">
      <header class="oldgh-wiki__header">
        <h1 class="oldgh-wiki__title">${escapeText(v.pageTitle)}</h1>
        ${v.metaText ? `<p class="oldgh-wiki__meta">${escapeText(v.metaText)}</p>` : ""}
      </header>
      <div class="oldgh-wiki__layout">
        <article class="oldgh-wiki__content markdown-body">
          ${sanitizeBodyHtml(v.bodyHtml)}
        </article>
        <aside class="oldgh-wiki__sidebar">
          <div class="oldgh-wiki__pages">
            <h3>${octicon("list-unordered", { size: 12 })} Pages ${v.pages.length > 0 ? `<span class="oldgh-wiki__pages-count">${v.pages.length}</span>` : ""}</h3>
            ${v.pages.length === 0
              ? `<p class="oldgh-wiki__pages-empty oldgh-muted">No other pages</p>`
              : `<ul>
              ${v.pages.slice(0, 60).map((p) => `<li><a href="${escapeAttr(p.href)}">${escapeText(p.title)}</a></li>`).join("")}
            </ul>
            ${v.pages.length > 60 ? `<p class="oldgh-wiki__pages-more">+${v.pages.length - 60} more pages</p>` : ""}`}
          </div>
          <div class="oldgh-wiki__clone">
            <h3>${octicon("repo-clone", { size: 12 })} Clone this wiki</h3>
            <div class="oldgh-wiki__clone-row">
              <input type="text" class="oldgh-input oldgh-wiki__clone-input" readonly value="${escapeAttr(v.cloneUrl)}" />
              <button type="button" class="oldgh-btn oldgh-wiki__clone-copy" data-copy="${escapeAttr(v.cloneUrl)}" title="Copy clone URL" aria-label="Copy clone URL">${octicon("clippy", { size: 14 })}</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
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
