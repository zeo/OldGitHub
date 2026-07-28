import { defineConfig, normalizePath, type Plugin } from "vite";
import { resolve } from "node:path";
import { buildManifest } from "./src/manifest.config";

const contentEntry = resolve(import.meta.dirname, "src/content/index.ts");
const backgroundEntry = resolve(import.meta.dirname, "src/background/service-worker.ts");

function extensionManifest(mode: "development" | "production"): Plugin {
  return {
    name: "oldgithub-manifest",
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).flatMap((output) => output.type === "chunk" ? [output] : []);
      const content = chunks.find((chunk) => chunk.facadeModuleId && normalizePath(chunk.facadeModuleId) === normalizePath(contentEntry));
      const background = chunks.find((chunk) => chunk.facadeModuleId && normalizePath(chunk.facadeModuleId) === normalizePath(backgroundEntry));
      if (!content || !background) throw new Error("extension entry chunk missing from build");

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
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [extensionManifest(mode === "development" ? "development" : "production")],
  build: {
    target: "chrome110",
    minify: mode === "production",
    sourcemap: mode === "development",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        options: resolve(import.meta.dirname, "src/options/index.html"),
        content: contentEntry,
        background: backgroundEntry,
      },
    },
  },
}));
