import { octicon } from "@/icons";
import { adoptBodyRoot, isCurrentNavigation, navigationToken } from "./_body";
import {
  SUBMIT_BTN_SELECTOR,
  askDataConfirm,
  cleanSettingsContent,
  disableAutosaveToggles,
  enforceSameOriginForms,
  extractSettingsMain,
  fillMenuLabels,
  requireSecondClick,
} from "./_settings-shell";
import { escapeAttr, escapeText } from "@/util/html";

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

const ACCOUNT_MAIN_SELECTORS = [
  "main .Layout-main",
  "main .application-main",
  "main",
  "#main-content",
  "[role='main']",
];

const ACCOUNT_STRIP_SELECTORS = [
  "nav-list",
  ".SideNav",
  ".Layout-sidebar",
  "nav[aria-label*='settings' i]",
  "nav[aria-label='User account menu']",
  "nav[aria-label='Account menu']",
];

export async function mountAccountSettings(pathname: string, search: string): Promise<void> {
  const nav = navigationToken();
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  const activeKey = activeKeyFor(pathname);
  root.innerHTML = renderShell(activeKey);
  if (!adoptBodyRoot(root, undefined, nav)) return;

  const main = root.querySelector<HTMLElement>(".oldgh-account-settings__main");
  if (!main) return;

  try {
    const query = search.replace(/^\?/, "");
    const html = await fetchSettingsPage(query ? `${pathname}?${query}` : pathname);
    if (!isCurrentNavigation(nav)) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const native = extractSettingsMain(doc, ACCOUNT_MAIN_SELECTORS);
    if (!native) {
      main.innerHTML = `<div class="oldgh-account-settings__empty">Couldn't find settings content.</div>`;
      return;
    }
    cleanSettingsContent(native, ACCOUNT_STRIP_SELECTORS);
    main.innerHTML = `<div class="oldgh-account-settings__native">${native.innerHTML}</div>`;
    rewireAccountDialogs(main);
    disableAutosaveToggles(main, ".oldgh-account-settings__native");
    fillMenuLabels(main);
    enforceSameOriginForms(main);
    askDataConfirm(main);
    // the upload runs through github's file-attachment element, so hand it to the native page
    for (const label of Array.from(main.querySelectorAll<HTMLLabelElement>("label[for='avatar_upload']"))) {
      label.removeAttribute("for");
      label.setAttribute("data-oldgh-show-native", "");
    }
  } catch (err) {
    if (!isCurrentNavigation(nav)) return;
    const msg = err instanceof Error ? err.message : String(err);
    main.innerHTML = `<div class="oldgh-account-settings__empty">Couldn't load settings: ${escapeText(msg)}</div>`;
  }
}

async function fetchSettingsPage(path: string): Promise<string> {
  const url = `https://github.com${path}`;
  const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
  if (!resp.ok) {
    throw new Error(`${url} responded ${resp.status}`);
  }
  return resp.text();
}

// confirmation <dialog> elements injected via innerHTML never activate, so promote them inline with a two-click destructive guard
function rewireAccountDialogs(main: HTMLElement): void {
  for (const dialog of Array.from(main.querySelectorAll<HTMLElement>("dialog"))) {
    // check both inner and ancestor forms because github wraps some destructive dialogs inside an outer form
    const hasInnerForm = !!dialog.querySelector("form");
    const hasAncestorForm = !!dialog.closest("form");
    if (!hasInnerForm && !hasAncestorForm) continue;
    if (!dialog.querySelector(SUBMIT_BTN_SELECTOR)) continue;
    const section = document.createElement("section");
    section.className = "oldgh-account-settings__exposed-dialog";
    while (dialog.firstChild) section.appendChild(dialog.firstChild);
    dialog.replaceWith(section);
    requireSecondClick(section);
    section.querySelectorAll(
      "[class*='prc-Dialog-Backdrop'], [class*='prc-Overlay-Backdrop'], [class*='prc-Dialog-CloseButton'], [aria-label='Close']",
    ).forEach((n) => n.remove());
    const helper = section.parentElement?.tagName?.toLowerCase() === "dialog-helper" ? section.parentElement : null;
    if (helper) {
      while (helper.firstChild) helper.parentElement!.insertBefore(helper.firstChild, helper);
      helper.remove();
    }
  }
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
