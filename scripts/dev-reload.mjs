// tiny HTTP server that the extension's service worker polls.
// the SW reloads itself whenever the build-id changes.
// the actual file change is detected by watching dist/manifest.json mtime
// (vite --watch rewrites the manifest on every rebuild).

import { createServer } from "node:http";
import { stat, watch, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";

const PORT = Number(process.env.OLDGH_DEV_PORT) || 7878;
const ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = resolve(ROOT, "dist");
const PUBLIC_DIR = resolve(ROOT, "public");
const STAMP_FILE = resolve(DIST_DIR, "manifest.json");

let buildId = String(Date.now());

async function refreshStamp() {
  if (!existsSync(STAMP_FILE)) return;
  try {
    const s = await stat(STAMP_FILE);
    const next = String(Math.floor(s.mtimeMs));
    if (next !== buildId) {
      buildId = next;
      console.log(`[dev-reload] new build-id ${buildId}`);
    }
  } catch (e) {
    console.warn(`[dev-reload] stat failed: ${e.message}`);
  }
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/build-id") {
    res.setHeader("Content-Type", "text/plain");
    res.end(buildId);
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (err) => {
  console.error(`[dev-reload] server error on port ${PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-reload] listening on http://localhost:${PORT}/build-id`);
});

// watch the dist directory for changes
async function watchLoop() {
  await refreshStamp();
  while (true) {
    try {
      if (!existsSync(DIST_DIR)) {
        await sleep(500);
        continue;
      }
      const watcher = watch(DIST_DIR, { recursive: false });
      for await (const ev of watcher) {
        if (ev.filename && ev.filename.endsWith("manifest.json")) {
          await sleep(150);
          await refreshStamp();
        }
      }
    } catch (e) {
      console.warn(`[dev-reload] watcher error: ${e.message}`);
      await sleep(1000);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function publicWatcher() {
  if (!existsSync(PUBLIC_DIR)) return;
  while (true) {
    try {
      const watcher = watch(PUBLIC_DIR, { recursive: true });
      for await (const ev of watcher) {
        if (!ev.filename) continue;
        const src = resolve(PUBLIC_DIR, ev.filename);
        if (!existsSync(src)) continue;
        try {
          if (!(await stat(src)).isFile()) continue;
          const rel = relative(PUBLIC_DIR, src);
          const dest = resolve(DIST_DIR, rel);
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(src, dest);
          console.log(`[dev-reload] copied public/${rel} -> dist/${rel}`);
          buildId = String(Date.now());
          console.log(`[dev-reload] new build-id ${buildId}`);
        } catch (err) {
          console.warn(`[dev-reload] copy failed: ${err.message}`);
        }
      }
    } catch (e) {
      console.warn(`[dev-reload] public watcher error: ${e.message}`);
      await sleep(1000);
    }
  }
}

watchLoop();
publicWatcher();
