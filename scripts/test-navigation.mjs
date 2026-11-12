import assert from "node:assert/strict";
import test from "node:test";
import { AdapterFailure } from "@/adapters";
import { adoptBodyRoot, beginNavigation, isCurrentNavigation, navigationToken } from "@/views/_body";

test("a view that started before a newer navigation cannot adopt the body", () => {
  const first = beginNavigation();
  const captured = navigationToken();
  assert.equal(captured, first);
  const second = beginNavigation();
  assert.equal(isCurrentNavigation(first), false);
  assert.equal(isCurrentNavigation(second), true);
  assert.equal(adoptBodyRoot({}, undefined, captured), false);
});

test("adapter failures expose the http status from their message", () => {
  assert.equal(new AdapterFailure("getRepoTree", "o/r/tree/main responded 404").status, 404);
  assert.equal(new AdapterFailure("search", "rate-limited (search/code responded 403)").status, 403);
  assert.equal(new AdapterFailure("getRepoTree", "missing refInfo.name or path").status, null);
});
