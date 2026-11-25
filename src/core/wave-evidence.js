import { normalizeText } from './text-analysis.js';
import { isRare, isSubstantive } from '../analysis/group-history.js';

// Compare first appearances, so flooding a single bucket cannot create an order.
export function waveEvidence(records, earlier, context) {
  const members = records.filter(r => r.waveBoost && r.numericUserId);
  const order = [...new Set(members.map(r => r.numericUserId))];
  const indices = new Map(order.map((id, i) => [id, i]));
  const outside = new Set();
  const phrases = new Map();
  for (const record of members) {
    const text = record.normalized ?? normalizeText(record.text);
    if (!isSubstantive(text)) continue;
    if (!phrases.has(text)) phrases.set(text, { speakers: new Set(), others: new Set() });
    phrases.get(text).speakers.add(record.numericUserId);
  }
  for (const record of context) {
    if (indices.has(record.numericUserId)) continue;
    outside.add(record.userKey);
    phrases.get(record.normalized ?? normalizeText(record.text))?.others.add(record.userKey);
  }
  const rare = [];
  for (const [text, { speakers, others }] of phrases) {
    const phrase = { text, memberIds: [...speakers], substantive: true, outsideAuthors: others.size };
    if (isRare(phrase, { outsideAuthorCount: outside.size })) rare.push(phrase);
  }
  const repeated = new Set();
  const ordered = new Set();
  const positions = [];
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
      const common = order.filter(id => a.has(id) && b.has(id));
      for (const mid of common) {
        const before = common.filter(id => indices.get(id) < indices.get(mid) && a.get(id) < a.get(mid) && b.get(id) < b.get(mid));
        const after = common.filter(id => indices.get(id) > indices.get(mid) && a.get(id) > a.get(mid) && b.get(id) > b.get(mid));
        if (before.length && after.length) [mid, ...before, ...after].forEach(id => ordered.add(id));
      }
    }
  }
  return { wave: { order, rare, outsideCount: outside.size }, repeated, ordered };
}
