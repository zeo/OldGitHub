import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const viteBin = resolve(root, "node_modules", "vite", "bin", "vite.js");
const reloadScript = resolve(here, "dev-reload.mjs");

const procs = [];

function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    console.log(`[${name}] exited code=${code} signal=${signal}`);
    for (const p of procs) {
      if (p !== child && !p.killed) p.kill();
    }
    process.exit(code ?? 1);
  });
  procs.push(child);
}

start("vite", [viteBin, "build", "--watch", "--mode", "development"]);
start("reload", [reloadScript]);

const shutdown = () => {
  for (const p of procs) {
    if (!p.killed) p.kill();
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
