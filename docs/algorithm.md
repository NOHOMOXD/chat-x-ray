# How the analysis works

The extension observes the chat IRC connection and viewer counter in the
current Twitch tab. Session capture is opt-in and lives in that tab's memory.
The account-age option can request profile creation dates from Twitch.

## Bot score (0–100)

Each unbadged signal adds points; the matrix sums to exactly 100.

| Signal | Key | Points | Meaning |
| --- | --- | :---: | --- |
| No badges | `no-badges` | 15 | Account carries no chat badge at all |
| Default colour | `default-color` | 10 | Never picked a username colour |
| Numeric name | `username-digits` | 10 | `gamer_4892` style bot-farm nicknames |
| Fresh account | `fresh-account` | 10 | Empty profile and confirmed account age below 90 days |
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

**Account age.** The badge tooltip shows the confirmed age when available.
A confirmed age below 90 days adds 10 points for eligible empty profiles.
Unknown age and ages of 90 days or more contribute zero points.
Older exports may contain a negative `veteran-account` trigger.

Default threshold: **30 points**. A plain unbadged account with the default colour
scores 25 and stays below that line, because many ordinary viewers never pick
a badge or a colour. A second signal adds at least 5 points and crosses it.

## Client-side R9K

Exact normalised duplicates are matched in a 15-minute index; fuzzy matching
scans the last 1 000 messages. Short messages (`lol`, `rofl`) use a lower
threshold so a single changed letter still matches. Character floods
(`🍅🍅🍅🍅`, `wwwwww`) bypass R9K matching and go straight to the chosen
action (mute or hide).

## Live viewer estimate

The range beside the official count assumes that 8–12.5% of the audience
writes within ten minutes. It multiplies unique authors by 8 and 12.5, uses
the median official count as a cap, and extrapolates from shorter windows.
Known service bots count toward chat traffic and are excluded from audience
estimation. An author crosses the chosen threshold if any message in the
window crosses it.

- After one full minute, the popover shows unique authors, total messages,
  and the change in official viewers when both ends of the minute were observed.
- Two minutes, two eligible authors and five non-service messages unlock the
  preliminary range. The popover shows the observation window.
- At ten continuous minutes, the ER verdict can use the complete window.
  ER divides eligible authors by the current Twitch count. The existing 2.5%
  warning at 1,000+ viewers and 6% informational band are heuristic thresholds.

Broadcast history begins after a confirmed stream ID or an absolute start
time. A comparable ER sample requires ten continuous minutes of chat and
viewer counts. The first complete sample is saved immediately. The extension
keeps up to one ER sample per minute and uses one median per broadcast, with
up to 20 recent broadcasts under each channel. The threshold, account-age
setting and scoring version determine comparison eligibility. The previous
broadcast is shown once available. With five or more, the UI shows the median
and interquartile range. The active broadcast contributes starting with the
next broadcast. The previous tab-session baseline lacks a broadcast ID and
is excluded from these comparisons.

Chat and viewer coverage are accumulated independently. Overlapping intervals
are merged and missing time contributes zero. The live ten-minute comparison
requires continuous coverage after a break. The export includes coverage
intervals and the saved broadcast event journal alongside the tab recording.

## Viewer count anomalies

A viewer drop is confirmed after a second sample, at least 15 seconds later,
still at least 4% and 300 viewers below the recent three-minute peak. Further
lows update that same event. Recovery to 98% of the peak within five minutes
also increments the existing drop-and-recovery counter used by verdicts.
Without recovery the drop stays in the session totals and export. Gaps close
the open event as interrupted and reset the comparison baseline.

A surge candidate requires at least 15% and 3,000 viewers of growth within
two minutes. The first qualifying crossing is recorded, and subsequent
samples within two minutes are grouped into the same observation. A rollback
recovery does not create another surge. For comparison the event records
chat rates for the two preceding minutes and the rise itself when chat
coverage is available. A zero baseline leaves the ratio undefined. The most
recent raid within three minutes is attached with its announced size when
available. A surge by itself is a report of a count change.

## Session capture and replay

Turn on **Record session statistics** in the in-chat settings. Download the
current capture or the most recently completed one from the same menu. A
channel change or turning recording off completes the current capture.
Closing the tab releases the captures.

Schema version 1 includes timestamps in UTC (ISO strings or Unix
milliseconds), setting changes, minute summaries, actual viewer samples,
gaps, raids and anomalies, plus the messages still available in the most
recent ten minutes of recording. Chat can continue through a gap in the
viewer series. A socket closure resets the chat window. Exported messages
include public chat text and author IDs used to deduplicate and compare scores.
For each covered window the diagnostics include alternate action thresholds
and whether account age changed the classification.

Run `node tools/analyze-capture.mjs --snapshot snapshot.json` to rebuild the
latest viewer range, inspect alternate assumptions and compare the early
minutes with the first full window. Add `--reference viewers.jsonl` to compare
event times with a separate public timeline. Each reference line has numeric
`ts` (epoch milliseconds) and `viewers`. The original
`--chat chat.jsonl --viewers viewers.jsonl` input remains supported. A legacy
audit array can provide trigger counts for the selected messages it contains.

## Popover status and event history

The viewer counter and chat strip each show their own status. Gray marks
insufficient or unavailable data. Green marks ready data without an active
warning. The viewer counter highlights low ER or an online anomaly confirmed
in the last 15 minutes. The chat strip highlights the configured suspicious
author share or a wave, with at least 30 seconds of indication from detection.
The viewer popover includes a short chat warning when both signals are relevant.

A detected chat wave adds one `chat-wave` event per 20-second bucket to the
session export. The event tracks the number of boosted messages and unique
authors until the bucket ends. The chat popover retains the final wave and
session count. A surge can carry a preceding drop measured against a peak in
the five minutes before the rise, using the existing drop threshold.

The viewer popover shows elapsed session time and coverage of the rolling
10-minute chat window. Session exports include the last available timed viewer
model separately, so a stream can end with no current measurement. The offline
audit reports coverage alongside each chat rate and marks legacy wave history
as unknown when only partial message records are available.

## Known limits

- The viewer estimate is a heuristic, not a measurement.
- ER depends on the threshold and the opt-in account-age lookup.
- Viewbots that only watch the video are invisible in IRC; low ER alone does
  not prove manipulation.
- If Twitch moves the chat socket into a Web Worker, the `window.WebSocket` tap
  stops seeing messages.


## Dense ID group diagnostics

Every minute the analyzer finds distinct unbadged authors active in the last
ten minutes. It takes the densest interval narrower than 50,000 IDs with at
least six authors, breaks ties by lower ID, and repeats on remaining authors.
Session exports include the groups per minute and an extra snapshot at each
wave trigger. R9K diagnostics distinguish self matches, other members,
outsiders, and unavailable source messages.

The exported comparison replaces the existing cluster bonus with the same
weight for membership in a dense group. Both branches use the confirmed age
rule. The comparison measures score and viewer range sensitivity. Reviewers
can sample changed authors with the score concealed and label coordination
as likely, unlikely, or unclear using the available chat context.

Across broadcasts, group diagnostics track repeated ID bands, repeated members
and the same members sharing a rarely used phrase. Only the exported experiment
applies the five-point recurrence adjustment.
