type Theme = "light" | "dark" | "auto";

let statusTimer: number | null = null;

function applyPageTheme(theme: Theme): void {
  const resolved: "light" | "dark" =
    theme === "auto"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
  document.documentElement.dataset.theme = resolved;
}

async function load(): Promise<void> {
  const { theme = "auto" } = (await chrome.storage.sync.get("theme")) as { theme?: Theme };
  applyPageTheme(theme);
  const input = document.querySelector<HTMLInputElement>(
    `input[name="theme"][value="${theme}"]`,
  );
  if (input) input.checked = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const checked = document.querySelector<HTMLInputElement>('input[name="theme"]:checked');
    applyPageTheme((checked?.value as Theme) ?? "auto");
  });
}

function bind(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) {
        applyPageTheme(el.value as Theme);
        void chrome.storage.sync.set({ theme: el.value as Theme }).then(() => flashSaved());
      }
    });
  });
}

function flashSaved(): void {
  const hint = document.querySelector<HTMLElement>("[data-status]");
  if (!hint) return;
  hint.textContent = "Saved. Reload any open GitHub tab to see the change.";
  hint.hidden = false;
  if (statusTimer != null) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    hint.hidden = true;
  }, 2400);
}

void load();
bind();

const tokenForm = document.querySelector<HTMLFormElement>("[data-token-form]")!;
const tokenInput = tokenForm.querySelector<HTMLInputElement>("input")!;
const tokenStatus = document.querySelector<HTMLElement>("[data-token-status]")!;

function showTokenStatus(text: string, tone: "good" | "bad" | "plain" = "plain"): void {
  tokenStatus.textContent = text;
  tokenStatus.dataset.tone = tone;
  tokenStatus.hidden = false;
}

async function savedToken(): Promise<{ apiToken?: string; apiTokenInvalid?: boolean }> {
  return (await chrome.storage.local.get(["apiToken", "apiTokenInvalid"])) as { apiToken?: string; apiTokenInvalid?: boolean };
}

async function showSavedToken(): Promise<void> {
  const { apiToken, apiTokenInvalid } = await savedToken();
  tokenInput.placeholder = apiToken ? `saved token ending in ${apiToken.slice(-4)}` : "github_pat_...";
  if (apiToken && apiTokenInvalid) showTokenStatus("GitHub rejected the saved token (401). Requests are anonymous until you replace it.", "bad");
}

async function testToken(token: string): Promise<boolean> {
  showTokenStatus("Checking...");
  let resp: Response;
  try {
    resp = await fetch("https://api.github.com/rate_limit", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    showTokenStatus("Could not reach api.github.com.", "bad");
    return false;
  }
  if (!resp.ok) {
    showTokenStatus(`GitHub rejected this token (${resp.status}).`, "bad");
    return false;
  }
  const { resources } = (await resp.json()) as { resources: { core: { limit: number; remaining: number } } };
  showTokenStatus(`Token works: ${resources.core.remaining.toLocaleString()} of ${resources.core.limit.toLocaleString()} requests left this hour.`, "good");
  return true;
}

tokenForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return showTokenStatus("Paste a token first.", "bad");
  void testToken(token).then(async (ok) => {
    if (!ok) return;
    await chrome.storage.local.set({ apiToken: token, apiTokenInvalid: false });
    tokenInput.value = "";
    await showSavedToken();
    tokenStatus.textContent += " Saved.";
  });
});

tokenForm.querySelector("[data-token-test]")!.addEventListener("click", () => {
  void savedToken().then(async ({ apiToken }) => {
    const token = tokenInput.value.trim() || apiToken;
    if (!token) return showTokenStatus("No token saved. Requests are anonymous: 60 an hour.");
    const ok = await testToken(token);
    if (ok && token === apiToken) await chrome.storage.local.set({ apiTokenInvalid: false });
  });
});

tokenForm.querySelector("[data-token-clear]")!.addEventListener("click", () => {
  void chrome.storage.local.remove(["apiToken", "apiTokenInvalid"]).then(async () => {
    tokenInput.value = "";
    await showSavedToken();
    showTokenStatus("Token removed. Requests are anonymous: 60 an hour.");
  });
});

void showSavedToken();
