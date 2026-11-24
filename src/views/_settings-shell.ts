import { askDataConfirm, cleanScrapedPage } from "@/util/html";

export const SUBMIT_BTN_SELECTOR = 'button[type="submit"], input[type="submit"], button:not([type])';
const DESTRUCTIVE = /\b(delete|remove|revoke|disable|reset|regenerate|leave|unlink|transfer|sign out)\b/i;

export function extractSettingsMain(doc: Document, selectors: readonly string[]): Element | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerHTML.trim().length > 100) return el;
  }
  return null;
}

const HIDDEN_ERROR_SELECTORS = [
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

export function cleanSettingsContent(el: Element, extraSelectors: readonly string[]): void {
  cleanScrapedPage(el, [...extraSelectors, ".status-indicator"]);
  for (const sel of HIDDEN_ERROR_SELECTORS) {
    el.querySelectorAll(sel).forEach((n) => {
      if (n.matches("dialog, [role='tabpanel']") || n.querySelector(`form, ${SUBMIT_BTN_SELECTOR}`)) return;
      n.remove();
    });
  }
}

export function disableAutosaveToggles(main: HTMLElement, nativeContainerSelector: string): void {
  let disabled = 0;
  for (const form of Array.from(main.querySelectorAll<HTMLFormElement>("form[data-autosubmit]"))) {
    if (form.querySelector(SUBMIT_BTN_SELECTOR)) continue;
    for (const control of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[type='checkbox'], input[type='radio'], select"))) {
      control.disabled = true;
      disabled++;
    }
  }
  if (disabled === 0) return;
  const note = document.createElement("div");
  note.className = "flash";
  note.innerHTML = `Checkboxes here save through GitHub's own scripts, which OldGitHub doesn't run. <a href="#" data-oldgh-show-native>Change them on GitHub's settings page</a>.`;
  main.querySelector(nativeContainerSelector)?.prepend(note);
}

export function fillMenuLabels(main: HTMLElement): void {
  for (const menu of Array.from(main.querySelectorAll<HTMLElement>("action-menu[data-dynamic-label]"))) {
    const label = menu.querySelector(".Button-label");
    const chosen = menu.querySelector("[aria-checked='true'] .ActionListItem-label")?.textContent?.trim();
    if (!label || !chosen) continue;
    const prefix = menu.getAttribute("data-dynamic-label-prefix");
    label.textContent = prefix ? `${prefix}: ${chosen}` : chosen;
  }
}

export function enforceSameOriginForms(main: HTMLElement): void {
  main.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = form.getAttribute("action");
    if (!action) return;
    try {
      if (new URL(action, "https://github.com").origin === "https://github.com") return;
    } catch {
      // invalid action falls through to cancel
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}

export function requireSecondClick(section: HTMLElement): void {
  const armedButtons = new WeakMap<HTMLButtonElement | HTMLInputElement, () => void>();
  for (const button of Array.from(section.querySelectorAll<HTMLButtonElement | HTMLInputElement>(SUBMIT_BTN_SELECTOR))) {
    const text = (button instanceof HTMLInputElement ? button.value : button.textContent || "").replace(/\s+/g, " ").trim();
    if (button.hasAttribute("data-confirm") || (!button.classList.contains("btn-danger") && !DESTRUCTIVE.test(text))) continue;
    const original = button instanceof HTMLInputElement ? button.value : button.innerHTML;
    const confirmText = `Yes, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    let timer = 0;
    const disarm = () => {
      delete button.dataset["oldghArmed"];
      button.classList.remove("oldgh-btn--danger");
      if (button instanceof HTMLInputElement) button.value = original;
      else button.innerHTML = original;
    };
    const arm = () => {
      button.dataset["oldghArmed"] = "1";
      button.classList.add("oldgh-btn--danger");
      if (button instanceof HTMLInputElement) button.value = confirmText;
      else button.textContent = confirmText;
      window.clearTimeout(timer);
      timer = window.setTimeout(disarm, 5000);
    };
    armedButtons.set(button, arm);
    button.addEventListener("click", (e) => {
      if (button.dataset["oldghArmed"]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      arm();
    }, { capture: true });
  }

  section.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const submitter = (e as SubmitEvent).submitter;
    const candidate = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
      ? submitter
      : form.querySelector<HTMLButtonElement | HTMLInputElement>(SUBMIT_BTN_SELECTOR);
    if (!candidate) return;
    const arm = armedButtons.get(candidate);
    if (!arm || candidate.dataset["oldghArmed"]) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    arm();
  }, { capture: true });
}

export { askDataConfirm };
