interface TimedRecord { ts: number }
export interface ViewerSample { ts: number; value: number }
export interface MinuteStats {
  topAuthorMessages: number;
  audienceMessages: number;
  messagesPerMinute: number;
  minuteUsers: number;
}

/** Unknown is different from zero when chat observation did not cover the interval. */
export function countObservedMessages(records: TimedRecord[], chatSince: number | null, from: number, to: number): number | null {
  if (chatSince === null || from < chatSince) return null;
  return records.reduce((count, record) => count + Number(record.ts > from && record.ts <= to), 0);
}

export function buildMinuteSnapshot(now: number, chatSince: number | null, samples: ViewerSample[], stats: MinuteStats) {
  if (chatSince === null || now - chatSince < 60000) return null;
  let start: ViewerSample | undefined;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample && sample.ts <= now - 60000) {
      start = sample;
      break;
    }
  }
  const end = samples.at(-1);
  return {
    topAuthorMessages: stats.topAuthorMessages,
    audienceMessages: stats.audienceMessages,
    messages: stats.messagesPerMinute,
    authors: stats.minuteUsers,
    from: start && now - start.ts <= 66000 && end && now - end.ts <= 6000 ? start.value : null,
    to: end?.value ?? null,
  };
}
