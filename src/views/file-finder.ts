import { getFileList } from "@/adapters/repo-files";
import { octicon } from "@/icons";
import { preparePaths, rankPreparedPaths, type PathMatch, type PreparedPath } from "@/util/fuzzy";
import { encodePathSegments, escapeAttr, escapeText } from "@/util/html";

const LIMIT = 50;

function renderMatch(m: PathMatch): string {
  const hits = new Set(m.hits);
  let out = "";
  for (let i = 0; i < m.path.length; i++) {
    const ch = escapeText(m.path[i]!);
    out += hits.has(i) ? `<b>${ch}</b>` : ch;
  }
  return out;
}

export function openFileFinder(owner: string, repo: string, codePath: string | null, go: (path: string) => void): void {
  if (document.querySelector(".oldgh-finder")) return;
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement("div");
  overlay.className = "oldgh-confirm-overlay oldgh-finder";
  overlay.innerHTML = `
    <div class="oldgh-finder__box" role="dialog" aria-label="Find a file">
      <label class="oldgh-finder__head">
        <span class="oldgh-finder__repo">${escapeText(repo)} /</span>
        <input class="oldgh-finder__input" type="text" autocomplete="off" spellcheck="false" placeholder="Loading files..." disabled>
      </label>
      <ul class="oldgh-finder__list" role="listbox"></ul>
    </div>`;
  const input = overlay.querySelector<HTMLInputElement>(".oldgh-finder__input")!;
  const list = overlay.querySelector<HTMLUListElement>(".oldgh-finder__list")!;
  let paths: PreparedPath[] = [];
  let base = "";
  let selected = 0;
  let rafId = 0;

  const close = (): void => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    overlay.remove();
    previous?.focus();
  };
  const rows = (): HTMLAnchorElement[] => Array.from(list.querySelectorAll<HTMLAnchorElement>("a"));
  const select = (i: number): void => {
    const all = rows();
    if (!all.length) return;
    selected = (i + all.length) % all.length;
    all.forEach((a, k) => a.parentElement!.setAttribute("aria-selected", String(k === selected)));
    all[selected]!.scrollIntoView({ block: "nearest" });
  };
  const render = (): void => {
    const found = rankPreparedPaths(input.value.trim(), paths, LIMIT);
    list.innerHTML = found.length
      ? found.map((m) => `<li role="option"><a href="${escapeAttr(`${base}/${encodePathSegments(m.path)}`)}">${octicon("file", { size: 16 })}<span>${renderMatch(m)}</span></a></li>`).join("")
      : `<li class="oldgh-finder__empty">No matching files.</li>`;
    select(0);
  };
  const scheduleRender = (): void => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      if (overlay.isConnected) render();
    });
  };

  input.addEventListener("input", scheduleRender);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      select(selected + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      const href = rows()[selected]?.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      close();
      go(href);
    }
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || (e.target as Element).closest("a")) close();
  });

  document.body.append(overlay);
  getFileList(owner, repo, codePath).then(
    (files) => {
      if (!overlay.isConnected) return;
      paths = preparePaths(files.paths);
      base = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodePathSegments(files.ref)}`;
      input.disabled = false;
      input.placeholder = `Find a file on ${files.ref}`;
      input.focus();
      render();
    },
    (err: unknown) => {
      input.placeholder = "Could not load the file list";
      list.innerHTML = `<li class="oldgh-finder__empty">${escapeText(err instanceof Error ? err.message : String(err))}</li>`;
      overlay.focus();
    },
  );
  overlay.tabIndex = -1;
  overlay.focus();
}
