// generate extension icons (16/32/48/128) from assets/source-icon.png.
// the source is the OldGitHub wordmark on a transparent background; trim its
// transparent padding, extend to a square canvas with a small margin, then
// rasterise at each output size with lanczos3. emits public/icons/icon-{size}.png.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public", "icons");
const source = resolve(here, "..", "assets", "source-icon.png");
const sizes = [16, 32, 48, 128];
const force = process.argv.includes("--force");

if (!force) {
  const sourceMtime = statSync(source).mtimeMs;
  const fresh = sizes.every((size) => {
    const file = resolve(outDir, `icon-${size}.png`);
    return existsSync(file) && statSync(file).mtimeMs >= sourceMtime;
  });
  if (fresh) process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const trimmed = await sharp(source)
  .trim({ background: TRANSPARENT, threshold: 16 })
  .png()
  .toBuffer({ resolveWithObject: true });
const { width, height } = trimmed.info;

// pad to a square canvas with a small breathing margin
const side = Math.round(Math.max(width, height) * 1.10);
const padLeft = Math.round((side - width) / 2);
const padTop = Math.round((side - height) / 2);

const squared = await sharp(trimmed.data)
  .extend({
    top: padTop,
    bottom: side - height - padTop,
    left: padLeft,
    right: side - width - padLeft,
    background: TRANSPARENT,
  })
  .png()
  .toBuffer();

for (const size of sizes) {
  const file = resolve(outDir, `icon-${size}.png`);
  await sharp(squared)
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`wrote ${file}`);
}
