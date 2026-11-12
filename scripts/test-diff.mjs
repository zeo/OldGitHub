import assert from "node:assert/strict";
import test from "node:test";
import { parsePatch, parseUnifiedDiff } from "../src/util/diff.ts";

const kinds = (hunk) => hunk.lines.map((l) => `${l.kind}:${l.text}`);

test("content lines that look like file headers stay inside the hunk", () => {
  const [file] = parseUnifiedDiff([
    "diff --git a/notes.md b/notes.md",
    "--- a/notes.md",
    "+++ b/notes.md",
    "@@ -1,3 +1,3 @@",
    " intro",
    "--- old rule",
    "+++ new rule",
    " outro",
  ].join("\n"));
  assert.deepEqual(kinds(file.hunks[0]), ["context:intro", "del:-- old rule", "add:++ new rule", "context:outro"]);
  assert.equal(file.additions, 1);
  assert.equal(file.deletions, 1);
});

test("a patch from the api renders +++ and --- content lines", () => {
  const [hunk] = parsePatch("@@ -1,2 +1,2 @@\n----\n++++\n a");
  assert.deepEqual(kinds(hunk), ["del:---", "add:+++", "context:a"]);
});

test("a trailing newline does not add a phantom context row", () => {
  const [hunk] = parsePatch("@@ -1,2 +1,2 @@\n-old\n+new\n same\n");
  assert.equal(hunk.lines.length, 3);
  assert.deepEqual(hunk.lines.at(-1), { kind: "context", old: 2, new: 2, text: "same" });
});

test("the no-newline marker after the last line is kept", () => {
  const [hunk] = parsePatch("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n");
  assert.deepEqual(kinds(hunk), ["del:a", "add:b", "no-newline:\\ No newline at end of file"]);
});

test("an empty context line stripped of its space still counts", () => {
  const [hunk] = parsePatch("@@ -1,3 +1,3 @@\n a\n\n-b\n+c");
  assert.deepEqual(kinds(hunk), ["context:a", "context:", "del:b", "add:c"]);
  assert.equal(hunk.lines[2].old, 3);
});

test("crlf diffs parse hunk headers with section context", () => {
  const [file] = parseUnifiedDiff("diff --git a/x.c b/x.c\r\n--- a/x.c\r\n+++ b/x.c\r\n@@ -10 +10 @@ int main(void)\r\n-return 1;\r\n+return 0;\r\n");
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0].header, "int main(void)");
  assert.deepEqual(kinds(file.hunks[0]), ["del:return 1;", "add:return 0;"]);
});

test("quoted paths are unescaped", () => {
  const [file] = parseUnifiedDiff([
    'diff --git "a/caf\\303\\251 \\"menu\\".txt" "b/caf\\303\\251 \\"menu\\".txt"',
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n"));
  assert.equal(file.path, 'café "menu".txt');
});

test("unquoted paths with spaces keep the whole name", () => {
  const [file] = parseUnifiedDiff("diff --git a/my file b/x.txt b/my file b/x.txt\n@@ -1 +1 @@\n-a\n+b");
  assert.equal(file.path, "my file b/x.txt");
});

test("renames take their paths from the rename lines", () => {
  const [file] = parseUnifiedDiff([
    "diff --git a/old name.txt b/new name.txt",
    "similarity index 90%",
    "rename from old name.txt",
    "rename to new name.txt",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n"));
  assert.equal(file.status, "renamed");
  assert.equal(file.oldPath, "old name.txt");
  assert.equal(file.newPath, "new name.txt");
  assert.equal(file.path, "new name.txt");
});

test("deleted files keep their path from the --- line", () => {
  const [file] = parseUnifiedDiff("diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a");
  assert.equal(file.status, "deleted");
  assert.equal(file.path, "gone.txt");
  assert.equal(file.deletions, 1);
});

test("multiple files and hunks stay separate", () => {
  const files = parseUnifiedDiff([
    "diff --git a/a b/a",
    "@@ -1 +1 @@",
    "-1",
    "+2",
    "@@ -9 +9 @@",
    " z",
    "diff --git a/b b/b",
    "@@ -1 +1,2 @@",
    " k",
    "+l",
    "",
  ].join("\n"));
  assert.deepEqual(files.map((f) => [f.path, f.hunks.length, f.additions, f.deletions]), [["a", 2, 1, 1], ["b", 1, 1, 0]]);
});
