# Contributing

## Requirements

- Node.js `>=22.12.0`
- npm
- Chromium or Google Chrome (for loading the unpacked extension from `dist/`)

## Setup and commands

Install dependencies once:

```sh
npm install
```

Common workflows:

- `npm run dev`: runs the TypeScript compiler/Vite watch build alongside `scripts/dev-reload.mjs`, rebuilding `dist/` and reloading the unpacked extension on changes.
- `npm run build`: generates `src/icons/sprite.ts` and bundles the extension and modular stylesheet into `dist/`.
- `npm run typecheck`: runs `build:icons` and `tsc --noEmit`.
- `npm run lint`: runs `oxlint src scripts`.
- `npm test`: runs the `node:test` suite (`scripts/test-*.mjs`) with `happy-dom` and direct TypeScript loading.
- `npm run test:watch`: runs `npm test` in watch mode.
- `npm run pack`: runs `typecheck`, `lint`, `test`, `build`, and packages `dist/` into `oldgithub-v<version>.zip`.
- `npm run build:ext-icons`: regenerates the PNG extension icons from SVGs using `sharp`.

Load the unpacked extension in Chrome by opening `chrome://extensions`, enabling Developer mode, and selecting `dist/`.

## Architecture

- `src/content/`: content-script bootstrap, history interception (`pushState`, `popstate`, clicks), and native-page fallback toggle.
- `src/background/`: MV3 service worker handling `declarativeNetRequest` asset blocking on rendered routes and constrained same-origin/raw fetches (`proxy-policy.ts`).
- `src/router/`: URL parser (`resolve.ts`) and route dispatcher (`dispatch.ts`) that mounts views lazily per route.
- `src/adapters/`: GitHub REST/page-payload data fetchers and parsers, plus rate-limit bucket tracking (`rate-limit.ts`) and page HTML cache (`_page.ts`).
- `src/views/`: DOM renderers per route, shared layout shells (`_body.ts`, `_breadcrumb.ts`, `_pager.ts`, `_settings-shell.ts`), header/footer, and lazy utilities (`file-finder.ts`, `hovercards.ts`).
- `src/util/`: HTML sanitization and safe href helpers (`html.ts`), diff parser (`diff.ts`), fuzzy matcher (`fuzzy.ts`), highlighter (`highlight.ts`), and time/emoji formatting.
- `src/options/`: extension options UI for token storage and preferences.
- `src/icons/`: build-time octicon SVG sprite generator (`scripts/build-icons.mjs` outputs `sprite.ts`) and `octicon()` helper.

## Stylesheets

All extension styles live in numbered partials under `src/styles/` (`01-tokens.css` through `10-polish.css`) and are imported in order by `src/styles/2013.css`. Vite processes `src/styles/2013.css` with LightningCSS and emits `dist/styles/2013.css`.

When adding or editing rules:

- Namespace new selectors under `.oldgh-*` inside `html[data-oldgh-mounted]` so native fallback views stay unstyled.
- Keep token definitions in `01-tokens.css` and component styles in the matching section partial.

## Testing

Tests run directly against TypeScript modules via `scripts/register-ts.mjs` inside a `happy-dom` environment (`scripts/dom-helper.mjs`). Add new test files matching `scripts/test-*.mjs` and verify CSS, TypeScript, lint, tests, and bundle build cleanly with:

```sh
npm run typecheck && npm run lint && npm test && npm run build
```
