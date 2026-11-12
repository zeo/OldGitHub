import assert from "node:assert/strict";
import test from "node:test";
import { getFileList } from "../src/adapters/repo-files.ts";

const page = (oid) => `<script type="application/json">{"refInfo":{"name":"feature/x","listCacheKey":"v0:1","currentOid":"${oid}"}}</script>`;

test("reads the ref from the code page and the paths from tree-list", async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.includes("/tree-list/")) return Response.json({ paths: ["a.ts", "b/c.ts"] });
    return new Response(page("1".repeat(40)));
  };
  const files = await getFileList("octo", "hello", "/octo/hello/tree/feature/x/src");
  assert.deepEqual(files, { ref: "feature/x", paths: ["a.ts", "b/c.ts"] });
  assert.deepEqual(seen, ["https://github.com/octo/hello/tree/feature/x/src", `https://github.com/octo/hello/tree-list/${"1".repeat(40)}`]);
});

test("falls back to the git trees api when tree-list fails", async () => {
  globalThis.fetch = async (url) => {
    if (url.includes("/tree-list/")) return new Response("{}", { status: 404 });
    if (url.startsWith("https://api.github.com/")) {
      return Response.json({ tree: [{ path: "src", type: "tree" }, { path: "src/x.ts", type: "blob" }] });
    }
    return new Response(page("2".repeat(40)));
  };
  const files = await getFileList("octo", "hello", "/octo/hello/blob/feature/x/a.ts");
  assert.deepEqual(files.paths, ["src/x.ts"]);
});

test("reports a page without refInfo", async () => {
  globalThis.fetch = async () => new Response("<html></html>");
  await assert.rejects(getFileList("octo", "hello", "/octo/hello/tree/main"), /no refInfo/);
});
