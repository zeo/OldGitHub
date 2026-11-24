import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const srcRoot = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  let target = specifier;
  if (target.startsWith("@/")) target = new URL(target.slice(2), srcRoot).href;
  else if (target.startsWith(".") && context.parentURL?.endsWith(".ts")) target = new URL(target, context.parentURL).href;
  if (target.startsWith("file:")) {
    if (existsSync(new URL(`${target}.ts`))) target += ".ts";
    else {
      const targetUrl = new URL(target);
      if (existsSync(targetUrl) && statSync(targetUrl).isDirectory() && existsSync(new URL(`${target}/index.ts`))) {
        target += "/index.ts";
      }
    }
  }
  return next(target, context);
}

export async function load(url, context, next) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
  const source = await readFile(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: url,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
