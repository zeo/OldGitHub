import { octicon } from "@/icons";
import { encodePathSegments, escapeAttr, escapeText } from "@/util/html";

export function renderRepoBreadcrumb(opts: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}): string {
  const parts = opts.path.split("/").filter(Boolean);
  const branchIcon = octicon("git-branch", { size: 14 });
  const pieces: string[] = [];
  pieces.push(`<span class="oldgh-breadcrumb__ref">${branchIcon}<strong>${escapeText(opts.branch)}</strong></span>`);
  pieces.push(`<span class="oldgh-breadcrumb__sep">/</span>`);
  pieces.push(`<a class="oldgh-breadcrumb__seg" href="/${escapeAttr(opts.owner)}/${escapeAttr(opts.repo)}">${escapeText(opts.repo)}</a>`);
  const ownerSeg = encodeURIComponent(opts.owner);
  const repoSeg = encodeURIComponent(opts.repo);
  const branchSeg = encodePathSegments(opts.branch);
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    acc = acc ? `${acc}/${seg}` : seg;
    pieces.push(`<span class="oldgh-breadcrumb__sep">/</span>`);
    if (i === parts.length - 1) {
      pieces.push(`<span class="oldgh-breadcrumb__seg oldgh-breadcrumb__seg--current">${escapeText(seg)}</span>`);
    } else {
      const href = `/${ownerSeg}/${repoSeg}/tree/${branchSeg}/${encodePathSegments(acc)}`;
      pieces.push(`<a class="oldgh-breadcrumb__seg" href="${escapeAttr(href)}">${escapeText(seg)}</a>`);
    }
  }
  return `<div class="oldgh-breadcrumb">${pieces.join("")}</div>`;
}
