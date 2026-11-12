import assert from "node:assert/strict";
import test from "node:test";
import { getReviewThreads } from "../src/adapters/repo-issue.ts";

const comment = (id, extra) => ({
  id,
  user: { login: `user${id}`, avatar_url: `https://avatars.example/${id}` },
  body_html: `<p>c${id}</p>`,
  created_at: "2026-01-01T00:00:00Z",
  path: "src/a.ts",
  side: "RIGHT",
  diff_hunk: "@@ -1,2 +1,3 @@\n a\n+b",
  pull_request_review_id: 7,
  ...extra,
});

test("groups replies under the comment that started the thread", async () => {
  globalThis.fetch = async () => Response.json([
    comment(1, { line: 2 }),
    comment(2, { line: null, side: "LEFT", path: "src/b.ts", pull_request_review_id: 8 }),
    comment(3, { in_reply_to_id: 1, pull_request_review_id: 9 }),
  ]);
  const threads = await getReviewThreads("octocat", "hello", 1);
  assert.equal(threads.length, 2);
  assert.deepEqual(threads[0].comments.map((c) => c.id), [1, 3]);
  assert.equal(threads[0].reviewId, 7);
  assert.equal(threads[0].outdated, false);
  assert.equal(threads[1].outdated, true);
  assert.equal(threads[1].side, "LEFT");
  assert.equal(threads[1].path, "src/b.ts");
});
