import assert from "node:assert/strict";
import test from "node:test";
import * as session from "../src/auth/session.ts";

function setDocument(t, cookie, login) {
  const prev = globalThis.document;
  t.after(() => {
    if (prev === undefined) delete globalThis.document;
    else globalThis.document = prev;
  });
  globalThis.document = {
    cookie,
    querySelector: () => login === null ? null : { content: login },
  };
}

test("does not treat GitHub's empty user-login meta as a session", (t) => {
  setDocument(t, "_octo=visitor", "");
  assert.equal(session.isLoggedIn(), false);
  assert.equal(session.currentUserLogin(), null);
});

test("recognizes signed-in cookies and non-empty login metadata", (t) => {
  setDocument(t, "logged_in=yes", "");
  assert.equal(session.isLoggedIn(), true);

  setDocument(t, "dotcom_user=octocat", "");
  assert.equal(session.isLoggedIn(), true);
  assert.equal(session.currentUserLogin(), "octocat");

  setDocument(t, "", " hubot ");
  assert.equal(session.isLoggedIn(), true);
  assert.equal(session.currentUserLogin(), "hubot");
});
