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
