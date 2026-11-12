import { OCTICON_SVGS } from "./generated";
import { escapeAttr } from "@/util/html";

export type OcticonName = keyof typeof OCTICON_SVGS;

export type OcticonOptions = {
  size?: number;
  className?: string;
  ariaLabel?: string;
};

export function octicon(name: string, opts: OcticonOptions = {}): string {
  const raw = OCTICON_SVGS[name];
  if (!raw) {
    console.debug(`[oldgh] unknown octicon: ${name}`);
    const size = opts.size ?? 16;
    return `<svg width="${size}" height="${size}" aria-hidden="true"></svg>`;
  }
  const attrs: string[] = [];
  attrs.push(`class="octicon octicon-${name}${opts.className ? " " + opts.className : ""}"`);
  if (opts.size != null) {
    attrs.push(`width="${opts.size}"`, `height="${opts.size}"`);
  }
  if (opts.ariaLabel) {
    attrs.push(`aria-label="${escapeAttr(opts.ariaLabel)}"`, `role="img"`);
  } else {
    attrs.push(`aria-hidden="true"`);
  }
  return raw.replace(/^<svg/, `<svg ${attrs.join(" ")}`);
}
