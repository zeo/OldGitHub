export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// browsers drop ascii whitespace and control characters before reading the scheme, so "java\tscript:" still runs
export function isSafeUrl(url: string): boolean {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url.replace(/[\u0000- \u007f]/g, ""));
  return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]!);
}

export function safeHref(url: string): string {
  return isSafeUrl(url) ? url : "#";
}

const DROP_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "link", "meta", "noscript", "template",
  "animate", "animatemotion", "animatetransform", "set",
]);
const URL_ATTRS = new Set(["href", "xlink:href", "src", "action", "formaction"]);

export function sanitizeTree(root: Element | DocumentFragment): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (DROP_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const inlineImage = name === "src" && el.localName === "img" && /^data:image\//i.test(attr.value);
      if (name.startsWith("on") || (URL_ATTRS.has(name) && !inlineImage && !isSafeUrl(attr.value))) el.removeAttribute(attr.name);
    }
    // absolute github links become relative so clicks stay inside the router
    const href = el.getAttribute("href");
    if (href && /^https?:\/\/github\.com\//i.test(href)) el.setAttribute("href", href.replace(/^https?:\/\/github\.com/i, ""));
  }
}

// a template parses inertly: no image loads or handlers fire before the walk
export function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeTree(template.content);
  return template.innerHTML;
}

const PAGE_CHROME = [
  "header.AppHeader",
  ".AppHeader-globalBar",
  "header[role='banner']",
  "footer",
  "#repository-container-header",
  ".pagehead",
  ".UnderlineNav.js-repo-nav",
  ".js-pjax-loader-bar",
];

export function cleanScrapedPage(root: Element, extraSelectors: readonly string[] = []): void {
  for (const sel of [...PAGE_CHROME, ...extraSelectors]) root.querySelectorAll(sel).forEach((n) => n.remove());
  // react hydration error panels render as "Uh oh!" blocks once github's js is blocked
  for (const node of Array.from(root.querySelectorAll("div, section"))) {
    const text = (node.textContent || "").trim();
    if (text.startsWith("Uh oh!") && text.includes("error") && node.children.length < 10) node.remove();
  }
  sanitizeTree(root);
}
