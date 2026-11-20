# Optional Twitch data

**English** · [Русский](ru/twitch-api-options.md)

The extension needs no account, token or server. This page explains why, and
what Twitch APIs could add.

| Data | Helix | Catch |
| --- | --- | --- |
| Account age | `GET /helix/users?login=` | Needs an OAuth token |
| Stream stats | `GET /helix/streams?user_login=` | Token, rate limits |
| Subscribers / followers | `/helix/subscriptions`, `/helix/channels/followers` | Own channel only |
| Current chatters | `GET /helix/chat/chatters` | Moderator rights on that channel |
| Who is watching | — | Twitch does not expose it |

A Client Secret cannot ship inside an extension, so Helix would mean a backend —
which defeats the "no server" property. The optional account-age check instead
uses the public GQL endpoint twitch.tv itself calls: no user token, no cookies,
batched and rate-limited, and unstable by nature, which is why it is opt-in.
