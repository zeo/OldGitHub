import assert from "node:assert/strict";
import test from "node:test";
import { relativeTime } from "../src/util/time.ts";

const now = new Date("2026-06-01T00:00:00Z");
const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();

test("relativeTime promotes a rounded-up unit to the next one", () => {
  assert.equal(relativeTime(ago(360), now), "1 year ago");
  assert.equal(relativeTime(ago(340), now), "11 months ago");
  assert.equal(relativeTime(ago(6.6), now), "1 week ago");
  assert.equal(relativeTime(ago(400), now), "1 year ago");
});

test("relativeTime handles future and invalid dates", () => {
  assert.equal(relativeTime(new Date(now.getTime() + 3 * 3_600_000).toISOString(), now), "in 3 hours");
  assert.equal(relativeTime("not a date", now), "");
});
