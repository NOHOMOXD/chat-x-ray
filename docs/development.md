# Development

**English** · [Русский](ru/development.md)

## Setup

```bash
npm ci
npm run build:all     # dist/chrome + dist/firefox + dist/safari
```

Node 20+ required.

## Loading the extension

**Chrome / Edge / Opera**

1. `chrome://extensions` → enable *Developer mode*.
2. *Load unpacked* → pick `dist/chrome`.
3. Open any Twitch channel.

**Firefox** (140+, temporary install)

1. `about:debugging#/runtime/this-firefox`.
2. *Load Temporary Add-on…* → pick `dist/firefox/manifest.json`.
3. Temporary add-ons disappear on restart; for a permanent install use a signed
   build (see `docs/distribution.md`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Unit + DOM tests (Vitest, happy-dom) |
| `npm run test:watch` | Same, in watch mode |
| `npm run test:coverage` | With a V8 coverage report |
| `npm run build` | Chrome build only |
| `npm run build:all` | Chromium, Firefox and Safari extension resources |
| `npm run dev` | Rebuild on change |
| `npm run test:e2e` | Loads the real build in Chromium and Firefox (Playwright) |
| `npm run lint:firefox` | `web-ext lint` against the Firefox build |
| `npm run verify` | Everything above, in CI order |
| `npm run package` | Store-ready zips in `release/` |

Playwright's bundled browsers install on demand:

```bash
npx playwright install chromium firefox
```

## Project layout

```text
src/
├── app/           content.js (controller), options page
├── core/          analyzer, scoring matrix, R9K, chat session
├── analysis/      viewer estimate, history, ER baseline
├── platform/      MAIN-world socket tap, IRC parser, browser API adapter
├── config/        settings model + storage repository
├── i18n/          RU/EN catalogue and t()
├── ui/
│   ├── chat/      message binder, rows, stats strip, viewer counter
│   ├── settings/  floating settings window
│   ├── shared/    DOM helpers, Tippy controller
│   └── styles.css
├── _locales/      manifest localisation
└── manifest.json  single manifest, per-browser tweaks in build.js
```

`tests/` mirrors `src/`; `tests/e2e/` holds the Playwright spec and its
Twitch-shaped fixture.

## Testing notes

- Unit/DOM tests run under **happy-dom**, a real DOM implementation. No fake
  `document` objects: `querySelector`, events, `classList` and
  `MutationObserver` behave like a browser.
- The E2E spec loads the actual built extension into Chromium and serves a
  local fixture at `https://www.twitch.tv/` (never the live site). It proves
  the MAIN-world tap installs, an IRC message is ingested, the UI mounts, and a
  **forged** message without the bridge token is ignored.
- Google Chrome removed `--load-extension`, so E2E uses Playwright's bundled
  Chromium.

For Safari on Mac, use full Xcode and `npm run package:safari`. See [distribution](distribution.md).
