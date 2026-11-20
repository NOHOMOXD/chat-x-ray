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

Moderators, VIPs, subscribers, the broadcaster and known service bots always score 0. The repeat filter can still mute or hide messages from users with privileged roles.

Default threshold: **30**, adjustable from 10 to 100. An unbadged account with
the default colour scores 25 and stays below it; any second sign crosses.

## Chat filter

Exact repeats are matched across the last 15 minutes, near-duplicates within
the last 1 000 messages, and short replies like `lol` more loosely. Character
floods (`🍅🍅🍅`) are matched directly and go to the action you chose.

## Viewer estimate

The estimate assumes that 8–12.5% of viewers write in chat over ten minutes. It counts distinct authors who were not flagged as suspicious and multiplies that count by 8 and 12.5 to get the lower and upper bounds. For shorter observations, it first scales the author count to a ten-minute window, up to fourfold. Both bounds are capped by the current Twitch count and its recent median when available.

- One minute shows writers, messages and how the official count moved.
- Every range carries a confidence label; observations under five minutes widen the range.
- Ten continuous minutes give the full rating, including engagement (ER) —
  clean authors divided by the official count. The 2.5% warning at 1 000+
  viewers and the 6% middle band are heuristics.

Chat and viewers are tracked separately: overlapping periods merge, gaps count
as nothing, and after a break the ten-minute window starts over.

## History

With a known stream ID or start time, one engagement sample per minute is kept
for up to 20 broadcasts per channel. Only broadcasts with the same threshold,
account-age setting and scoring version are compared. The previous broadcast is
shown at once; from five, the median and middle 50% range appear.

## Viewer anomalies

**Drop** — confirmed by a second sample 15+ seconds later, still 4% and 300
viewers below the three-minute peak. **Surge** — 15% and 3 000 viewers of
growth within two minutes; a rollback does not create a new one. Both stay in
the session totals.

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
