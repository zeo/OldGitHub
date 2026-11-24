export class AdapterFailure extends Error {
  readonly status: number | null;

  constructor(name: string, message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options);
    this.name = name;
    const status = /\bresponded (\d{3})\b/.exec(message);
    this.status = options?.status ?? (status ? Number(status[1]) : null);
  }
}
