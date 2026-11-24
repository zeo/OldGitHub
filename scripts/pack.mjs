// produce oldgithub-v<version>.zip from dist/ for chrome web store upload.
// zero-dep: writes a stored+deflated zip with central-directory by hand.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 as zlibCrc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = resolve(root, "dist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outName = `oldgithub-v${pkg.version}.zip`;
const outPath = resolve(root, outName);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (s.isFile()) out.push(full);
  }
  return out;
}

function toZipName(absPath) {
  return relative(distDir, absPath).split(sep).join("/");
}

function dosTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function fail(message) {
  console.error(`pack validation failed: ${message}`);
  process.exit(1);
}

function validateDist(files) {
  if (files.length === 0) fail("dist/ is empty: run `npm run build` first.");
  const relFiles = files.map(toZipName);
  const mapFiles = relFiles.filter((name) => name.endsWith(".map"));
  if (mapFiles.length > 0) fail(`sourcemaps found in dist/: ${mapFiles.join(", ")}`);

  const manifestPath = resolve(distDir, "manifest.json");
  if (!existsSync(manifestPath)) fail("dist/manifest.json is missing.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== pkg.version) {
    fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
  }
  const hosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  if (hosts.some((h) => /localhost|127\.0\.0\.1/.test(String(h)))) {
    fail(`dev host permission leaked into dist/manifest.json: ${hosts.join(", ")}`);
  }

  const requiredPaths = [];
  if (manifest.icons) requiredPaths.push(...Object.values(manifest.icons));
  if (manifest.action?.default_icon) requiredPaths.push(...Object.values(manifest.action.default_icon));
  if (manifest.background?.service_worker) requiredPaths.push(manifest.background.service_worker);
  if (manifest.options_ui?.page) requiredPaths.push(manifest.options_ui.page);
  for (const cs of manifest.content_scripts ?? []) {
    if (Array.isArray(cs.js)) requiredPaths.push(...cs.js);
    if (Array.isArray(cs.css)) requiredPaths.push(...cs.css);
  }
  for (const war of manifest.web_accessible_resources ?? []) {
    for (const res of war.resources ?? []) {
      if (String(res).endsWith("/*")) {
        const prefix = String(res).slice(0, -1);
        if (!relFiles.some((f) => f.startsWith(prefix))) {
          fail(`web_accessible_resources pattern ${res} matched zero files in dist/`);
        }
      } else {
        requiredPaths.push(res);
      }
    }
  }
  for (const rel of requiredPaths) {
    if (!existsSync(resolve(distDir, rel))) fail(`manifest references missing file: ${rel}`);
  }
}

if (!existsSync(distDir)) fail("dist/ does not exist: run `npm run build` first.");
const files = walk(distDir);
validateDist(files);

const now = new Date();
const { time: dosT, date: dosD } = dosTime(now);

const localChunks = [];
const centralChunks = [];
let offset = 0;

for (const absPath of files) {
  const name = toZipName(absPath);
  const raw = readFileSync(absPath);
  const crc = zlibCrc32(raw);
  const deflated = deflateRawSync(raw, { level: 9 });
  const useDeflate = deflated.length < raw.length;
  const compressed = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const nameBuf = Buffer.from(name, "utf8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);     // local file header signature
  localHeader.writeUInt16LE(20, 4);             // version needed
  localHeader.writeUInt16LE(0, 6);              // general purpose
  localHeader.writeUInt16LE(method, 8);         // compression method
  localHeader.writeUInt16LE(dosT, 10);          // mod time
  localHeader.writeUInt16LE(dosD, 12);          // mod date
  localHeader.writeUInt32LE(crc, 14);           // crc-32
  localHeader.writeUInt32LE(compressed.length, 18); // compressed size
  localHeader.writeUInt32LE(raw.length, 22);    // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);// file name length
  localHeader.writeUInt16LE(0, 28);             // extra field length

  const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);
  localChunks.push(localEntry);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);         // central dir signature
  central.writeUInt16LE(20, 4);                 // version made by
  central.writeUInt16LE(20, 6);                 // version needed
  central.writeUInt16LE(0, 8);                  // general purpose
  central.writeUInt16LE(method, 10);            // compression method
  central.writeUInt16LE(dosT, 12);              // mod time
  central.writeUInt16LE(dosD, 14);              // mod date
  central.writeUInt32LE(crc, 16);               // crc-32
  central.writeUInt32LE(compressed.length, 20); // compressed size
  central.writeUInt32LE(raw.length, 24);        // uncompressed size
  central.writeUInt16LE(nameBuf.length, 28);    // file name length
  central.writeUInt16LE(0, 30);                 // extra field length
  central.writeUInt16LE(0, 32);                 // file comment length
  central.writeUInt16LE(0, 34);                 // disk number start
  central.writeUInt16LE(0, 36);                 // internal file attrs
  central.writeUInt32LE(0, 38);                 // external file attrs
  central.writeUInt32LE(offset, 42);            // relative offset of local header

  centralChunks.push(Buffer.concat([central, nameBuf]));
  offset += localEntry.length;
}

const centralStart = offset;
const centralBuf = Buffer.concat(centralChunks);

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);              // EOCD signature
eocd.writeUInt16LE(0, 4);                       // disk number
eocd.writeUInt16LE(0, 6);                       // disk with central dir
eocd.writeUInt16LE(files.length, 8);            // entries on this disk
eocd.writeUInt16LE(files.length, 10);           // total entries
eocd.writeUInt32LE(centralBuf.length, 12);      // central dir size
eocd.writeUInt32LE(centralStart, 16);           // central dir offset
eocd.writeUInt16LE(0, 20);                      // comment length

const zip = Buffer.concat([...localChunks, centralBuf, eocd]);
writeFileSync(outPath, zip);
console.log(`wrote ${outPath} (${zip.length} bytes, ${files.length} files)`);
