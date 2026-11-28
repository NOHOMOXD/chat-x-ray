# Development

**English** · [Русский](ru/development.md)

Users install a release ZIP — [README](../README.md#install). This page is for
building and maintaining.

## From source

Node 24+.

```bash
npm ci
npm run build:all    # dist/chrome, dist/firefox
```

Load `dist/chrome` as an unpacked extension, `dist/firefox/manifest.json` as a
temporary add-on.

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Check migrated TypeScript sources and tests |
| `npm test` | Unit + DOM tests (Vitest, happy-dom) |
| `npm run build` / `build:firefox` | One target |
| `npm run build:all` | All targets |
| `npm run dev` | Rebuild on change |
| `npm run test:e2e` | Real build in Playwright's Chromium and Firefox |
| `npm run lint:firefox` | `web-ext lint` |
| `npm run verify` | What CI runs |
| `npm run package` | Browser and source ZIPs in `release/` |

`src/` holds `app` (controller, background, options page), `core` (analyzer,
R9K, ID groups), `analysis` (viewer estimate, history, capture), `platform`
(socket tap, IRC parser, browser API), `config`, `i18n`, `ui`. Tests mirror it.

## Scoring

Source of truth: `WEIGHTS` in [src/core/score-message.ts](../src/core/score-message.ts).
The ten account signals sum to 100; `HARD_SIGNAL_WEIGHTS.solicitation` adds
+25 on top.

| Key | Pts | Key | Pts |
| --- | :---: | --- | :---: |
| `no-badges` | 15 | `fresh-account` | 10 |
| `id-cluster` | 15 | `wave` | 10 |
| `default-color` | 10 | `self-repeat` | 10 |
| `username-digits` | 10 | `mechanical-rhythm` | 5 |
| `first-msg` | 10 | `sterile-text` | 5 |

Unknown account age adds zero points. The official Twitch `bot-badge` and known service logins identify service bots. Audience counts exclude them. Privileged roles in the current channel are exempt from scoring. R9K still checks repeated messages.

Additional group and history signals and badge conditions are described in [How the analysis works](algorithm.md#badges-and-scores).

## Notes

- The MAIN world is shared with Twitch, so `inject.js` payloads are accepted
  only with the per-page-load token from the content script's handshake. Page
  scripts can see the token and forge messages. E2E checks rejection of a packet without the token.
- E2E serves a local fixture at `https://www.twitch.tv/`; Chrome dropped
  `--load-extension`, so Playwright's Chromium is used.
- Session capture schema 3: UTC timestamps, setting changes, minute summaries,
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

## Reading the code

The MAIN-world tap in `src/platform/inject.ts` feeds the IRC parser in
`src/platform/irc-parser.ts`. `MessageBridge` validates the envelope and
`ChatXRayApp.processMessages` in `src/app/app-controller.ts` sends chat messages through `src/app/process-chat-message.ts` to `Analyzer.ingest`. The browser entry point is `src/app/content.ts`.
Base scoring and its reasons live in `src/core/score-message.ts`, repeat
matching in `src/core/r9k-matcher.ts`, and row actions in
`src/ui/chat/row-mode.ts`. Settings normalization and persistence live in
`src/config/settings-model.ts` and `src/config/settings.ts` respectively.
The settings window lives in `src/ui/settings/settings-panel.ts`; integration
with Twitch's header and menu lives in `src/ui/settings/twitch-settings-integration.ts`
and `src/ui/settings/twitch-settings-host.ts`.
Broadcast history is managed by `src/analysis/broadcast-history.ts` and
short-lived tab snapshots by `src/platform/tab-checkpoints.ts`.
