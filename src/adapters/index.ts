export class AdapterFailure extends Error {
  readonly status: number | null;

  constructor(name: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = name;
    const status = /\bresponded (\d{3})\b/.exec(message);
    this.status = status ? Number(status[1]) : null;
  }
}

export type AdapterContext = {
  csrfToken: string | null;
  signal?: AbortSignal;
};

export type Adapter<TInput, TOutput> = (
  input: TInput,
  ctx: AdapterContext,
) => Promise<TOutput>;

// individual adapters live in sibling files (issue.ts, repo.ts, pr.ts, ...)
// each one wraps fetch + parse in try/catch and throws AdapterFailure on shape mismatch
// the router catches AdapterFailure and renders the vanilla GitHub page for that nav
