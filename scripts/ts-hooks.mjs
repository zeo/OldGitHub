import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const srcRoot = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  let target = specifier;
  if (target.startsWith("@/")) target = new URL(target.slice(2), srcRoot).href;
  else if (target.startsWith(".") && context.parentURL?.endsWith(".ts")) target = new URL(target, context.parentURL).href;
  if (target.startsWith("file:") && !/\.[a-z]+$/i.test(target)) target += existsSync(new URL(`${target}.ts`)) ? ".ts" : "/index.ts";
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
