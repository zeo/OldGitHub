export function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function readArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}

export function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === "number" ? v : null;
}

export function readBool(o: Record<string, unknown>, key: string): boolean | null {
  const v = o[key];
  return typeof v === "boolean" ? v : null;
}
