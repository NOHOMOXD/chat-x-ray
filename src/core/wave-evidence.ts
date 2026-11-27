import { normalizeText } from './text-analysis.ts';
import { isRare, isSubstantive } from '../analysis/group-history.ts';

interface WaveRecord {
  numericUserId: number | null;
  userKey: string;
  text: string;
  normalized?: string;
  waveBoost?: boolean;
}

interface RarePhrase {
  text: string;
  memberIds: number[];
  substantive: boolean;
  outsideAuthors: number;
}

interface Wave {
  order: number[];
  rare: RarePhrase[];
  outsideCount: number;
}

// Compare first appearances, so flooding a single bucket cannot create an order.
export function waveEvidence(records: WaveRecord[], earlier: Wave[], context: WaveRecord[]) {
  const members = records.filter((record): record is WaveRecord & { numericUserId: number } =>
    Boolean(record.waveBoost && record.numericUserId));
  const order = [...new Set(members.map(r => r.numericUserId))];
  const indices = new Map(order.map((id, i) => [id, i]));
  const outside = new Set();
  const phrases = new Map<string, { speakers: Set<number>; others: Set<string> }>();
  for (const record of members) {
    const text = record.normalized ?? normalizeText(record.text);
    if (!isSubstantive(text)) continue;
    const phrase = phrases.get(text) ?? { speakers: new Set<number>(), others: new Set<string>() };
    phrase.speakers.add(record.numericUserId);
    phrases.set(text, phrase);
  }
  for (const record of context) {
    if (record.numericUserId !== null && indices.has(record.numericUserId)) continue;
    outside.add(record.userKey);
    phrases.get(record.normalized ?? normalizeText(record.text))?.others.add(record.userKey);
  }
  const rare: RarePhrase[] = [];
  for (const [text, { speakers, others }] of phrases) {
    const phrase = { text, memberIds: [...speakers], substantive: true, outsideAuthors: others.size };
    if (isRare(phrase, { outsideAuthorCount: outside.size })) rare.push(phrase);
  }
  const repeated = new Set<number>();
  const ordered = new Set<number>();
  const positions: Array<Map<number, number>> = [];
  for (const wave of earlier) {
    for (const phrase of rare) {
      const previous = wave.rare.find(p => p.text === phrase.text);
      const shared = phrase.memberIds.filter(id => previous?.memberIds.includes(id));
      if (shared.length >= 2) shared.forEach(id => repeated.add(id));
    }
    const pos = new Map(wave.order.map((id, i) => [id, i]));
    if (order.filter(id => pos.has(id)).length >= 3) positions.push(pos);
  }
  for (let i = 0; i < positions.length; i++) {
    for (const b of positions.slice(i + 1)) {
      const a = positions[i];
      if (!a) continue;
      const common = order.filter(id => a.has(id) && b.has(id));
      for (const mid of common) {
        const before = common.filter(id => (indices.get(id) ?? -1) < (indices.get(mid) ?? -1) && (a.get(id) ?? -1) < (a.get(mid) ?? -1) && (b.get(id) ?? -1) < (b.get(mid) ?? -1));
        const after = common.filter(id => (indices.get(id) ?? -1) > (indices.get(mid) ?? -1) && (a.get(id) ?? -1) > (a.get(mid) ?? -1) && (b.get(id) ?? -1) > (b.get(mid) ?? -1));
        if (before.length && after.length) [mid, ...before, ...after].forEach(id => ordered.add(id));
      }
    }
  }
  return { wave: { order, rare, outsideCount: outside.size }, repeated, ordered };
}
