import { octicon } from "@/icons";
import { adoptBodyRoot, navigationToken } from "./_body";
import { escapeAttr, escapeText, cleanScrapedPage } from "@/util/html";

const ROOT_CLASS = "oldgh-repo-settings";

type SidebarItem = {
  key: string;
  label: string;
  icon: string;
  path: string;
};

type SidebarGroup = {
  label: string | null;
  items: SidebarItem[];
};

function buildSidebar(owner: string, repo: string): SidebarGroup[] {
  const base = `/${owner}/${repo}/settings`;
  return [
    {
      label: null,
      items: [
        { key: "general", label: "General", icon: "gear", path: base },
      ],
    },
    {
      label: "Access",
      items: [
        { key: "access", label: "Collaborators", icon: "person", path: `${base}/access` },
      ],
    },
    {
      label: "Code and automation",
      items: [
        { key: "branches", label: "Branches", icon: "git-branch", path: `${base}/branches` },
        { key: "rules", label: "Rules", icon: "law", path: `${base}/rules` },
        { key: "actions", label: "Actions", icon: "play", path: `${base}/actions` },
        { key: "webhooks", label: "Webhooks", icon: "broadcast", path: `${base}/hooks` },
        { key: "environments", label: "Environments", icon: "server", path: `${base}/environments` },
        { key: "pages", label: "Pages", icon: "book", path: `${base}/pages` },
      ],
    },
    {
      label: "Security",
      items: [
        { key: "security_analysis", label: "Code security", icon: "shield", path: `${base}/security_analysis` },
        { key: "keys", label: "Deploy keys", icon: "key", path: `${base}/keys` },
        { key: "secrets", label: "Secrets and variables", icon: "lock", path: `${base}/secrets/actions` },
      ],
    },
    {
      label: "Integrations",
      items: [
        { key: "installations", label: "GitHub Apps", icon: "package", path: `${base}/installations` },
        { key: "notifications", label: "Email notifications", icon: "mail", path: `${base}/notifications` },
        { key: "autolink", label: "Autolink references", icon: "link", path: `${base}/key_links` },
      ],
    },
  ];
}

function activeKeyFor(subPath: string): string {
  // subPath is "/settings", "/settings/branches", "/settings/secrets/actions" etc.
  const after = subPath.replace(/^\/settings/, "").replace(/^\//, "");
  if (!after) return "general";
  const first = after.split("/")[0] || "";
  switch (first) {
    case "access": case "collaboration": return "access";
    case "branches": return "branches";
    // github folded tag protection into rules
    case "tag_protection": case "tags": return "rules";
    case "rules": case "rule": return "rules";
    case "actions": return "actions";
    case "hooks": return "webhooks";
    case "environments": return "environments";
    case "pages": return "pages";
    case "security_analysis": return "security_analysis";
    case "keys": return "keys";
    case "secrets": case "variables": return "secrets";
    case "installations": case "apps": return "installations";
    case "notifications": return "notifications";
    case "key_links": case "autolink": return "autolink";
    default: return "general";
  }
}

export async function mountRepoSettings(owner: string, repo: string, subPath: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  const activeKey = activeKeyFor(subPath);
  root.innerHTML = renderShell(owner, repo, activeKey);
  if (!adoptBodyRoot(root, ".oldgh-repo-header", nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-settings__main");
  if (!main) return;

  try {
    const html = await fetchSettingsPage(owner, repo, subPath);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const native = extractMainContent(doc);
    if (!native) {
      main.innerHTML = `<div class="oldgh-settings__empty">Couldn't find settings content.</div>`;
      return;
    }
    cleanScrapedContent(native);
    main.innerHTML = `<div class="oldgh-settings__native">${native.innerHTML}</div>`;
    // dialog-helper custom elements that drive Change visibility / Archive /
    // Delete don't fire when injected via innerHTML — wire up native handlers
    // that submit the underlying forms with our own confirmation dialog.
    rewireDialogActions(owner, repo, main);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-settings__empty">Couldn't load settings: ${escapeText(msg)}</div>`;
  }
}

// In the scraped settings DOM, the "Change visibility", "Archive…",
// "Delete this repository" buttons rely on GitHub's <dialog-helper> custom
// element to open a confirmation dialog and submit. That custom element
// doesn't activate when injected via innerHTML (no script context). We
// detect those buttons and bind native click handlers that show a 2013
// confirm dialog and submit the underlying form directly.
function rewireDialogActions(owner: string, repo: string, main: HTMLElement): void {
  for (const dialog of Array.from(main.querySelectorAll<HTMLElement>("dialog[data-new-visibility]"))) {
    const target = dialog.getAttribute("data-new-visibility");
    if (!target) continue;
    const button = findVisibilityTrigger(dialog);
    if (!button) continue;
    button.addEventListener("click", (e) => {
      e.preventDefault();
      void confirmVisibilityChange(owner, repo, target, main);
    }, { capture: true });
  }

  const archiveBtn = findButtonByText(main, /archive this repository/i)
    || findButtonByText(main, /^archive$/i);
  if (archiveBtn && !archiveBtn.dataset["oldghBound"]) {
    archiveBtn.dataset["oldghBound"] = "1";
    archiveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void confirmArchive(owner, repo, main, false);
    }, { capture: true });
  }
  const unarchiveBtn = findButtonByText(main, /unarchive this repository/i)
    || findButtonByText(main, /^unarchive$/i);
  if (unarchiveBtn && !unarchiveBtn.dataset["oldghBound"]) {
    unarchiveBtn.dataset["oldghBound"] = "1";
    unarchiveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void confirmArchive(owner, repo, main, true);
    }, { capture: true });
  }

  const deleteBtn = findButtonByText(main, /^delete this repository$/i);
  if (deleteBtn && !deleteBtn.dataset["oldghBound"]) {
    deleteBtn.dataset["oldghBound"] = "1";
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void confirmDelete(owner, repo, main);
    }, { capture: true });
  }
}

function findVisibilityTrigger(dialog: HTMLElement): HTMLButtonElement | null {
  // The trigger button is rendered as a sibling of the dialog, with text
  // describing the transition (e.g. "I want to make this repository public").
  // It's marked aria-haspopup, type=button, and lives inside the same
  // visibility-related section as the dialog.
  let scope: HTMLElement | null = dialog.parentElement;
  for (let i = 0; i < 4 && scope; i++) {
    for (const btn of Array.from(scope.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]"))) {
      const txt = (btn.textContent || "").toLowerCase();
      if (txt.includes("change visibility") || txt.includes("change repository visibility")) {
        return btn;
      }
    }
    scope = scope.parentElement;
  }
  return null;
}

function findButtonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement | null {
  for (const btn of Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))) {
    const txt = (btn.textContent || "").replace(/\s+/g, " ").trim();
    if (re.test(txt)) return btn;
  }
  return null;
}

async function confirmVisibilityChange(owner: string, repo: string, target: string, main: HTMLElement): Promise<void> {
  const form = main.querySelector<HTMLFormElement>('form[action$="/set_visibility"]');
  if (!form) {
    // selector miss (GitHub markup drifted) — degrade to native instead of a dead click
    window.location.href = `https://github.com/${owner}/${repo}/settings`;
    return;
  }
  const csrf = (form.querySelector<HTMLInputElement>('input[name="authenticity_token"]')?.value) || "";
  const ok = await openConfirmDialog({
    title: `Change visibility to ${target}`,
    body: `Are you sure you want to make <strong>${escapeText(`${owner}/${repo}`)}</strong> ${escapeText(target)}?`,
    confirmLabel: `I want to make this repository ${target}`,
    danger: true,
    verifyText: `${owner}/${repo}`,
  });
  if (!ok) return;
  submitFormDirect(form.action, { authenticity_token: csrf, visibility: target });
}

async function confirmArchive(owner: string, repo: string, main: HTMLElement, unarchive: boolean): Promise<void> {
  const form = main.querySelector<HTMLFormElement>(`form[action$="/settings/${unarchive ? "unarchive" : "archive"}"]`)
    || main.querySelector<HTMLFormElement>('form[action$="/settings/archive"]');
  if (!form) {
    window.location.href = `https://github.com/${owner}/${repo}/settings`;
    return;
  }
  const csrf = (form.querySelector<HTMLInputElement>('input[name="authenticity_token"]')?.value) || "";
  const ok = await openConfirmDialog({
    title: unarchive ? "Unarchive repository" : "Archive repository",
    body: unarchive
      ? `Unarchiving <strong>${escapeText(`${owner}/${repo}`)}</strong> will allow new issues, pull requests, and pushes again.`
      : `Archiving <strong>${escapeText(`${owner}/${repo}`)}</strong> will make it read-only. Type the repository name to confirm.`,
    confirmLabel: unarchive ? "Unarchive this repository" : "I understand, archive this repository",
    danger: true,
    verifyText: `${owner}/${repo}`,
  });
  if (!ok) return;
  submitFormDirect(form.action, { authenticity_token: csrf, verify: `${owner}/${repo}` });
}

async function confirmDelete(owner: string, repo: string, main: HTMLElement): Promise<void> {
  const form = main.querySelector<HTMLFormElement>('form[action$="/settings/delete"]');
  if (!form) {
    window.location.href = `https://github.com/${owner}/${repo}/settings`;
    return;
  }
  const csrf = (form.querySelector<HTMLInputElement>('input[name="authenticity_token"]')?.value) || "";
  const ok = await openConfirmDialog({
    title: "Delete repository",
    body: `This will permanently delete <strong>${escapeText(`${owner}/${repo}`)}</strong>, all its branches, issues, pull requests, releases, and discussions. <strong>This action cannot be undone.</strong> Type the full repository name to confirm.`,
    confirmLabel: "I understand the consequences, delete this repository",
    danger: true,
    verifyText: `${owner}/${repo}`,
  });
  if (!ok) return;
  submitFormDirect(form.action, { authenticity_token: csrf, _method: "delete", verify: `${owner}/${repo}` });
}

// Build a transient form and submit() it so the browser performs the POST
// natively (cookies attached, server response navigates the page). The form
// is added to the document so Chrome accepts the submit; we remove it on
// any abort but in practice the page navigates before that matters.
function submitFormDirect(action: string, fields: Record<string, string>): void {
  // the action comes from scraped markup; never post the csrf token anywhere but github
  if (new URL(action, location.href).origin !== "https://github.com") throw new Error(`refusing to post to ${action}`);
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

type ConfirmOpts = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  verifyText?: string;
};

function openConfirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "oldgh-confirm-overlay";
    const verifyId = `oldgh-confirm-verify-${Math.random().toString(36).slice(2, 8)}`;
    overlay.innerHTML = `
      <div class="oldgh-confirm-dialog ${opts.danger ? "oldgh-confirm-dialog--danger" : ""}" role="dialog" aria-modal="true">
        <h2 class="oldgh-confirm-dialog__title">${escapeText(opts.title)}</h2>
        <div class="oldgh-confirm-dialog__body">${opts.body}</div>
        ${opts.verifyText ? `
          <label class="oldgh-confirm-dialog__label" for="${verifyId}">Type <code>${escapeText(opts.verifyText)}</code> to confirm:</label>
          <input type="text" id="${verifyId}" class="oldgh-confirm-dialog__input" autocomplete="off" autofocus />
        ` : ""}
        <div class="oldgh-confirm-dialog__actions">
          <button type="button" class="oldgh-btn" data-oldgh-cancel>Cancel</button>
          <button type="button" class="oldgh-btn oldgh-btn--danger" data-oldgh-confirm disabled>${escapeText(opts.confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector<HTMLButtonElement>("[data-oldgh-confirm]")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>("[data-oldgh-cancel]")!;
    const verifyInput = overlay.querySelector<HTMLInputElement>(`#${verifyId}`);

    const close = (ok: boolean): void => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(ok);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
    };
    document.addEventListener("keydown", onKey, true);

    const recheck = (): void => {
      if (!verifyInput) { confirmBtn.disabled = false; return; }
      confirmBtn.disabled = verifyInput.value !== opts.verifyText;
    };
    if (verifyInput) {
      verifyInput.addEventListener("input", recheck);
      window.setTimeout(() => verifyInput.focus(), 0);
    } else {
      confirmBtn.disabled = false;
    }
    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

async function fetchSettingsPage(owner: string, repo: string, subPath: string): Promise<string> {
  const url = `https://github.com/${owner}/${repo}${subPath}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) {
    throw new Error(`${url} responded ${resp.status}`);
  }
  return resp.text();
}

function extractMainContent(doc: Document): Element | null {
  const selectors = [
    "main #repo-content-turbo-frame",
    "main .Layout-main",
    "main .application-main",
    "main",
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) return el;
  }
  return null;
}

function cleanScrapedContent(el: Element): void {
  cleanScrapedPage(el, [
    "nav-list",
    // native sidebars / nav we replace with our own
    ".js-repo-settings-sidebar",
    ".SideNav",
    ".Layout-sidebar",
    "nav[aria-label='Settings sidebar']",
    "nav[aria-label='Repo settings sidebar']",
    "nav[aria-label*='settings' i]",
    "nav[item_classes*='repo-menu-item']",
    // per-option ajax save-status badge (loading spinner + success check + error
    // x). github shows one state via css/js we block, so all three leak at once
    ".status-indicator",
  ]);
  // strip elements GitHub keeps in the DOM but hides via JS — without their
  // bundle running, every conditional warning shows at once. avatar /
  // social-preview upload errors, .js-* hide-until-error stubs, [hidden] holdouts
  const hiddenSelectors = [
    // a blanket [hidden] strip is too broad — GitHub keeps real, reachable
    // controls (collapsed sections, dialog bodies, tab panels) behind [hidden]
    // and reveals them via JS we don't run. only strip the error/flash stubs
    "[hidden].js-flash-error",
    "[hidden].flash-error",
    "[hidden][class*='error']",
    ".js-avatar-upload-error",
    ".js-upload-error",
    ".js-upload-image-error",
    ".js-flash-error",
    ".js-conditional-error",
    ".error-message:not(.is-shown)",
    "[data-test-selector*='error']:empty",
  ];
  for (const sel of hiddenSelectors) {
    el.querySelectorAll(sel).forEach((n) => {
      // never strip a hidden node that holds a form/dialog/tabpanel — that's
      // real content GitHub reveals on interaction, not an error stub
      if (n.matches("dialog, [role='tabpanel']") || n.querySelector("form, button[type='submit'], input[type='submit']")) return;
      n.remove();
    });
  }
}

function renderShell(owner: string, repo: string, activeKey: string): string {
  const groups = buildSidebar(owner, repo);
  return `
    <div class="oldgh-page oldgh-settings">
      <header class="oldgh-settings__header">
        <h1>${octicon("gear", { size: 22 })} Settings <span class="oldgh-settings__head-repo">/ ${escapeText(owner)}/${escapeText(repo)}</span></h1>
      </header>
      <div class="oldgh-settings__layout">
        <aside class="oldgh-settings__sidebar">
          ${groups.map((g) => `
            ${g.label ? `<h3 class="oldgh-settings__sidebar-group">${escapeText(g.label)}</h3>` : ""}
            <ul class="oldgh-settings__sidebar-list">
              ${g.items.map((it) => `
                <li class="${activeKey === it.key ? "is-active" : ""}">
                  <a href="${escapeAttr(it.path)}">${octicon(it.icon, { size: 14 })}<span>${escapeText(it.label)}</span></a>
                </li>
              `).join("")}
            </ul>
          `).join("")}
        </aside>
        <main class="oldgh-settings__main">
          <div class="oldgh-settings__loading">Loading settings&hellip;</div>
        </main>
      </div>
    </div>
  `;
}
