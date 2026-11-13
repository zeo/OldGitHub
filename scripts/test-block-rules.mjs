import assert from "node:assert/strict";
import test from "node:test";
import { blockRules } from "../src/background/block-rules.ts";

test("no tabs means no rules, since an empty tabIds list is invalid", () => {
  assert.deepEqual(blockRules([]), []);
});

test("tab ids in the hundreds of millions still get the fixed rules", () => {
  const rules = blockRules([622509331]);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  assert.deepEqual(rules.map((r) => r.condition.resourceTypes), [["stylesheet"], ["script"]]);
  for (const r of rules) {
    assert.equal(r.action.type, "block");
    assert.equal(r.condition.urlFilter, "||github.githubassets.com/assets/");
    assert.deepEqual(r.condition.tabIds, [622509331]);
    assert.deepEqual(r.condition.initiatorDomains, ["github.com"]);
  }
});

test("tab ids come out sorted and unique", () => {
  assert.deepEqual(blockRules([9, 3, 9, 1])[0].condition.tabIds, [1, 3, 9]);
});
