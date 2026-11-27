const encoder = new TextEncoder();

function sizeOf(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}

// Keep the newest broadcasts first, then discard the oldest group windows.
export function trimHistoryToSize<T extends { checkpoint: { groups: unknown[] } }>(records: T[], maxBytes: number) {
  if (records.length > 1 && sizeOf(records) > maxBytes) {
    let low = 1;
    let high = records.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (sizeOf(records.slice(0, middle)) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    records.splice(low);
  }

  const record = records[0];
  const groups = record?.checkpoint?.groups;
  if (!record || !groups?.length || sizeOf(records) <= maxBytes) return records;

  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = [{ ...record, checkpoint: { ...record.checkpoint, groups: groups.slice(middle) } }];
    if (sizeOf(candidate) <= maxBytes) high = middle;
    else low = middle + 1;
  }
  groups.splice(0, low);
  return records;
}
