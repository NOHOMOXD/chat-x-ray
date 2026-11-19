# Distribution

**English** · [Русский](ru/distribution.md)

GitHub Releases carry the Chromium ZIP for Chrome and Opera, the Firefox ZIP,
the source ZIP, the macOS Safari Xcode project ZIP and SHA-256 checksums.
Verify a downloaded release with `shasum -a 256 -c SHA256SUMS.txt` on macOS
or `sha256sum -c SHA256SUMS.txt` on Linux.

| Browser | Installation from a release |
| --- | --- |
| Chrome | Unzip the Chromium ZIP. At `chrome://extensions` enable Developer mode and select **Load unpacked**. |
| Opera | Unzip the same ZIP. At `opera://extensions` enable Developer mode and select **Load unpacked**. |
| Firefox | Install the signed XPI when present. For temporary use, unzip the Firefox ZIP and select its manifest under **Load Temporary Add-on** in `about:debugging#/runtime/this-firefox`. |
| Safari on Mac | Unzip the Safari project, open the Xcode project, select the macOS app scheme, and run it locally. Enable unsigned extensions using Safari's developer settings, enable Chat X-Ray in Safari Settings, and grant Twitch access. |

The Safari project route uses full Xcode and Safari 18 or later. For a quick
local test on Safari 18.4 or later, build the resources with
`npm run build:safari` and load `dist/safari` via **Add Temporary Extension**
in Safari's developer settings. It is intended for
local development and testing. The project archive uses the free workflow
described by [SponsorBlock](https://github.com/ajayyy/SponsorBlock/wiki/Safari#build-it-yourself-free).
Apple documents [signed distribution and unsigned local testing](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).

For a local 1.5.0 build, keep the original Chromium unpacked directory when
replacing the build and try reloading the extension. For Firefox, keep the
existing Gecko ID and profile. Export any audit data you want to retain before
removing a previous installation. Uninstalling can remove extension storage.

## Release automation

Run the **Release** workflow manually from a pushed branch to rehearse the
release. Download the rehearsal artifact and inspect its checksums and source
inventory. The workflow verifies builds and tests, rebuilds the source ZIP
in a clean directory, and uses full Xcode on macOS to generate and compile the
unsigned Safari project. It assembles archives and checksums before publication.

After review, push the tag matching all three version components, starting
with `v1.0.0`. The tag workflow publishes the GitHub Release with generated
notes. Optional repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`
enable Mozilla signing. Keep the stable Gecko ID for existing Firefox users.

Package locally with `npm ci && npm run package` from a clean Git checkout.
On macOS with full Xcode selected, also run `npm run package:safari`.
The source ZIP uses Git-tracked files at HEAD. Keep raw captures and local
audit results outside the tracked tree.
