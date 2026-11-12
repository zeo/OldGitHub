import assert from "node:assert/strict";
import test from "node:test";
import { matchPath, rankPaths } from "../src/util/fuzzy.ts";

test("matchPath keeps hits in the file name when it can", () => {
  const m = matchPath("index", "src/views/index.ts");
  assert.deepEqual(m.hits, [10, 11, 12, 13, 14]);
  assert.equal(m.gaps, 0);
  assert.equal(m.inName, true);
  assert.equal(matchPath("xyz", "src/views/index.ts"), null);
  assert.ok(matchPath("SVI", "src/views/index.ts"));
});

test("rankPaths puts file name matches first, then tighter, then shorter", () => {
  const paths = ["docs/router/notes.md", "src/router/index.ts", "src/router.ts", "scripts/test-router.mjs"];
  assert.deepEqual(rankPaths("router", paths, 10).map((m) => m.path), ["src/router.ts", "scripts/test-router.mjs", "src/router/index.ts", "docs/router/notes.md"]);
  assert.equal(rankPaths("", paths, 2).length, 2);
});

test("rankPaths prefers a contiguous file name match over a stray extension letter", () => {
  const paths = ["src/a/simpleFindWidget.css", "src/b/findWidget.ts", "src/b/findWidget.css", "src/find/widget.ts"];
  assert.deepEqual(rankPaths("findwidget", paths, 10).map((m) => m.path), ["src/b/findWidget.ts", "src/b/findWidget.css", "src/a/simpleFindWidget.css", "src/find/widget.ts"]);
});
