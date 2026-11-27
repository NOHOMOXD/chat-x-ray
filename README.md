# Chat X-Ray for Twitch

**English** · [Русский](README.ru.md)

Chat X-Ray flags suspicious accounts in Twitch chat and estimates the audience from chat activity. Everything runs in your browser. Available in English and Russian for Chrome, Edge, Opera, and Firefox.

Safari is not currently supported.

> Not affiliated with Twitch Interactive, Inc.

## What you see

- **Bot badge.** A `BOT 65` chip before a suspicious nickname, gold to red.
  Hover it to see which signs added points. Moderators, VIPs, subscribers, the
  broadcaster and known service bots are never flagged.
- **Chat filter.** Near-duplicates, pastes and character floods from the last
  15 minutes are muted or hidden if you want.
- **Viewer estimate.** An estimated audience size appears next to Twitch’s official count.

- **Chat activity.** The first message shows the unique chatter count. The viewer range appears when enough activity has been observed.
- **Red warnings.** A wave of suspicious accounts, low chat-to-viewer ratio or
  a spike and collapse in viewers turns the counter and chat bar red.
- **Session export.** Optional JSON of everything seen this session.

## Quick start

1. Install the extension — steps below.
2. After the first audience message, the chatter count appears in parentheses, for example (33). Hover to see collection progress, message totals and stream events.
3. The estimate appears after one minute of observation, five audience messages and two chatters after filtering.

After a break of up to two minutes, the calculation resumes from the saved window for the same broadcast. Time away is excluded. After a longer break, the previous compatible estimate and its age remain visible until a fresh range is ready.

## Install

1. Open **[Releases](https://github.com/NOHOMOXD/chat-x-ray/releases)** and download the latest
   `chat-x-ray-vX.Y.Z-chrome-opera.zip` (Chrome, Edge, Opera) or
   `chat-x-ray-vX.Y.Z-firefox.zip` (Firefox).
2. Unzip it into a folder you keep.
3. Load it:
   ```text
   Chrome / Edge / Opera   chrome://extensions  → Developer mode → Load unpacked → that folder
   Firefox 140+            about:debugging#/runtime/this-firefox → Load Temporary Add-on → manifest.json
   ```
   A Firefox temporary add-on disappears on restart — use the signed `.xpi` if
   the release has one.
4. Open any Twitch channel.


Building from source is for development only: [Development](docs/development.md).

## Settings

Twitch's own **Chat Settings** (gear under chat) gets a **Chat X-Ray Settings**
row at the bottom, like BetterTTV. There is also a gear in the chat header and
a settings page in the extension itself.

- What to do with flagged accounts: keep, mute or hide.
- What the chat filter does with repeats: mute or hide.
- Bot threshold (default **30**), chat bar, viewer counter, session recording,
  optional account-age check, interface language.

## Your data

One permission, `storage`. Nothing is sent anywhere by default. The only
exception is the optional account-age check, which you switch on yourself:
[Privacy](docs/privacy.md).

## Docs

| Page | Contents |
| --- | --- |
| [How the analysis works](docs/algorithm.md) | Signs, chat filter, viewer estimate, limits |
| [Privacy](docs/privacy.md) | Permissions, stored data, the optional lookup |
| [Install and updates](docs/distribution.md) | Per-browser steps and updates |
| [Optional Twitch data](docs/twitch-api-options.md) | What the Twitch APIs could add |

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
