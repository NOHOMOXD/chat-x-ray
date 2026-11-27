export function erPercent(cleanUsers: number | null, viewers: number) {
  if (
    cleanUsers === null ||
    !Number.isFinite(cleanUsers) ||
    cleanUsers < 0 ||
    !Number.isFinite(viewers) ||
    viewers <= 0
  ) {
    return null;
  }
  return Math.round((cleanUsers / viewers) * 10000) / 100;
}


export function median(values: number[] | null | undefined) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? null : Math.round((lower + upper) / 2);
}

