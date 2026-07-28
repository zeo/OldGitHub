import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/router/resolve.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const resolver = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const { isFullyCoveredUrl, resolveRoute } = resolver;

const routedPages = [
  ["/", "", "top-level"],
  ["/search", "q=old+github", "top-level"],
  ["/topics/typescript", "", "top-level"],
  ["/collections/pixel-art-tools", "", "top-level"],
  ["/octocat", "", "profile"],
  ["/octocat/Hello-World", "", "repo-home"],
  ["/octocat/Hello-World/tree/main/src", "", "repo-tree"],
  ["/octocat/Hello-World/blob/main/README.md", "", "repo-blob"],
  ["/octocat/Hello-World/commits", "author=octocat", "repo-commits"],
  ["/octocat/Hello-World/commits/main", "", "repo-commits"],
  ["/octocat/Hello-World/commit/abc123", "", "repo-commit"],
  ["/octocat/Hello-World/compare/main...topic", "", "repo-compare"],
  ["/octocat/Hello-World/issues", "q=is%3Aopen", "repo-issues"],
  ["/octocat/Hello-World/pull/42/files", "", "repo-issue"],
  ["/octocat/Hello-World/wiki/Install", "", "repo-wiki"],
  ["/octocat/Hello-World/actions", "", "repo-actions"],
  ["/octocat/Hello-World/actions/runs/123", "", "repo-actions-run"],
  ["/octocat/Hello-World/graphs/contributors", "", "repo-graphs"],
  ["/octocat/Hello-World/security/advisories", "", "repo-security"],
  ["/octocat/Hello-World/discussions/7", "", "repo-discussion"],
  ["/octocat/Hello-World/settings/branches", "", "repo-settings"],
  ["/octocat/Hello-World/releases", "", "repo-other"],
];

test("routes supported pages to their renderer", () => {
  for (const [pathname, search, kind] of routedPages) {
    assert.equal(resolveRoute(pathname, search).kind, kind, pathname);
    assert.equal(isFullyCoveredUrl(pathname, search), true, pathname);
  }
});

test("keeps interactive and embedded pages native", () => {
  const nativePages = [
    "/new",
    "/login",
    "/codespaces",
    "/mobile",
    "/education",
    "/open-source/sponsors",
    "/octocat/Hello-World/issues/new",
    "/octocat/Hello-World/compare/main",
    "/octocat/Hello-World/releases/new",
    "/octocat/Hello-World/fork",
    "/octocat/Hello-World/wiki/_edit",
    "/octocat/Hello-World/community/license/new",
    "/octocat/Hello-World/network/dependencies",
    "/octocat/Hello-World/projects/1",
    "/octocat/Hello-World/security/policy",
  ];
  for (const pathname of nativePages) {
    assert.equal(resolveRoute(pathname, "").kind, "out-of-scope", pathname);
    assert.equal(isFullyCoveredUrl(pathname, ""), false, pathname);
  }
});

test("preserves route details used by views", () => {
  assert.deepEqual(resolveRoute("/octocat/Hello-World/commits", "author=octocat"), {
    kind: "repo-commits",
    owner: "octocat",
    repo: "Hello-World",
    refAndPath: "",
    query: "author=octocat",
  });
  assert.equal(resolveRoute("/octocat", "tab=packages").tab, "packages");
  assert.equal(resolveRoute("/octocat/Hello-World/pull/42/changes", "").tab, "files");
  assert.equal(resolveRoute("/octocat/Hello-World/actions/workflows/ci.yml", "page=2").workflowPath, "ci.yml");
});
