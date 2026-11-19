# Privacy and permissions

The extension is **local-only**.

- **No network requests by default.** Tippy.js is bundled; no fonts, analytics
  or update pings.
- **Only the `storage` permission** is requested. An extension background worker serializes local history writes from open tabs.
- Raw messages and the tab audit buffer live in memory. A downloaded JSON file
  contains the evidence selected for that export.
- Extension-local storage holds settings and broadcast history, including
  coverage intervals, ER, saved measurements, event totals and group ID
  membership with phrase fingerprints. The store keeps up to 20 broadcasts
  per channel under a shared size limit. Use **Clear broadcast history** in the
  Twitch settings panel to clear those records on this browser profile.
- Stream identity can use Twitch metadata which the page already requested.
  The extension does not issue a separate request for broadcast history.
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
