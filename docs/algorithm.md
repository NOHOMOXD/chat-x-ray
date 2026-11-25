# How the analysis works

**English** · [Русский](ru/algorithm.md)

The extension watches the chat connection and viewer counter of the Twitch tab
you have open. Nothing is analysed on a server.

## Bot score

Each suspicious sign adds points, up to 100 in total. The number in the `BOT`
chip is that score.

- **Profile.** No chat badges, default username colour, numeric username,
  brand-new account, first-ever message.
- **Behaviour.** Near-identical repeats from one author, mechanical rhythm,
  plain text with no slang or emoji, and nearby account IDs — accounts created
  in one batch share an ID range, so two or more empty profiles close together
  is a strong sign of a farm.
- **Wave.** A sudden burst of messages from unbadged accounts boosts everyone
  caught in it.
- **Scam text.** A match for a known solicitation pattern adds 25 points.

A neutral numeric badge shows a score at or above the threshold without a behavioral trigger. These authors count toward the audience.

Moderators, VIPs, subscribers, the broadcaster and known service bots always score 0. The repeat filter can still mute or hide messages from users with privileged roles.

Default threshold: **30**, adjustable from 10 to 100. A BOT label also requires self-repetition, mechanical rhythm or a solicitation match. A newcomer with 35 profile points stays in the audience count. A dense ID group gets a neutral ID label. Recurring group phrases earn a bonus when the author has a behavioral signal.

## Chat filter

Exact repeats are matched across the last 15 minutes, near-duplicates within
the last 1 000 messages, and short replies like `lol` more loosely. Character
floods (`🍅🍅🍅`) are matched directly and go to the action you chose.

## Viewer estimate

The estimate assumes that 8–12.5% of viewers write in chat over ten minutes. It counts distinct authors who were not flagged as suspicious and multiplies that count by 8 and 12.5 to get the lower and upper bounds. For shorter observations, it first scales the author count to a ten-minute window, up to fourfold. Both bounds are capped by the current Twitch count and its recent median when available.

- One minute shows writers, messages and how the official count moved.
- The label shows the observation duration. Observations under five minutes widen the range.
- Ten continuous minutes give the full rating, including engagement (ER) —
  clean authors divided by the official count. The 2.5% warning at 1 000+
  viewers and the 6% middle band are heuristics.

All chat modes share one rolling estimate window, including unknown access. The popover shows restrictions and changes within the window. Only ten continuous minutes of open chat qualify for a low-engagement alert. Mixed and unknown windows are excluded from historical comparisons. Chat statistics show the most active author’s share over up to ten continuous minutes, excluding service bots.

Chat and viewers are tracked separately: overlapping periods merge, gaps count
as nothing, and after a break the ten-minute window starts over.

## History

With a known stream ID or start time, one engagement sample per minute is kept
for up to 20 broadcasts per channel. Only broadcasts with the same threshold,
account-age setting, room mode and scoring version are compared. A historical match cannot clear a low-engagement warning. The previous broadcast is
shown at once; from five, the median and middle 50% range appear.

## Viewer anomalies

A rise or drop must exceed or equal the same threshold in either direction: `max(500, min(3000, 0.30 × min(A, B)))`. The reference is a median over up to 20 seconds within the previous two minutes, with at least three readings spanning 15 seconds. The change must persist for 15 seconds. Recovery within five minutes belongs to the original drop.

The chat bar and counter have their own colours: grey while data is not ready,
green when ready, red for a low ER, an anomaly in the last 15 minutes or a
suspicious share of authors above your threshold.

## Known limits

- The estimate is an educated guess, not a measurement.
- A viewbot that only watches the video never appears in chat; a low ER alone
  proves nothing.
- Account age is used only when known.
- If Twitch moves chat off the page connection, the chat analysis sees nothing.

## Related features

- Audit export of every flagged account, and a JSON session recording with
  minute summaries, viewer samples and telemetry.
- Dense ID groups, useful when a farm uses a contiguous block of IDs.

Details and the exact weights: [Development](development.md).
