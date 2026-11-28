# Privacy

**English** · [Русский](ru/privacy.md)

Everything works on your computer.

- **One permission, `storage`.** No accounts, no analytics, no telemetry, no
  update pings. The tooltip library ships with the extension.
- **Stored:** settings, and up to 20 recent broadcasts per watched channel
  (coverage, chat rate, measurements, event counts, IDs of accounts in
  suspicious groups). **Clear broadcast history** in the settings removes them.
- **Not stored:** chat messages live in tab memory only, unless you export a
  session. The downloaded JSON is never read back.
- **In-page transfer:** the extension passes messages between its own scripts
  inside the page, with a random token per page load. Scripts on the page can see the token
  and can forge chat messages.

## The one optional request

The **account-age check** is on by default. When enabled, it asks
`gql.twitch.tv` — the endpoint twitch.tv itself uses — for the creation date of
accounts that scored at least 30 points or could still reach your threshold.
Requests are batched, rate-limited, carry no cookies, and results stay in tab
memory. Turn the setting off and no network traffic remains.

Firefox's manifest declares no data collection, which matches the above.
