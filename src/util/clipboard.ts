import { octicon } from "@/icons";

export async function copyToClipboard(
  text: string,
  button: HTMLButtonElement,
  onFallback?: () => void,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (!button.dataset["oldghCopying"]) {
      button.dataset["oldghCopying"] = "1";
      const prev = button.innerHTML;
      button.innerHTML = octicon("check", { size: 14 });
      button.classList.add("is-copied");
      window.setTimeout(() => {
        delete button.dataset["oldghCopying"];
        button.innerHTML = prev;
        button.classList.remove("is-copied");
      }, 1200);
    }
    return true;
  } catch {
    onFallback?.();
    return false;
  }
}
