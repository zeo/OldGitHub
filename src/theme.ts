export type Theme = "light" | "dark" | "auto";

const MEDIA = "(prefers-color-scheme: dark)";
const STORAGE_KEY = "theme";

let mql: MediaQueryList | null = null;
let mqlListener: ((e: MediaQueryListEvent) => void) | null = null;

export async function applyTheme(): Promise<void> {
  const theme = await readStoredTheme();
  setEffectiveTheme(resolve(theme));
}

export function watchThemeChanges(): void {
  // React to storage changes from the options page or the in-page toggle.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!changes[STORAGE_KEY]) return;
    const next = (changes[STORAGE_KEY].newValue as Theme | undefined) ?? "auto";
    setEffectiveTheme(resolve(next));
    rewireMediaListener(next);
  });

  // React to OS-level dark-mode changes when the user has theme = "auto".
  void readStoredTheme().then((t) => rewireMediaListener(t));
}

export async function setTheme(theme: Theme): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: theme });
  setEffectiveTheme(resolve(theme));
  rewireMediaListener(theme);
}

export async function getCurrentTheme(): Promise<Theme> {
  return readStoredTheme();
}

async function readStoredTheme(): Promise<Theme> {
  try {
    const result = (await chrome.storage.sync.get(STORAGE_KEY)) as { theme?: Theme };
    const t = result.theme;
    if (t === "light" || t === "dark" || t === "auto") return t;
  } catch {
    // storage may be unavailable in some contexts
  }
  return "auto";
}

function resolve(theme: Theme): "light" | "dark" {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return matchMedia(MEDIA).matches ? "dark" : "light";
}

function setEffectiveTheme(effective: "light" | "dark"): void {
  document.documentElement.setAttribute("data-oldgh-theme", effective);
  // Cache the resolved theme so the next page-load can use it synchronously
  // during eagerStyle, before chrome.storage.sync resolves.
  try {
    localStorage.setItem("oldgh:theme-cache", effective);
  } catch {
    // localStorage may be unavailable (e.g. third-party context)
  }
}

function rewireMediaListener(theme: Theme): void {
  if (mql && mqlListener) {
    mql.removeEventListener("change", mqlListener);
    mqlListener = null;
  }
  if (theme !== "auto") return;
  mql = matchMedia(MEDIA);
  mqlListener = (e): void => {
    setEffectiveTheme(e.matches ? "dark" : "light");
  };
  mql.addEventListener("change", mqlListener);
}
