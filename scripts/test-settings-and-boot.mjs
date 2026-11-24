import assert from "node:assert/strict";
import test from "node:test";
import { withDom } from "./dom-helper.mjs";
import { mountAccountSettings } from "../src/views/account-settings.ts";
import { mountRepoSettings } from "../src/views/repo-settings.ts";
import { reloadOnce, reportIssueUrl } from "../src/native-mode.ts";
import { applyTheme } from "../src/theme.ts";

test("mountAccountSettings preserves query ?, hardens dialogs, toggles, menus, and form origins", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; });

  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(`
      <html><body><main>
        <div class="Layout-main">
          <form data-autosubmit="true" action="/settings/notifications">
            <input type="checkbox" checked>
          </form>
          <action-menu data-dynamic-label="true" data-dynamic-label-prefix="Theme">
            <span class="Button-label">Pick</span>
            <li aria-checked="true"><span class="ActionListItem-label">Dark</span></li>
          </action-menu>
          <form id="bad-form" action="https://evil.example/steal" method="post">
            <button type="submit">Send</button>
          </form>
          <dialog>
            <form id="danger-form" action="/settings/delete" method="post">
              <button>Delete account</button>
            </form>
          </dialog>
        </div>
      </main></body></html>
    `);
  };

  await mountAccountSettings("/settings/tokens", "page=2");
  assert.equal(requestedUrl, "https://github.com/settings/tokens?page=2");

  const autosaveCheckbox = document.querySelector("form[data-autosubmit] input[type='checkbox']");
  assert.equal(autosaveCheckbox?.disabled, true);
  assert.ok(document.querySelector(".oldgh-account-settings__native .flash"));
  assert.equal(document.querySelector(".Button-label")?.textContent, "Theme: Dark");

  // cross-origin form action is stripped during sanitization and also blocked at submit time
  const badForm = document.querySelector("#bad-form");
  assert.equal(badForm?.hasAttribute("action"), false);
  badForm?.setAttribute("action", "https://evil.example/dynamic");
  let badNativeSubmitted = false;
  badForm?.addEventListener("submit", (e) => { if (!e.defaultPrevented) badNativeSubmitted = true; });
  badForm?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(badNativeSubmitted, false);

  // dialog promoted inline with two-step arming on button:not([type]) and submit
  const dangerForm = document.querySelector("#danger-form");
  const dangerBtn = dangerForm?.querySelector("button");
  assert.ok(dangerBtn);
  assert.equal(document.querySelector("dialog"), null);
  assert.ok(document.querySelector(".oldgh-account-settings__exposed-dialog"));

  dangerBtn.click();
  assert.equal(dangerBtn.dataset["oldghArmed"], "1");
  assert.match(dangerBtn.textContent ?? "", /^Yes, delete account/);

  // disarm and verify capture-phase Enter submit interception
  dangerBtn.removeAttribute("data-oldgh-armed");
  dangerForm?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(dangerBtn.dataset["oldghArmed"], "1");
});

test("mountRepoSettings disables autosave toggles, fills menus, and binds triggers once", async (t) => {
  t.after(withDom());
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; });

  globalThis.fetch = async () => new Response(`
    <html><body><main>
      <div class="Layout-main">
        <form data-autosubmit="true" action="/octocat/app/settings">
          <input type="checkbox">
        </form>
        <action-menu data-dynamic-label="true">
          <span class="Button-label"></span>
          <li aria-checked="true"><span class="ActionListItem-label">Main</span></li>
        </action-menu>
        <dialog data-new-visibility="private"></dialog>
        <button type="button" data-show-dialog-id="vis">Change visibility</button>
      </div>
    </main></body></html>
  `);

  await mountRepoSettings("octocat", "app", "/settings");
  const checkbox = document.querySelector("form[data-autosubmit] input[type='checkbox']");
  assert.equal(checkbox?.disabled, true);
  assert.equal(document.querySelector(".Button-label")?.textContent, "Main");
});

test("native-mode reportIssueUrl redacts queries and private repos, and reloadOnce resists blocked storage", (t) => {
  t.after(withDom("<!doctype html><html><body></body></html>", "https://github.com/octocat/secret?token=abc#L1"));

  assert.equal(reportIssueUrl("failed at https://github.com/octocat/secret?a=1").includes("token=abc"), false);
  assert.equal(reportIssueUrl("detail").includes("https%3A%2F%2Fgithub.com%2Foctocat%2Fsecret"), true);

  const header = document.createElement("div");
  header.className = "oldgh-repo-header";
  header.setAttribute("data-oldgh-private", "true");
  document.body.append(header);
  const privateReport = reportIssueUrl();
  assert.equal(privateReport.includes("secret"), false);
  assert.equal(privateReport.includes("private+repository"), true);

  // storage failure returns false cleanly instead of reload looping
  const prevStorage = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => {},
    },
  });
  t.after(() => Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: prevStorage }));
  assert.equal(reloadOnce(), false);
});

test("theme applyTheme applies effective theme, caches value, and returns theme", async (t) => {
  t.after(withDom());
  const prevChrome = globalThis.chrome;
  t.after(() => {
    if (prevChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = prevChrome;
  });
  globalThis.chrome = {
    storage: {
      sync: { get: async () => ({ theme: "dark" }) },
      onChanged: { addListener() {} },
    },
  };

  const applied = await applyTheme();
  assert.equal(applied, "dark");
  assert.equal(document.documentElement.getAttribute("data-oldgh-theme"), "dark");
  assert.equal(localStorage.getItem("oldgh:theme-cache"), "dark");
});
