import { onAnonymousQuotaUsed } from "@/adapters/rate-limit";

const SHOWN_KEY = "oldgh:quota-notice-reset";

// once per reset window, across hard loads too
export function mountQuotaNotice(): void {
  onAnonymousQuotaUsed((resetAt) => {
    if (document.querySelector(".oldgh-quota-notice") || Number(localStorage.getItem(SHOWN_KEY)) >= resetAt) return;
    localStorage.setItem(SHOWN_KEY, String(resetAt));
    const at = new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const card = document.createElement("div");
    card.className = "oldgh-quota-notice";
    card.setAttribute("role", "status");
    card.innerHTML = `
      <p><strong>GitHub's API limit is used up.</strong> Without a token GitHub allows 60 requests an hour, so activity, stars, hovercards and similar sections stay empty until it resets at ${at}.</p>
      <p><a href="javascript:void(0)" data-oldgh-open-options>Add a read-only token</a> to raise the limit to 5,000.</p>
      <button type="button" class="oldgh-quota-notice__close" aria-label="Dismiss">&times;</button>
    `;
    card.querySelector("button")?.addEventListener("click", () => card.remove());
    document.body.append(card);
  });
}
