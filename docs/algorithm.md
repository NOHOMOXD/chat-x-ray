# How the analysis works

**English** · [Русский](ru/algorithm.md)

The extension observes chat and the Twitch viewer counter in the open tab. Analysis runs on your device.

## Badges and scores

| Badge | Meaning |
| --- | --- |
| `BOT 45` | The score reached the threshold and a behavioural signal was found. The author counts as suspicious. |
| `35?` | The score reached the threshold but no behavioural signal was found. The author counts toward the audience estimate. |
| `ID` | The score is below the threshold, but the author belongs to a dense group of nearby IDs. This badge alone does not mark the author as suspicious. |

The default threshold is **30 points**, adjustable from 10 to 100. For example, no badges, no colour and a first message add up to 35 points and `35?`. A mechanical rhythm can then produce `BOT 40`. Confirmation lasts until the broadcast ends. Hover over a badge to see the reasons.

Moderators, VIPs, subscribers, the broadcaster and service bots are exempt from scoring. Service bots are recognised by Twitch's `bot-badge` or a known login.

| Signal | Points | Condition |
| --- | ---: | --- |
| No badges | +15 | The account has no Twitch badges. |
| No colour | +10 | Twitch did not provide a username colour. |
| Digits in username | +10 | A long numeric suffix or a high proportion of digits. |
| First message | +10 | Twitch marked it as the author's first message in the channel. |
| Nearby IDs | +15 | At least two other unbadged accounts appeared in the last 10 minutes with IDs less than 50,000 away. |
| New account | +10 | Known age under 90 days, with no badges or colour. Age lookup is off by default. |
| Wave | +10 | An unbadged account posted during an unusual burst of such messages. |
| Mechanical rhythm | +5 | At least three messages at nearly equal intervals. |
| Sterile text | +5 | A long unbadged message without slang, emoji, links or mentions, subject to further text checks. |
| Self-repetition | +10 | Several messages from the author are sufficiently similar. |
| Scam or solicitation | +25 | An unbadged message matches a scam, sale or payment request pattern. |
| Rare phrase in waves | +10 | The same participants repeat a rare phrase across waves. |
| Author order | +10 | At least three participants appear in the same relative order across three waves. |
| Phrase repeated across broadcasts | +10 | Group participants repeat a rare phrase between broadcasts. |
| Repeated behaviour | +10 | A previously confirmed account repeats the same behavioural signal in a later broadcast. |

The total is capped at 100. `BOT` requires a score at the threshold and at least one behavioural signal: self-repetition, mechanical rhythm, solicitation, a repeated rare group phrase or repeated author order. Nearby IDs and wave participation add points. [Details and source code](development.md#scoring).

An `ID` badge requires at least six unbadged authors in ten minutes whose IDs span less than 50,000. This differs from the +15 rule for nearby IDs.

For rhythm, the average interval must be between one second and 15 minutes, with variation no greater than 8%. Self-repetition requires at least three messages with average similarity above 65%.

## Chat filter

R9K checks exact repeats over 15 minutes and similar messages among the last 1,000 messages in that period. The similarity threshold is 85%, or 75% for short replies. Character floods are filtered too, without adding points.

R9K is on by default and mutes matches. Messages from suspicious authors are also muted by default. Either action can be set to hide in settings. R9K also applies to privileged users.

## Viewer estimate

The model assumes that 8–12.5% of viewers write in chat over ten minutes. It multiplies the number of clean unique authors by 8 and 12.5. For example, 1,000 authors give a range of 8,000–12,500 before the cap based on Twitch's current count and its median.

The first estimate needs **1 minute of observation, 2 clean authors and 5 audience messages**. A partial window is scaled to ten minutes, up to fourfold. The range widens below five minutes. Confidence is low below five minutes, medium below ten and high for a full window.

After a reload or a return to the same confirmed broadcast within two minutes, collection resumes. Time away is excluded. A longer gap starts a new window. The last compatible estimate and its age may appear until the new estimate is ready.

**ER** is clean authors divided by Twitch's current viewer count. After ten minutes, ER below 2.5% triggers a warning at 1,000 or more viewers. Below 6% gives an informational signal. The check applies to open and followers-only chat when the window has no mode changes and slow mode and emote-only are off. Unique-chat mode alone does not block it.

The estimate is approximate. Viewers who do not write are not directly observed, and low ER alone does not prove viewbotting.

## Events and history

A surge or outflow is recorded when a viewer-count change lasts 15 seconds and reaches `max(500, min(3000, 0.30 × min(A, B)))`. The reference is a median of at least three readings over 15–20 seconds within the previous two minutes. Recovery within five minutes is linked to the drop.

The viewer counter turns red for a wave, low ER or a recent viewer-count anomaly. The chat bar separately warns about waves and a high share of suspicious authors. The share uses the same numeric threshold as the score: at a setting of 30, the warning starts at 30% of authors.

When the stream ID or start time is known, up to 20 broadcasts are stored per channel. Comparisons use compatible settings and chat modes. From five broadcasts, the median and middle 50% are shown. Audit export and JSON session recording are available. If the chat connection is unavailable to the page, messages stop reaching the analysis.
