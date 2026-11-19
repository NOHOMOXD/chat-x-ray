# Chat X-Ray for Twitch

A local-only browser extension (Manifest V3) that reads the Twitch chat you
already have open and tells you who in it looks like a bot. Chrome, Edge, Opera
and Firefox. RU / EN.

Nothing leaves the tab: no servers, no accounts, no analytics.

> Not affiliated with, endorsed by, or sponsored by Twitch Interactive, Inc.

## What it does

- **Bot badges.** Each suspicious account gets a `BOT 65%` chip before the
  nickname, colour-graded from gold to red. Hover for the exact signals.
- **Adaptive R9K.** Catches pastes, near-duplicates and character floods across
  a 15-minute window, optionally muting or hiding them.
- **Live viewer estimate.** Next to Twitch's official number:
  `73 069 (≈8–12,5 тыс.)` — extrapolated from clean unique chatters, never
  modifying the official count.
- **Loading progress.** Until the sample is big enough the counter says
  `(Загружаю… 66%)` / `(Loading… 66%)` instead of showing a guess.
- **Red states.** A bot wave, a bad viewer verdict, or a suspicious share past
  your own threshold turns the counter and the stats strip red.
- **Audit log.** Optional JSON export of everything flagged this session.

Scores, thresholds, the viewer model and its limits: **[docs/algorithm.md](docs/algorithm.md)**.

## Install

### From source

```bash
git clone <this repo>
cd chat-x-ray
npm install
npm run build:all
```

**Chrome / Edge / Opera** — `chrome://extensions` → enable *Developer mode* →
*Load unpacked* → `dist/chrome`.

**Firefox 140+** — `about:debugging#/runtime/this-firefox` → *Load Temporary
Add-on…* → `dist/firefox/manifest.json`.

### Stores

Firefox and Edge are free to publish to; the Chrome Web Store charges a one-time
$5. Signing and publishing are scripted — see
**[docs/distribution.md](docs/distribution.md)**.

## Settings

Open Twitch's own **Chat Settings** (the gear under chat). A **"Chat X-Ray
Settings"** row sits at the bottom, like BetterTTV's. There is also a gear button
in the chat header.

Everything is there: badge visibility, threshold (default **30%**), muting or
hiding, client-side R9K, the stats strip, the viewer counter, the audit log,
the opt-in account-age lookup, and the interface language.

## Privacy

Local-only, one permission (`storage`), no network by default. Full detail:
**[docs/privacy.md](docs/privacy.md)**.

## Development

```bash
npm test            # unit + DOM tests (Vitest, happy-dom)
npm run test:e2e    # real build loaded in Chromium (Playwright)
npm run verify      # everything CI runs
npm run build:all   # dist/chrome + dist/firefox
```

Layout, scripts and testing notes: **[docs/development.md](docs/development.md)**.

## Documentation

| Doc | Contents |
| --- | --- |
| [algorithm.md](docs/algorithm.md) | Scoring matrix, R9K, viewer model, red states, limits |
| [privacy.md](docs/privacy.md) | Permissions, storage, the opt-in GQL lookup, bridge token |
| [development.md](docs/development.md) | Setup, scripts, project layout, testing |
| [distribution.md](docs/distribution.md) | Stores, fees, signing, releases |
| [twitch-api-options.md](docs/twitch-api-options.md) | What Twitch APIs could and could not add |

## License

MIT — see [LICENSE](LICENSE). Bundled third-party code: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
