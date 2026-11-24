import pkg from "../package.json" with { type: "json" };

export function buildManifest(mode: "development" | "production"): chrome.runtime.ManifestV3 {
  const isDev = mode === "development";
  const hostPermissions = [
    "https://github.com/*",
    "https://gist.github.com/*",
    "https://*.githubusercontent.com/*",
  ];
  if (isDev) hostPermissions.push("http://localhost:7878/*");

  return {
    manifest_version: 3,
    name: "OldGitHub",
    version: pkg.version,
    description: "Restore the classic 2013-era GitHub interface — dashboard, repos, profiles, issues, pull requests — in light and dark themes.",
    minimum_chrome_version: "110",

    icons: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },

    action: {
      default_title: "OldGitHub",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    },

    background: {
      service_worker: "src/background/service-worker.ts",
      type: "module",
    },

    content_scripts: [
      {
        matches: ["https://github.com/*", "https://gist.github.com/*"],
        js: ["src/content/index.ts"],
        run_at: "document_start",
        all_frames: false,
      },
    ],

    options_ui: {
      page: "src/options/index.html",
      open_in_tab: true,
    },

    permissions: ["storage", "declarativeNetRequest"],
    host_permissions: hostPermissions,

    web_accessible_resources: [
      {
        resources: ["styles/2013.css", "assets/*"],
        matches: ["https://github.com/*", "https://gist.github.com/*"],
      },
    ],
  };
}
