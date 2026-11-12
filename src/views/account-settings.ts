import { octicon } from "@/icons";
import { adoptBodyRoot, removeAllBodyRoots, navigationToken } from "./_body";

const ROOT_CLASS = "oldgh-account-settings";

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

function buildSidebar(): SidebarGroup[] {
  return [
    {
      label: null,
      items: [
        { key: "profile", label: "Public profile", icon: "person", path: "/settings/profile" },
        { key: "account", label: "Account", icon: "gear", path: "/settings/admin" },
        { key: "appearance", label: "Appearance", icon: "paintcan", path: "/settings/appearance" },
        { key: "accessibility", label: "Accessibility", icon: "eye", path: "/settings/accessibility" },
        { key: "notifications", label: "Notifications", icon: "bell", path: "/settings/notifications" },
      ],
    },
    {
      label: "Access",
      items: [
        { key: "billing", label: "Billing and licensing", icon: "credit-card", path: "/settings/billing/payment_information" },
        { key: "emails", label: "Emails", icon: "mail", path: "/settings/emails" },
        { key: "security", label: "Password and authentication", icon: "shield", path: "/settings/security" },
        { key: "sessions", label: "Sessions", icon: "broadcast", path: "/settings/sessions" },
        { key: "keys", label: "SSH and GPG keys", icon: "key", path: "/settings/keys" },
        { key: "organizations", label: "Organizations", icon: "organization", path: "/settings/organizations" },
        { key: "enterprises", label: "Enterprises", icon: "law", path: "/settings/enterprises" },
        { key: "moderation", label: "Moderation", icon: "stop", path: "/settings/interaction_limits" },
      ],
    },
    {
      label: "Code, planning, and automation",
      items: [
        { key: "repositories", label: "Repositories", icon: "repo", path: "/settings/repositories" },
        { key: "codespaces", label: "Codespaces", icon: "terminal", path: "/settings/codespaces" },
        { key: "copilot", label: "Copilot", icon: "hubot", path: "/settings/copilot" },
        { key: "packages", label: "Packages", icon: "package", path: "/settings/packages" },
        { key: "pages", label: "Pages", icon: "book", path: "/settings/pages" },
        { key: "replies", label: "Saved replies", icon: "comment-discussion", path: "/settings/replies" },
      ],
    },
    {
      label: "Integrations",
      items: [
        { key: "applications", label: "Applications", icon: "plug", path: "/settings/apps/authorizations" },
        { key: "developer_settings", label: "Developer settings", icon: "code", path: "/settings/developers" },
      ],
    },
  ];
}

function activeKeyFor(subPath: string): string {
  const after = subPath.replace(/^\/settings/, "").replace(/^\//, "");
  if (!after) return "profile";
  const first = after.split("/")[0] || "";
  switch (first) {
    case "profile": case "": return "profile";
    case "account": case "admin": return "account";
    case "appearance": return "appearance";
    case "accessibility": return "accessibility";
    case "notifications": return "notifications";
    case "billing": return "billing";
    case "emails": return "emails";
    case "security": case "two_factor_authentication": return "security";
    case "sessions": return "sessions";
    case "keys": return "keys";
    case "organizations": return "organizations";
    case "enterprises": return "enterprises";
    case "interaction_limits": case "blocked_users": return "moderation";
    case "repositories": return "repositories";
    case "codespaces": return "codespaces";
    case "copilot": return "copilot";
    case "packages": return "packages";
    case "pages": return "pages";
    case "replies": return "replies";
    case "apps": case "applications": return "applications";
    case "developers": case "tokens": return "developer_settings";
    default: return "profile";
  }
}

export async function mountAccountSettings(pathname: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  const activeKey = activeKeyFor(pathname);
  root.innerHTML = renderShell(activeKey);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-account-settings__main");
  if (!main) return;

  try {
    const html = await fetchSettingsPage(pathname);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const native = extractMainContent(doc);
    if (!native) {
      main.innerHTML = `<div class="oldgh-account-settings__empty">Couldn't find settings content.</div>`;
      return;
    }
    cleanScrapedContent(native);
    main.innerHTML = `<div class="oldgh-account-settings__native">${native.innerHTML}</div>`;
    rewireAccountDialogs(main);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-account-settings__empty">Couldn't load settings: ${escapeText(msg)}</div>`;
  }
}

export function unmountAccountSettings(): void {
  removeAllBodyRoots();
}

async function fetchSettingsPage(pathname: string): Promise<string> {
  const url = `https://github.com${pathname}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) {
    throw new Error(`${url} responded ${resp.status}`);
  }
  return resp.text();
}

function extractMainContent(doc: Document): Element | null {
  const selectors = [
    "main .Layout-main",
    "main .application-main",
    "main",
    "#main-content",
    "[role='main']",
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) return el;
  }
  return null;
}

function cleanScrapedContent(el: Element): void {
  const remove = [
    "header.AppHeader",
    ".AppHeader-globalBar",
    "header[role='banner']",
    "footer",
    "#repository-container-header",
    ".pagehead",
    ".js-pjax-loader-bar",
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "nav-list",
    ".SideNav",
    ".Layout-sidebar",
    "nav[aria-label*='settings' i]",
    "nav[aria-label='User account menu']",
    "nav[aria-label='Account menu']",
    // per-option ajax save-status badge (loading spinner + success check + error
    // x). github shows one state via css/js we block, so all three leak at once
    ".status-indicator",
  ];
  for (const sel of remove) {
    el.querySelectorAll(sel).forEach((n) => n.remove());
  }
  // strip elements GitHub keeps in the DOM but hides via JS — without their
  // bundle running, every conditional warning shows at once. avatar upload
  // errors, .js-* hide-until-error stubs, [hidden] attribute holdouts.
  const hiddenSelectors = [
    // a blanket [hidden] strip is too broad — GitHub keeps real, reachable
    // controls (collapsed sections, conditional 2FA panels, the delete-account
    // confirm block, dialog bodies, tab panels) behind [hidden] and reveals
    // them via JS we don't run. only strip the error/flash stubs.
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
  for (const node of Array.from(el.querySelectorAll<HTMLElement>("div, section"))) {
    const text = (node.textContent || "").trim();
    if (text.startsWith("Uh oh!") && text.includes("error") && node.children.length < 10) {
      node.remove();
    }
  }
  for (const node of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  }
}

// Confirmation `<dialog>` elements injected via innerHTML never activate
// (dialog-helper / React event handlers don't run), so any action that
// depends on opening one — disable 2FA, delete passkey, revoke key,
// delete account, etc. — is dead on arrival. Promote them to inline
// confirmation boxes so the form's submit button is reachable. Each
// surfaced dialog gets a 2013-style warning border so the user knows
// it's a destructive action.
function rewireAccountDialogs(main: HTMLElement): void {
  for (const dialog of Array.from(main.querySelectorAll<HTMLElement>("dialog"))) {
    // need either a form inside or a form ancestor — the latter is how
    // GitHub puts inputs+submit inside a dialog while the <form> wraps
    // the whole section (rename-form-dialog, delete-passkey-*).
    const hasInnerForm = !!dialog.querySelector("form");
    const hasAncestorForm = !!dialog.closest("form");
    if (!hasInnerForm && !hasAncestorForm) continue;
    if (!dialog.querySelector('button[type="submit"], input[type="submit"]')) continue;
    const section = document.createElement("section");
    section.className = "oldgh-account-settings__exposed-dialog";
    while (dialog.firstChild) section.appendChild(dialog.firstChild);
    dialog.replaceWith(section);
    // React dialogs carry overlay/backdrop scaffolding and a close-X that,
    // once surfaced inline, render as a stray fixed panel or a dead pill.
    section.querySelectorAll(
      "[class*='prc-Dialog-Backdrop'], [class*='prc-Overlay-Backdrop'], [class*='prc-Dialog-CloseButton'], [aria-label='Close']",
    ).forEach((n) => n.remove());
    // dialog-helper wrapper above the dialog often duplicates the trigger
    // button (the one that was supposed to open the dialog). Clear it.
    const helper = section.parentElement?.tagName?.toLowerCase() === "dialog-helper" ? section.parentElement : null;
    if (helper) {
      while (helper.firstChild) helper.parentElement!.insertBefore(helper.firstChild, helper);
      helper.remove();
    }
  }
  // Some pages also have <dialog-helper> wrappers around content that's
  // not a true dialog — strip those custom-element shells so their inner
  // forms are reachable.
  for (const helper of Array.from(main.querySelectorAll<HTMLElement>("dialog-helper"))) {
    while (helper.firstChild) helper.parentElement!.insertBefore(helper.firstChild, helper);
    helper.remove();
  }
}

function renderShell(activeKey: string): string {
  const groups = buildSidebar();
  return `
    <div class="oldgh-page oldgh-account-settings">
      <header class="oldgh-account-settings__header">
        <h1>${octicon("gear", { size: 22 })} Your account</h1>
      </header>
      <div class="oldgh-account-settings__layout">
        <aside class="oldgh-account-settings__sidebar">
          ${groups.map((g) => `
            ${g.label ? `<h3 class="oldgh-account-settings__sidebar-group">${escapeText(g.label)}</h3>` : ""}
            <ul class="oldgh-account-settings__sidebar-list">
              ${g.items.map((it) => `
                <li class="${activeKey === it.key ? "is-active" : ""}">
                  <a href="${escapeAttr(it.path)}">${octicon(it.icon, { size: 14 })}<span>${escapeText(it.label)}</span></a>
                </li>
              `).join("")}
            </ul>
          `).join("")}
        </aside>
        <main class="oldgh-account-settings__main">
          <div class="oldgh-account-settings__loading">Loading settings&hellip;</div>
        </main>
      </div>
    </div>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
