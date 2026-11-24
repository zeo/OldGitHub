import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";

const loadedLanguages = new Set<string>();
const inflight = new Map<string, Promise<void>>();

const HLJS_LANG_LOADERS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  java: () => import("highlight.js/lib/languages/java"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  scala: () => import("highlight.js/lib/languages/scala"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  objectivec: () => import("highlight.js/lib/languages/objectivec"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  swift: () => import("highlight.js/lib/languages/swift"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  php: () => import("highlight.js/lib/languages/php"),
  perl: () => import("highlight.js/lib/languages/perl"),
  lua: () => import("highlight.js/lib/languages/lua"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  less: () => import("highlight.js/lib/languages/less"),
  json: () => import("highlight.js/lib/languages/json"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  bash: () => import("highlight.js/lib/languages/bash"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  sql: () => import("highlight.js/lib/languages/sql"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  diff: () => import("highlight.js/lib/languages/diff"),
  vim: () => import("highlight.js/lib/languages/vim"),
};

const GH_TO_HLJS: Record<string, string> = {
  "javascript": "javascript",
  "typescript": "typescript",
  "jsx": "javascript",
  "tsx": "typescript",
  "python": "python",
  "java": "java",
  "kotlin": "kotlin",
  "scala": "scala",
  "c": "c",
  "c++": "cpp",
  "cpp": "cpp",
  "objective-c": "objectivec",
  "objectivec": "objectivec",
  "c#": "csharp",
  "csharp": "csharp",
  "rust": "rust",
  "go": "go",
  "swift": "swift",
  "ruby": "ruby",
  "php": "php",
  "perl": "perl",
  "lua": "lua",
  "html": "xml",
  "xml": "xml",
  "svg": "xml",
  "css": "css",
  "scss": "scss",
  "sass": "scss",
  "less": "less",
  "json": "json",
  "json5": "json",
  "yaml": "yaml",
  "yml": "yaml",
  "toml": "ini",
  "ini": "ini",
  "markdown": "markdown",
  "md": "markdown",
  "shell": "bash",
  "bash": "bash",
  "sh": "bash",
  "zsh": "bash",
  "powershell": "powershell",
  "sql": "sql",
  "dockerfile": "dockerfile",
  "makefile": "makefile",
  "diff": "diff",
  "patch": "diff",
  "vim script": "vim",
  "vim": "vim",
};

export type Highlighted = {
  lines: string[];
  language: string;
};

export async function highlightFile(text: string, ghLanguage: string | null): Promise<Highlighted | null> {
  const id = resolveHljsId(ghLanguage);
  if (!id) return null;
  const html = await highlightWith(text, id);
  if (html == null) return null;
  return { lines: splitLines(html), language: id };
}

function resolveHljsId(ghLanguage: string | null): string | null {
  if (!ghLanguage) return null;
  return GH_TO_HLJS[ghLanguage.toLowerCase()] ?? null;
}

async function highlightWith(text: string, id: string): Promise<string | null> {
  await ensureRegistered(id);
  if (!loadedLanguages.has(id)) return null;
  try {
    const result = hljs.highlight(text, { language: id, ignoreIllegals: true });
    return result.value;
  } catch {
    return null;
  }
}

async function ensureRegistered(id: string): Promise<void> {
  if (loadedLanguages.has(id)) return;
  const existing = inflight.get(id);
  if (existing) {
    await existing;
    return;
  }
  const loader = HLJS_LANG_LOADERS[id];
  if (!loader) return;
  const promise = loader().then(
    (mod) => {
      hljs.registerLanguage(id, mod.default);
      loadedLanguages.add(id);
    },
    () => {
      inflight.delete(id);
    },
  );
  inflight.set(id, promise);
  await promise;
}

function splitLines(html: string): string[] {
  return splitOnNewlinesPreservingSpans(html);
}

function splitOnNewlinesPreservingSpans(html: string): string[] {
  const lines: string[] = [];
  const openStack: string[] = [];
  let current = "";
  let i = 0;

  const flush = (): void => {
    const closing = openStack.map(() => "</span>").join("");
    const reopen = openStack.join("");
    lines.push(current + closing);
    current = reopen;
  };

  while (i < html.length) {
    const ch = html[i]!;
    if (ch === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        current += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("<span")) {
        openStack.push(tag);
      } else if (tag.startsWith("</span")) {
        openStack.pop();
      }
      current += tag;
      i = end + 1;
      continue;
    }
    if (ch === "\n") {
      flush();
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  lines.push(current);
  return lines;
}
