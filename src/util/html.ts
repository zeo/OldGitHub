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

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// browsers drop ascii whitespace and control characters before reading the scheme, so "java\tscript:" still runs
export function isSafeUrl(url: string): boolean {
  let cleaned = "";
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) cleaned += url[i]!;
  }
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(cleaned);
  return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]!);
}

export function safeHref(url: string): string {
  return isSafeUrl(url) ? url : "#";
}

export function safeAttrHref(url: string): string {
  return escapeAttr(safeHref(url));
}

export function safeHexColor(hex: string): string | null {
  const trimmed = hex.trim();
  const short = /^#?([\da-f]{3})$/i.exec(trimmed);
  if (short?.[1]) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const full = /^#?([\da-f]{6})$/i.exec(trimmed);
  return full?.[1] ? `#${full[1]}` : null;
}

export function safeCssColor(val: string): string | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^(?:rgb|hsl)a?\(\s*[\d.\s%,/]+\)$/i.test(trimmed)) return trimmed;
  if (/^var\(--[a-z\d-]+\)$/i.test(trimmed)) return trimmed;
  return null;
}

export function labelTextColor(hex: string): string {
  const safe = safeHexColor(hex);
  if (!safe) return "#fff";
  const n = parseInt(safe.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#333" : "#fff";
}

// convert absolute github.com links to relative paths without ever turning "https://github.com//evil" into protocol-relative "//evil"
export function relativizeGithubUrl(href: string): string {
  if (!/^https?:\/\/github\.com(?:\/|$)/i.test(href)) return href;
  try {
    const u = new URL(href);
    if (u.origin !== "https://github.com" || u.pathname.startsWith("//")) return "#";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "#";
  }
}

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

function sanitizeSrcset(value: string): string | null {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const safe: string[] = [];
  for (const part of parts) {
    const [url, descriptor] = part.split(/\s+/, 2);
    if (!url || !isSafeUrl(url)) return null;
    safe.push(descriptor ? `${url} ${descriptor}` : url);
  }
  return safe.join(", ");
}

function sanitizeStyleValue(value: string): string | null {
  if (/url\s*\(|expression\s*\(|@import|-moz-binding|behavior\s*:/i.test(value)) return null;
  return value;
}

const ALLOWED_HTML_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code",
  "col", "colgroup", "data", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "g-emoji", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol", "p", "picture",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "source",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
]);

const ALLOWED_HTML_ATTRS = new Set([
  "align", "alt", "checked", "cite", "class", "colspan", "data-lang", "data-line",
  "datetime", "decoding", "dir", "disabled", "headers", "height", "href", "id",
  "lang", "loading", "media", "name", "open", "rel", "reversed", "role",
  "rowspan", "scope", "src", "srcset", "start", "tabindex", "target", "title",
  "type", "valign", "width",
]);

// strict allowlist for untrusted markdown, issue/pr bodies, readme, wiki, and hovercard html
export function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const el of Array.from(template.content.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === "input") {
      if (el.getAttribute("type")?.toLowerCase() !== "checkbox" || !el.hasAttribute("disabled")) {
        el.remove();
        continue;
      }
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("data-oldgh-") || name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (!ALLOWED_HTML_ATTRS.has(name) && !name.startsWith("aria-")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href") {
        if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
        else {
          const rel = relativizeGithubUrl(attr.value);
          if (rel !== attr.value) el.setAttribute(attr.name, rel);
        }
      } else if (name === "src") {
        const inlineImage = tag === "img" && SAFE_DATA_IMAGE.test(attr.value);
        if (!inlineImage && !isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      } else if (name === "srcset") {
        const clean = sanitizeSrcset(attr.value);
        if (clean === null) el.removeAttribute(attr.name);
        else if (clean !== attr.value) el.setAttribute(attr.name, clean);
      }
    }
  }
  return template.innerHTML;
}

const DROP_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "link", "meta", "noscript", "template", "foreignobject",
  "noembed", "noframes", "xmp", "use",
  "animate", "animatemotion", "animatetransform", "set",
]);
const URL_ATTRS = new Set(["href", "xlink:href", "src", "poster", "action", "formaction"]);

// scraped github chrome/settings/contribution fragments need interactive controls and svg icons, so filter aggressively without dropping forms
export function sanitizeTree(root: Element | DocumentFragment): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name.startsWith("data-oldgh-") || name === "srcdoc" || name === "ping") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        if (sanitizeStyleValue(attr.value) === null) el.removeAttribute(attr.name);
        continue;
      }
      if (name === "srcset") {
        const clean = sanitizeSrcset(attr.value);
        if (clean === null) el.removeAttribute(attr.name);
        else if (clean !== attr.value) el.setAttribute(attr.name, clean);
        continue;
      }
      if (URL_ATTRS.has(name)) {
        const inlineImage = name === "src" && tag === "img" && SAFE_DATA_IMAGE.test(attr.value);
        if (!inlineImage && !isSafeUrl(attr.value)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === "action" || name === "formaction") {
          try {
            if (new URL(attr.value, "https://github.com").origin !== "https://github.com") {
              el.removeAttribute(attr.name);
            }
          } catch {
            el.removeAttribute(attr.name);
          }
        }
      }
    }
    const href = el.getAttribute("href");
    if (href) {
      const rel = relativizeGithubUrl(href);
      if (rel !== href) el.setAttribute("href", rel);
    }
  }
}

export function sanitizeScrapedFragment(html: string): string {
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
  const selector = [...PAGE_CHROME, ...extraSelectors].join(", ");
  if (selector) root.querySelectorAll(selector).forEach((n) => n.remove());
  // react hydration error panels render as "Uh oh!" blocks once github's js is blocked
  for (const node of Array.from(root.querySelectorAll("div, section"))) {
    if (node.children.length >= 10) continue;
    const text = (node.textContent || "").trim();
    if (text.startsWith("Uh oh!") && text.includes("error")) node.remove();
  }
  sanitizeTree(root);
}

// github asks data-confirm questions from its own js, which never runs on scraped pages
export function askDataConfirm(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const control = (e.target as Element | null)?.closest<HTMLElement>("[data-confirm]");
    if (!control || window.confirm(control.dataset["confirm"] ?? "")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}
