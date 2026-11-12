import type { DiffFile, DiffHunk, DiffLine } from "@/util/diff";
import { escapeText } from "@/util/html";

export function renderDiffFile(f: DiffFile): string {
  const statusBadge = f.status === "added"
    ? '<span class="oldgh-repo-commit__file-status oldgh-repo-commit__file-status--added">added</span>'
    : f.status === "deleted"
      ? '<span class="oldgh-repo-commit__file-status oldgh-repo-commit__file-status--deleted">deleted</span>'
      : f.status === "renamed"
        ? '<span class="oldgh-repo-commit__file-status oldgh-repo-commit__file-status--renamed">renamed</span>'
        : f.status === "binary"
          ? '<span class="oldgh-repo-commit__file-status">binary</span>'
          : "";
  return `
    <section class="oldgh-repo-commit__file">
      <div class="oldgh-repo-commit__file-head">
        <span class="oldgh-repo-commit__file-path">${escapeText(f.path)}</span>
        ${statusBadge}
        <span class="oldgh-repo-commit__file-counts">
          <span class="oldgh-repo-commit__add">+${f.additions}</span>
          <span class="oldgh-repo-commit__del">-${f.deletions}</span>
        </span>
      </div>
      ${f.isBinary
        ? `<div class="oldgh-repo-commit__binary">${escapeText(binaryNoteText(f.binaryNote))}</div>`
        : renderHunks(f.hunks)}
    </section>
  `;
}

export function renderDiffSummary(files: DiffFile[]): string {
  const adds = files.reduce((s, f) => s + f.additions, 0);
  const dels = files.reduce((s, f) => s + f.deletions, 0);
  return `
    <div class="oldgh-repo-commit__stats">
      <span><strong>${files.length}</strong> file${files.length === 1 ? "" : "s"} changed</span>
      <span class="oldgh-repo-commit__stats-sep">·</span>
      <span class="oldgh-repo-commit__add">+${adds}</span>
      <span class="oldgh-repo-commit__del">-${dels}</span>
    </div>
  `;
}

export function renderHunks(hunks: DiffHunk[], afterLine?: (l: DiffLine) => string): string {
  if (hunks.length === 0) return "";
  return `
    <div class="oldgh-diff-scroll">
      <table class="oldgh-diff">
        ${hunks.map((h) => renderHunk(h, afterLine)).join("")}
      </table>
    </div>
  `;
}

export function renderDiffLines(lines: DiffLine[]): string {
  return `<div class="oldgh-diff-scroll"><table class="oldgh-diff">${lines.map((l) => renderLine(l)).join("")}</table></div>`;
}

function renderHunk(h: DiffHunk, afterLine?: (l: DiffLine) => string): string {
  const headerRow = `
    <tr class="oldgh-diff__hunk-header">
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__code">@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ ${escapeText(h.header)}</td>
    </tr>
  `;
  return headerRow + h.lines.map((l) => renderLine(l) + (afterLine?.(l) ?? "")).join("");
}

function renderLine(l: DiffLine): string {
  if (l.kind === "no-newline") {
    return `<tr class="oldgh-diff__row oldgh-diff__row--no-newline">
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__code">${escapeText(l.text)}</td>
    </tr>`;
  }
  if (l.kind === "add") {
    return `<tr class="oldgh-diff__row oldgh-diff__row--add">
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__num">${l.new}</td>
      <td class="oldgh-diff__code"><span class="oldgh-diff__sign">+</span>${escapeText(l.text)}</td>
    </tr>`;
  }
  if (l.kind === "del") {
    return `<tr class="oldgh-diff__row oldgh-diff__row--del">
      <td class="oldgh-diff__num">${l.old}</td>
      <td class="oldgh-diff__num"></td>
      <td class="oldgh-diff__code"><span class="oldgh-diff__sign">-</span>${escapeText(l.text)}</td>
    </tr>`;
  }
  return `<tr class="oldgh-diff__row">
    <td class="oldgh-diff__num">${l.old}</td>
    <td class="oldgh-diff__num">${l.new}</td>
    <td class="oldgh-diff__code"><span class="oldgh-diff__sign"> </span>${escapeText(l.text)}</td>
  </tr>`;
}

// strip git's a/ b/ path prefixes from "Binary files a/x and b/x differ"
function binaryNoteText(note: string | null): string {
  if (!note) return "Binary file changed";
  return note.replace(/(^|\s)[ab]\//g, "$1");
}
