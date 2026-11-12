export type DiffLine =
  | { kind: "context"; old: number; new: number; text: string }
  | { kind: "add"; new: number; text: string }
  | { kind: "del"; old: number; text: string }
  | { kind: "no-newline"; text: string };

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  oldPath: string;
  newPath: string;
  status: "added" | "deleted" | "modified" | "renamed" | "binary";
  oldMode: string | null;
  newMode: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  binaryNote: string | null;
};

type Counts = { additions: number; deletions: number };

export function parseUnifiedDiff(raw: string): DiffFile[] {
  const lines = raw.split(/\r?\n/);
  const files: DiffFile[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.startsWith("diff --git ")) {
      i++;
      continue;
    }
    const header = parseFileHeader(lines, i);
    const body = readHunks(lines, header.next, header.entry);
    header.entry.hunks = body.hunks;
    files.push(header.entry);
    i = body.next;
  }
  return files;
}

// a bare patch as the REST API returns it: hunks only, no file header
export function parsePatch(patch: string): DiffHunk[] {
  return readHunks(patch.split(/\r?\n/), 0, { additions: 0, deletions: 0 }).hunks;
}

function parseFileHeader(lines: string[], start: number): { entry: DiffFile; next: number } {
  const [oldPath, newPath] = splitGitPaths(lines[start]!.slice("diff --git ".length));
  const entry: DiffFile = {
    path: "",
    oldPath,
    newPath,
    status: "modified",
    oldMode: null,
    newMode: null,
    hunks: [],
    additions: 0,
    deletions: 0,
    isBinary: false,
    binaryNote: null,
  };

  let i = start + 1;
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("@@") || l.startsWith("diff --git ")) break;
    if (l.startsWith("new file mode ")) {
      entry.status = "added";
      entry.newMode = l.slice("new file mode ".length).trim();
    } else if (l.startsWith("deleted file mode ")) {
      entry.status = "deleted";
      entry.oldMode = l.slice("deleted file mode ".length).trim();
    } else if (l.startsWith("rename from ")) {
      entry.status = "renamed";
      entry.oldPath = readPath(l.slice("rename from ".length));
    } else if (l.startsWith("rename to ")) {
      entry.newPath = readPath(l.slice("rename to ".length));
    } else if (l.startsWith("Binary files ")) {
      entry.status = "binary";
      entry.isBinary = true;
      entry.binaryNote = l;
    } else if (l.startsWith("--- ")) {
      const path = headerPath(l, "a/");
      if (path === null) entry.status = "added";
      else entry.oldPath = path;
    } else if (l.startsWith("+++ ")) {
      const path = headerPath(l, "b/");
      if (path === null) entry.status = "deleted";
      else entry.newPath = path;
    }
  }
  entry.path = entry.status === "deleted" ? entry.oldPath || entry.newPath : entry.newPath || entry.oldPath;
  return { entry, next: i };
}

function readHunks(lines: string[], start: number, counts: Counts): { hunks: DiffHunk[]; next: number } {
  const hunks: DiffHunk[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("diff --git ")) break;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    i++;
    if (!m) continue;
    const hunk: DiffHunk = {
      oldStart: Number(m[1]),
      oldLines: m[2] != null ? Number(m[2]) : 1,
      newStart: Number(m[3]),
      newLines: m[4] != null ? Number(m[4]) : 1,
      header: (m[5] ?? "").trim(),
      lines: [],
    };
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    // the header's line counts end the hunk, so content like "--- x" or a trailing newline is never misread
    let oldLeft = hunk.oldLines;
    let newLeft = hunk.newLines;
    for (; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.startsWith("\\")) {
        hunk.lines.push({ kind: "no-newline", text: l });
        continue;
      }
      if (oldLeft <= 0 && newLeft <= 0) break;
      const prefix = l[0];
      const text = l.slice(1);
      if (prefix === "+") {
        hunk.lines.push({ kind: "add", new: newNo++, text });
        newLeft--;
        counts.additions++;
      } else if (prefix === "-") {
        hunk.lines.push({ kind: "del", old: oldNo++, text });
        oldLeft--;
        counts.deletions++;
      } else if (prefix === " " || l === "") {
        hunk.lines.push({ kind: "context", old: oldNo++, new: newNo++, text });
        oldLeft--;
        newLeft--;
      } else {
        break;
      }
    }
    hunks.push(hunk);
  }
  return { hunks, next: i };
}

const QUOTED_PATH = /^"(?:[^"\\]|\\.)*"/;

function splitGitPaths(rest: string): [string, string] {
  const quoted = QUOTED_PATH.exec(rest);
  if (quoted) {
    return [stripPrefix(unquote(quoted[0]), "a/"), stripPrefix(readPath(rest.slice(quoted[0].length + 1)), "b/")];
  }
  const quotedNew = rest.lastIndexOf(' "b/');
  if (rest.endsWith('"') && quotedNew > 0) {
    return [stripPrefix(rest.slice(0, quotedNew), "a/"), stripPrefix(unquote(rest.slice(quotedNew + 1)), "b/")];
  }
  // unquoted names may contain spaces; when both sides match, the split is exactly in the middle
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === " " && rest.slice(2, mid) === rest.slice(mid + 3)) {
    return [stripPrefix(rest.slice(0, mid), "a/"), stripPrefix(rest.slice(mid + 1), "b/")];
  }
  const m = /^(.+?) (b\/.+)$/.exec(rest);
  return m ? [stripPrefix(m[1]!, "a/"), stripPrefix(m[2]!, "b/")] : [stripPrefix(rest, "a/"), stripPrefix(rest, "a/")];
}

// git appends a tab to ---/+++ names that contain spaces
function headerPath(line: string, prefix: string): string | null {
  const value = line.slice(4).replace(/\t$/, "");
  return value === "/dev/null" ? null : stripPrefix(readPath(value), prefix);
}

function readPath(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? unquote(value) : value;
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

// git c-quotes unusual names, writing non-ascii as octal utf-8 bytes
function unquote(token: string): string {
  const chars = Array.from(token.slice(1, -1));
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c !== "\\") {
      bytes.push(...encoder.encode(c));
      continue;
    }
    const next = chars[++i] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(chars.slice(i, i + 3).join(""), 8));
      i += 2;
    } else {
      bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
