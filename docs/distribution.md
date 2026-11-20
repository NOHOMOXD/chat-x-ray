# Install and updates

**English** · [Русский](ru/distribution.md)

## What a release contains

| File | For |
| --- | --- |
| `chat-x-ray-vX.Y.Z-chrome-opera.zip` | Chrome, Edge, Opera |
| `chat-x-ray-vX.Y.Z-firefox.zip` | Firefox (temporary install) |
| `*.xpi` | Firefox, signed — only if AMO secrets are configured |
| `chat-x-ray-vX.Y.Z-source.zip` | Building from source |
| `SHA256SUMS.txt` | Checksums |

For an unpacked install, extract the archive ending in `-chrome-opera.zip` or `-firefox.zip` for your browser. Its top-level folder contains `manifest.json`. Follow the [installation steps](../README.md#install).

Optional, to verify a download:

```bash
shasum -a 256 -c SHA256SUMS.txt   # macOS
sha256sum -c SHA256SUMS.txt       # Linux
```

## Updates

Replace the files in the **same** folder and reload the extension on its
extensions page — otherwise the browser installs it as a new one. Firefox
temporary add-ons are loaded again after every restart. Export anything you
want to keep before uninstalling: local storage, including broadcast history,
can be removed with the extension.

## Safari on Mac

There is no "load unpacked" in Safari. Needs full Xcode and Safari 18+:

```bash
npm ci
npm run package:safari    # Xcode project in release/
```

Open the project, run the macOS app scheme once, then allow unsigned extensions
in Safari's developer settings, enable Chat X-Ray and grant it access to Twitch.
Quicker local check on Safari 18.4+: `npm run build:safari`, then **Add
Temporary Extension** with `dist/safari`. Apple documents
[signed distribution and unsigned local testing](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).
