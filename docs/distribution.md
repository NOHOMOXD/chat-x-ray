# Distributing the extension

Where it can be published, what it costs, and how releases are automated.

## Stores

| Store | Fee | Review | Notes |
| --- | --- | --- | --- |
| **Mozilla AMO** | none | minutes (unlisted) to a few days (listed) | MV3 accepted; **needs a stable `gecko.id`** |
| **Microsoft Edge** | none | up to 7 business days | Chromium CRX; must justify each permission |
| **Opera** | none | days | Requires a "for Twitch" style name (see below) |
| **Chrome Web Store** | **US$5 once** | hours–days | Only store with a fee; strictest on permissions |

Safari ($99/yr) and Samsung (paired with Play) are paid and out of scope.

**Trademark.** Opera explicitly rejects names implying endorsement. Use a
descriptive name — *"Chat X-Ray for Twitch"* — and keep a disclaimer in the
description. A disclaimer alone is not a legal shield; the neutral name is the
part that matters.

## Without a store

Chrome side-loading is effectively closed: self-hosted CRX has been blocked
since Chrome 75 and `--load-extension` was removed from Google Chrome. Edge and
Chrome both require Developer mode, which non-technical users will not do.

**The one free path for ordinary users is a signed Firefox XPI:**

1. Create an AMO API key at
   <https://addons.mozilla.org/developers/addon/api/key/> (JWT issuer + secret).
2. Sign on the **unlisted** channel — AMO signs the build but never lists it:

   ```bash
   npx web-ext sign --source-dir dist/firefox --channel=unlisted \
     --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" \
     --artifacts-dir release
   ```

3. Host the resulting `.xpi` yourself and add `update_url` to
   `browser_specific_settings.gecko` so Firefox auto-updates from your
   `updates.json`. Users install once via *about:addons → Install Add-on From
   File*.

`gecko.id` is permanent — it is already fixed to `chat-x-ray@local` in
`build.js`. Change it now if you want a domain-shaped id, before the first
public release.

## Releases via GitHub Actions

`.github/workflows/release.yml` runs on every `v*` tag:

1. `npm ci`, `npm test`, `npm run build:all`
2. `web-ext lint` on the Firefox build
3. Sign the Firefox build on the unlisted channel
4. Attach both zips and the signed XPI to the GitHub Release

Required repository secrets:

| Secret | Where to get it |
| --- | --- |
| `AMO_JWT_ISSUER` | AMO API key page |
| `AMO_JWT_SECRET` | AMO API key page |

Store packages are **never committed**. `dist/` and `release/` are ignored;
CI attaches them to the release, and `npm run package` builds them locally.
