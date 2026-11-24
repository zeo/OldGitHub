/// <reference types="node" />
import { defineConfig, normalizePath, type Plugin } from "vite";
import { resolve } from "node:path";
import { buildManifest } from "./src/manifest.config";

const contentEntry = resolve(import.meta.dirname, "src/content/index.ts");
const backgroundEntry = resolve(import.meta.dirname, "src/background/service-worker.ts");
const cssEntry = resolve(import.meta.dirname, "src/styles/2013.css");

function extensionManifest(mode: "development" | "production"): Plugin {
  return {
    name: "oldgithub-manifest",
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).flatMap((output) => output.type === "chunk" ? [output] : []);
      const content = chunks.find((chunk) => chunk.facadeModuleId && normalizePath(chunk.facadeModuleId) === normalizePath(contentEntry));
      const background = chunks.find((chunk) => chunk.facadeModuleId && normalizePath(chunk.facadeModuleId) === normalizePath(backgroundEntry));
      if (!content || !background) throw new Error("extension entry chunk missing from build");

      // drop empty js wrapper emitted for the css-only entry
      for (const [key, output] of Object.entries(bundle)) {
        if (output.type === "chunk" && output.facadeModuleId && normalizePath(output.facadeModuleId) === normalizePath(cssEntry)) {
          delete bundle[key];
        }
      }

      this.emitFile({
        type: "asset",
        fileName: "src/content/index.js",
        source: `(async()=>{await import(chrome.runtime.getURL(${JSON.stringify(content.fileName)}))})();`,
      });
      this.emitFile({
        type: "asset",
        fileName: "serviceWorker.js",
        source: `import ${JSON.stringify(`/${background.fileName}`)};`,
      });

      const manifest = buildManifest(mode);
      manifest.background!.service_worker = "serviceWorker.js";
      manifest.content_scripts![0]!.js = ["src/content/index.js"];
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [extensionManifest(mode === "development" ? "development" : "production")],
  build: {
    target: "chrome110",
    minify: mode === "production",
    cssMinify: mode === "production" ? "lightningcss" : false,
    sourcemap: mode === "development",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        options: resolve(import.meta.dirname, "src/options/index.html"),
        content: contentEntry,
        background: backgroundEntry,
        "styles/2013": cssEntry,
      },
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.names?.includes("2013.css") || assetInfo.originalFileNames?.some((n) => n.endsWith("styles/2013.css"))
            ? "styles/2013.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
}));
