# OldGitHub

The 2012-2013 GitHub layout, rebuilt as a Chrome extension.

<p align="center">
  <img src=".github/screenshot-dark.jpg" width="49%" alt="OldGitHub - dark theme" />
  <img src=".github/screenshot-light.jpg" width="49%" alt="OldGitHub - light theme" />
</p>

Re-skins `github.com` (and the header on `gist.github.com`) in the classic 2013 interface, light and dark. Reuses your existing session cookie, with an optional read-only personal access token in extension options for higher `api.github.com` limits (no OAuth, no hosted infra).

## Install

[Install OldGitHub from the Chrome Web Store](https://chromewebstore.google.com/detail/oldgithub/fngbdioldibhjiefnjlilndhmgpanhck), or build it locally (requires Node `>=22.12.0`):

```sh
npm install && npm run build
```

Load `dist/` in Chrome via `chrome://extensions` -> "Load unpacked".

## Themed

Dashboard, profile, repos (home/tree/blob/commits/issues/PRs/wiki/releases/actions/projects/security/insights/settings), notifications, search, explore, trending, topics, collections, sponsors browse, user and repo settings, hovercards.

When signed out, OldGitHub stays dormant and lets GitHub render normally. When signed in, pages that are React-only forms (`/new`, `/import`, create-issue / create-discussion / create-release / fork dialog) and embedded vendor surfaces (Codespaces, Copilot) keep the 2013 header on top and let GitHub's native body render below so submit flows still work.

## Develop

```sh
npm run dev          # vite watch into dist/ plus the reload server on localhost:7878
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint src scripts
npm test             # run isolated test suites via node --test
npm run pack         # typecheck, lint, test, build, validate dist/, and zip for store upload
```

The dev build adds `http://localhost:7878/*` plus a background poller that reloads the extension on rebuild. `npm run build` strips both.

## License

MIT. See the [privacy policy](PRIVACY.md) for the data OldGitHub handles inside the browser.
