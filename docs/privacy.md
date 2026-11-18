# Privacy and permissions

The extension is **local-only**.

- **No network requests by default.** Tippy.js is bundled; no fonts, analytics
  or update pings.
- **Only the `storage` permission** is requested. No host permissions, no
  background worker.
- Messages, scores and the audit log live **in tab memory** and disappear when
  the tab closes.
- `chrome.storage.local` holds only: your settings and the per-channel ER
  baseline (`channel|threshold` → up to 5 recent sessions).
- The only optional network call is the **account-age lookup**
  (`accountAgeLookup`, off by default): a POST to `gql.twitch.tv` asking for
  `user.createdAt` of accounts that already look suspicious. It is an
  unofficial endpoint, sends no cookies (`credentials: omit`) and is the only
  thing that leaves the browser — and only while the setting is on.

## Bridge integrity

Content scripts cannot see the page's `window.WebSocket`, so a MAIN-world
script taps it and forwards parsed messages to the isolated content script.

Because the MAIN world is shared with Twitch and every other extension, a plain
`postMessage` would be forgeable: any page script could inject fake chat and
make the extension badge innocent users. The content script therefore generates
a random **per-page-load token**, hands it to the tap in a handshake, and drops
every payload that does not carry it.

Firefox declares `data_collection_permissions: none` in its manifest, which is
an accurate description of the above.
