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

## Persistent installation in Firefox

Firefox Release and Beta require a Mozilla-signed add-on for persistent installation. You can submit the package for self-distribution without listing it publicly, then install the signed `.xpi`; you do not need to buy your own certificate. Each new version must be signed again, and without a configured update URL it must be installed manually. See Mozilla's [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) and [self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/).

`npm run package` produces an unsigned Firefox ZIP for temporary installation. The release workflow can also obtain a signed `.xpi` when AMO secrets are configured; without them the ZIP remains unsigned.

