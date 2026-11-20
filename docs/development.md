# Development

**English** · [Русский](ru/development.md)

Users install a release ZIP — [README](../README.md#install). This page is for
building and maintaining.

## From source

Node 20+.

```bash
npm ci
npm run build:all    # dist/chrome, dist/firefox, dist/safari
```

Load `dist/chrome` as an unpacked extension, `dist/firefox/manifest.json` as a
temporary add-on, or `dist/safari` via **Add Temporary Extension**.

| Command | What it does |
| --- | --- |
| `npm test` | Unit + DOM tests (Vitest, happy-dom) |
| `npm run build` / `build:firefox` / `build:safari` | One target |
| `npm run build:all` | All targets |
| `npm run dev` | Rebuild on change |
| `npm run test:e2e` | Real build in Playwright's Chromium and Firefox |
| `npm run lint:firefox` | `web-ext lint` |
| `npm run verify` | What CI runs |
| `npm run package` | Zips and `SHA256SUMS.txt` in `release/` |
| `npm run package:safari` | Xcode project in `release/` (macOS, full Xcode) |

`src/` holds `app` (controller, background, options page), `core` (analyzer,
R9K, ID groups), `analysis` (viewer estimate, history, capture), `platform`
(socket tap, IRC parser, browser API), `config`, `i18n`, `ui`. Tests mirror it.

## Scoring

Source of truth: `WEIGHTS` in [src/core/analyzer.js](../src/core/analyzer.js).
The ten account signals sum to 100; `HARD_SIGNAL_WEIGHTS.solicitation` adds
+25 on top.

| Key | Pts | Key | Pts |
| --- | :---: | --- | :---: |
| `no-badges` | 15 | `fresh-account` | 10 |
| `id-cluster` | 15 | `wave` | 10 |
| `default-color` | 10 | `self-repeat` | 10 |
| `username-digits` | 10 | `mechanical-rhythm` | 5 |
| `first-msg` | 10 | `sterile-text` | 5 |

Unknown account age adds 0. Privileged badges and `SERVICE_BOT_LOGINS` are
exempt. `id-cluster` was cut to 15 when the ID window grew tenfold, and the old
`mechanical` 10 was split into rhythm 5 + sterile text 5 for filtering.

## Notes

- The MAIN world is shared with Twitch, so `inject.js` payloads are accepted
  only with the per-page-load token from the content script's handshake. E2E
  asserts a forged message is dropped.
- E2E serves a local fixture at `https://www.twitch.tv/`; Chrome dropped
  `--load-extension`, so Playwright's Chromium is used.
- Session capture schema 1: UTC timestamps, setting changes, minute summaries,
  viewer samples, gaps, raids, anomalies, last ten minutes of messages.

```bash
node tools/analyze-capture.mjs --snapshot snapshot.json [--reference viewers.jsonl]
node tools/analyze-capture.mjs --chat chat.jsonl --viewers viewers.jsonl [--json out.json]
```

Raw captures contain public nicknames — for `--snapshot`, one JSON per line
with `ts` (epoch ms); `testing_logs/` and audit exports are git-ignored.

## Release

Run the **Release** workflow manually for a rehearsal; it runs the checks,
rebuilds the source ZIP cleanly and parallelises browser E2E. Pushing a tag
`vX.Y.Z` matching all three version fields publishes the GitHub Release.
`AMO_JWT_ISSUER` / `AMO_JWT_SECRET` enable Mozilla signing. Keep the Gecko ID
and `data_collection_permissions: none`: both are required to keep Firefox
users updating. `npm run package` must run on a clean checkout.
