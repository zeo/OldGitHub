import { escapeAttr, escapeText, safeAttrHref } from "@/util/html";

export function renderPrevNextPager(opts: {
  className: string;
  prevHref: string | null;
  nextHref: string | null;
  prevHtml?: string;
  nextHtml?: string;
  prevLabel?: string;
  nextLabel?: string;
  statusText?: string;
  disabledButtons?: boolean;
}): string {
  if (!opts.prevHref && !opts.nextHref) return "";
  const prevContent = opts.prevHtml ?? escapeText(opts.prevLabel ?? "‹ Previous");
  const nextContent = opts.nextHtml ?? escapeText(opts.nextLabel ?? "Next ›");
  const prevEl = opts.prevHref
    ? `<a${opts.disabledButtons ? ' class="oldgh-btn"' : ""} href="${safeAttrHref(opts.prevHref)}">${prevContent}</a>`
    : opts.disabledButtons
      ? `<button class="oldgh-btn" type="button" disabled>${prevContent}</button>`
      : "<span></span>";
  const nextEl = opts.nextHref
    ? `<a${opts.disabledButtons ? ' class="oldgh-btn"' : ""} href="${safeAttrHref(opts.nextHref)}">${nextContent}</a>`
    : opts.disabledButtons
      ? `<button class="oldgh-btn" type="button" disabled>${nextContent}</button>`
      : "<span></span>";
  const mid = opts.statusText ? `<span>${escapeText(opts.statusText)}</span>` : "";
  const tag = opts.disabledButtons ? "div" : "nav";
  return `<${tag} class="${escapeAttr(opts.className)}">${prevEl}${mid}${nextEl}</${tag}>`;
}
