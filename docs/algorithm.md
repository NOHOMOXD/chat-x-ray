# How the analysis works

One page, no history. The extension is local-only: it reads the chat IRC socket
the page already opened, scores each account, and estimates viewers from chat
engagement. Nothing is sent anywhere.

## Bot score (0–100)

Each unbadged signal adds points; the matrix sums to exactly 100.

| Signal | Key | Points | Meaning |
| --- | --- | :---: | --- |
| No badges | `no-badges` | 15 | Account carries no chat badge at all |
| Default colour | `default-color` | 10 | Never picked a username colour |
| Numeric name | `username-digits` | 10 | `gamer_4892` style bot-farm nicknames |
| Fresh account | `fresh-account` | 10 | Empty profile with a very new user id |
| First message | `first-msg` | 10 | `first-msg=1` from Twitch |
| Id cluster | `id-cluster` | 15 | 2+ other empty accounts within 50 000 ids |
| Bot wave | `wave` | 10 | Chat spike among unbadged accounts only |
| Mechanical rhythm | `mechanical-rhythm` | 5 | Near-identical gaps between messages |
| Sterile text | `sterile-text` | 5 | Long plain sentence, no slang or emoji |
| Self-repeats | `self-repeat` | 10 | Same person posting near-identical text |

**HARD_SIGNAL** — `solicitation` adds **+25 on top** of the matrix: scam and
begging scripts ("free nitro", "dm me, send crypto"). It is message content, not
an account profile, so it is deliberately not part of the 100.

Moderators, VIPs, subscribers, broadcasters and known service bots
(`nightbot`, `fossabot`, …) are exempt and always score 0.

Default threshold: **25%**. A plain unbadged account sits exactly on that line;
adding any second signal pushes it over.

## Client-side R9K

Exact normalised duplicates are matched in a 15-minute index; fuzzy matching
scans the last 1 000 messages. Short messages (`lol`, `rofl`) use a lower
threshold so a single changed letter still matches. Character floods
(`🍅🍅🍅🍅`, `wwwwww`) bypass R9K matching and go straight to the chosen
action (mute or hide).

## Live viewer estimate

The official Twitch number is never modified. A range is appended next to it.

Viewbots watch the video without joining IRC, so the bot share of *chat* says
nothing about the bot share of *viewers*. Subtracting it is the mistake that
produced the old inflated 35 000–37 000 figure. Instead:

- on an organic stream roughly **8–12.5%** of the live audience writes in chat
  within 10 minutes;
- each **clean** unique chatter therefore represents about 8–12.5 viewers;
- the range is capped by the official count (bots only inflate it) and by the
  number of chatters actually seen.

**ER** (engagement rate) = clean chatters ÷ official viewers. Below **2.5%** on
a 1 000+ viewer stream it raises a warning. A per-channel baseline ("usually
4.8% here") is stored locally per threshold, so a channel is compared to itself.

**Churn**: the official number is sampled over time. A drop of
`max(4%, 300)` that recovers to 98% of the peak within 5 minutes counts as a
rollback — the signature of bot rotation.

## Loading progress

Until enough chat has been observed the counter reads
`73 069 (Загружаю… 66%)` / `(Loading… 66%)`. The percentage is the progress of
three gates: 2 minutes observed, 2 clean chatters, 5 messages. Once all pass it
becomes 100% and is replaced by the range.

## Red states

One predicate drives every red element, so red always means the same thing:

- a **bot wave** in chat, or
- a **warn/critical** viewer verdict (low ER, churn), or
- a suspicious share at or above **your own threshold**.

## Known limits

- The viewer estimate is a heuristic, not a measurement.
- ER depends on the threshold and the opt-in account-age lookup.
- Viewbots that only watch the video are invisible in IRC; low ER alone does
  not prove manipulation.
- If Twitch moves the chat socket into a Web Worker, the `window.WebSocket` tap
  stops seeing messages.
