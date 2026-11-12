import { readdirSync } from "node:fs";
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);

const dir = new URL("./", import.meta.url);
for (const name of readdirSync(dir).filter((n) => /^test-.+\.mjs$/.test(n)).sort()) {
  await import(new URL(name, dir).href);
}
