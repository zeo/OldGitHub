const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diff = now.getTime() - then.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);

  const pick = (): { n: number; unit: string } => {
    // rounding the lower unit can hit the next divisor (e.g. 60s), promote so it reads as 1 of the next unit
    if (abs < MIN) {
      const n = Math.round(abs / SEC);
      return n === 60 ? { n: 1, unit: "minute" } : { n, unit: "second" };
    }
    if (abs < HOUR) {
      const n = Math.round(abs / MIN);
      return n === 60 ? { n: 1, unit: "hour" } : { n, unit: "minute" };
    }
    if (abs < DAY) {
      const n = Math.round(abs / HOUR);
      return n === 24 ? { n: 1, unit: "day" } : { n, unit: "hour" };
    }
    if (abs < WEEK) {
      const n = Math.round(abs / DAY);
      return n === 7 ? { n: 1, unit: "week" } : { n, unit: "day" };
    }
    if (abs < MONTH) return { n: Math.round(abs / WEEK), unit: "week" };
    if (abs < YEAR) {
      const n = Math.round(abs / MONTH);
      return n === 12 ? { n: 1, unit: "year" } : { n, unit: "month" };
    }
    return { n: Math.round(abs / YEAR), unit: "year" };
  };

  const { n, unit } = pick();
  if (n === 0) return "just now";
  const plural = n === 1 ? unit : `${unit}s`;
  return future ? `in ${n} ${plural}` : `${n} ${plural} ago`;
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\..+$/, "");
}
