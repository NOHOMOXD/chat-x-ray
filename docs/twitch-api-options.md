# Optional data sources (Twitch APIs)

**English** · [Русский](ru/twitch-api-options.md)

The extension is local-only: it reads the page DOM and the IRC socket the page
already opened, and makes no requests by default. That is good for privacy and for store
review, but it has a ceiling — the extension cannot know an account's real age,
or who is actually watching, without an API.

This note records what is worth adding and what is not.

## What Helix (the official API) offers

| Data | Endpoint | Value | Catch |
| --- | --- | --- | --- |
| Account age | `GET /helix/users?login=` | Exact `created_at` | Needs an OAuth token |
| Stream stats | `GET /helix/streams?user_login=` | `viewer_count`, `started_at` | Token, rate limits |
| Subscribers / followers | `/helix/subscriptions`, `/helix/channels/followers` | History | Own channel only |
| Current chatters | `GET /helix/chat/chatters` | Chatter list | Requires moderator rights **on that channel** |
| Who is watching | — | — | Twitch does not expose this |

The extension uses a confirmed creation date for its under-90-day freshness signal. Unknown age contributes zero points. Nearby account IDs are a separate signal.

Helix needs a token, and a Client Secret cannot be shipped in an extension.
The realistic options are a tiny backend that holds the secret (defeats the
"no server" property) or the opt-in GQL path described next.

## Public GQL (unofficial)

`gql.twitch.tv` is what twitch.tv itself uses. With the public web Client-ID it
answers `user(login){createdAt}` without a user token.

This is what `accountAgeLookup` uses, and it is **off by default**:

- requests batched, rate-limited (≥1.2 s apart), capped per page load;
- results cached in tab memory;
- failed lookups leave the age unknown;
- no cookies are sent.

It is undocumented and may change or rate-limit without notice — which is
exactly why it is opt-in and never on the critical path.

## What an API cannot solve

Knowing who watches a stream. Helix has no endpoint for "which accounts are
watching this player", and that is the one signal that would turn the viewer
estimate from inference into measurement. Every public tool in this space,
including this one, works around that with chat engagement.

## Recommendation

Keep the default path network-free. Offer `accountAgeLookup` as the single
opt-in, clearly labelled as unofficial. Do not add a backend.
