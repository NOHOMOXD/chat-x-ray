/*
 * Twitch Chat X-Ray — pure text analysis helpers.
 * Kept free of DOM, Chrome APIs and state for isolated unit testing.
 */

// Zero-width / bidi-control / soft-hyphen / variation selector characters.
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0100}-\u{E01EF}]/gu;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const LETTER_RE = /\p{L}/u;
const WORDISH_RE = /[\p{L}\p{N}]/u;

const SLANG_WORDS: Readonly<Record<string, boolean>> = Object.freeze({
  lol: true,
  lmao: true,
  rofl: true,
  kek: true,
  kekw: true,
  pog: true,
  pogchamp: true,
  xd: true,
  haha: true,
  hehe: true,
  bruh: true,
  pepe: true,
  лол: true,
  кек: true,
  ору: true,
  ржу: true,
  жиза: true,
  база: true,
  кринж: true,
  краш: true,
  пог: true,
  пепе: true,
});

const SLANG_STEMS = /^(?:ахах|хаха|хех|азаз|хихи|лмао|рофл|мда)/u;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

/**
 * Normalization for duplicate detection:
 *  - NFKC + lowercase
 *  - strip invisible Unicode / bidi controls / C0-C1 controls
 *  - punctuation and symbols become whitespace
 *  - repeated consecutive letters/numbers collapse (аааа -> а)
 *  - whitespace collapses
 */
export function normalizeText(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }

  let text = input;
  try {
    text = text.normalize('NFKC');
  } catch (_error) {
    // String.prototype.normalize available in modern JS
  }

  text = text.toLowerCase().replace(INVISIBLE_RE, '');
  text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  text = text.replace(/[\p{P}\p{S}]/gu, ' ');
  text = text.replace(/([\p{L}\p{N}])\1+/gu, '$1');
  return text.replace(/\s+/g, ' ').trim();
}

export function tokenize(normalized: string) {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

export function jaccardFromSets(a: Set<string>, b: Set<string>) {
  if (!a || !b || a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  smaller.forEach((value) => {
    if (larger.has(value)) {
      intersection += 1;
    }
  });

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tokenJaccard(a: string, b: string) {
  return jaccardFromSets(new Set(tokenize(a)), new Set(tokenize(b)));
}

export function trigramSet(text: string) {
  const set = new Set<string>();
  if (typeof text !== 'string' || text.length < 3) {
    return set;
  }

  for (let i = 0; i < text.length - 2; i += 1) {
    set.add(text.slice(i, i + 3));
  }
  return set;
}

export function trigramJaccard(a: string, b: string) {
  return jaccardFromSets(trigramSet(a), trigramSet(b));
}

export function levenshteinDistance(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const charA = a.charAt(i - 1);
    for (let k = 1; k <= b.length; k += 1) {
      const cost = charA === b.charAt(k - 1) ? 0 : 1;
      current[k] = Math.min(
        (previous[k] ?? NaN) + 1,
        (current[k - 1] ?? NaN) + 1,
        (previous[k - 1] ?? NaN) + cost
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] ?? NaN;
}

export function normalizedLevenshtein(a: string, b: string) {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLength;
}

export function mean(values: number[]) {
  if (!values.length) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i] ?? NaN;
  }
  return total / values.length;
}

export function standardDeviation(values: number[]) {
  if (!values.length) {
    return 0;
  }
  const average = mean(values);
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const delta = (values[i] ?? NaN) - average;
    variance += delta * delta;
  }
  return Math.sqrt(variance / values.length);
}

export function zScore(value: number, history: number[]) {
  if (!history || history.length === 0) {
    return 0;
  }
  const average = mean(history);
  const deviation = standardDeviation(history);
  if (deviation < 1e-9) {
    if (value === average) {
      return 0;
    }
    return value > average ? Infinity : 0;
  }
  return (value - average) / deviation;
}

export function hasEmoji(text: string) {
  return EMOJI_RE.test(text);
}

export function hasSlang(text: string) {
  const cleaned = text.toLowerCase().replace(/[·•]/g, ' ');
  const tokens = cleaned.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = (tokens[i] ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!token) {
      continue;
    }
    if (SLANG_WORDS[token] || SLANG_STEMS.test(token)) {
      return true;
    }
  }
  return false;
}

export function countWords(text: string) {
  const tokens = text.trim().split(/\s+/);
  let count = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (WORDISH_RE.test(tokens[i] ?? '')) {
      count += 1;
    }
  }
  return count;
}

/**
 * "Sterile" sentence heuristic: long, badge-less, plain sentence with no
 * emoji, slang, mention or link.
 */
export function isSterileText(text: unknown, badges: unknown) {
  if (typeof text !== 'string' || !Array.isArray(badges) || badges.length > 0) {
    return false;
  }
  if (text.indexOf('@') !== -1 || /https?:\/\/|www\./i.test(text)) {
    return false;
  }
  if (hasEmoji(text) || hasSlang(text)) {
    return false;
  }
  if (/[!?]{2,}/.test(text) || /(.)\1{2,}/u.test(text)) {
    return false;
  }
  if (countWords(text) <= 5) {
    return false;
  }

  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 12) {
    return false;
  }

  let uppercase = 0;
  for (let i = 0; i < letters.length; i += 1) {
    const char = letters.charAt(i);
    if (char === char.toUpperCase() && char !== char.toLowerCase()) {
      uppercase += 1;
    }
  }
  if (uppercase / letters.length > 0.6) {
    return false;
  }

  return LETTER_RE.test(text);
}

/*
 * Scam / solicitation heuristics.
 *
 * Viewbot accounts mostly stay silent, but rented "chat" accounts often post
 * the same begging/scam script ("dm me if u can get me a code", "free nitro",
 * "selling accounts"). This is a hard signal on top of the 100-point profile
 * matrix: it is not a weak prior, it is the content of the message itself.
 *
 * Patterns are intentionally narrow. "dm me the clip" must not match; a
 * contact phrase has to be combined with money, a digital good, or a sale.
 */
const SOLICIT_MONEY_RE =
  /(?:\b(?:buy|buying|bought|gift|gifting)\s+(?:me|us)\b)|(?:\b(?:donate|donation|donating|paypal|cash\s?app|cashapp|venmo|bitcoin|btc|ethereum|eth|crypto|wallet)\b)/iu;
const SOLICIT_TRANSFER_RE =
  /\b(?:send|sending|give|giving|transfer)\s+(?:me|us)\s+(?:some\s+)?(?:money|cash|btc|bitcoin|eth|crypto|funds|рубл[а-я]*|денег|доллар[а-я]*)\b/iu;
const SOLICIT_CONTACT_RE =
  /(?:\bdm\s+me\b|\bdm'?d\s+you\b|\bmessage\s+me\b|\bwrite\s+me\b|\btext\s+me\b|\bcontact\s+me\b|(?:^|\s)в\s+лс\b|\bв\s+личк|\bнапиши\s+мне\b|\bотпиши\s+мне\b)/iu;
const SOLICIT_GOODS_RE =
  /(?:\b(?:code|key|gift\s?card|giftcard|nitro|robux|vbucks|v-?bucks|account|accs?|subs?|bits?|followers?|viewers?)\b)/iu;
const SOLICIT_PAYMENT_RE =
  /(?:\b(?:paypal|cash\s?app|cashapp|venmo|bitcoin|btc|ethereum|eth|crypto|wallet|card)\b|сбер|карт[а-я]*|киви|крипт[а-я]*|битк[а-я]*)/iu;
const SCAM_RE =
  /(?:\bfree\s+(?:nitro|robux|vbucks|gift|code|followers|viewers|bits|subs?)\b|\b(?:promo|promocode|promo\s+code)\b|\b(?:buy|sell|trade|selling)\s+(?:accounts?|accs?|followers?|viewers?)\b|\b(?:account|acc)\s+(?:for\s+sale|trade)\b|накрутк[а-я]*\s+(?:зрител|подписчик|лайк)|подписчик[а-я]*\s+(?:дёшево|дешево)|заработ(?:ок|ать)\s+на\s+зрител)/iu;
const SOLICIT_RU_RE =
  /(?:^|[^\p{L}\p{N}])(?:куплю|продам|обменяю|скинь(?:те)?|переведи(?:те)?|перевод|задонат[а-я]*|подари(?:те)?)\s+(?:\S+\s+){0,3}(?:акк|аккаунт|зрител|подписчик|карт|сбер|киви|крипт|битк|денег|рубл|доллар)/iu;

/**
 * True when a message is a scam/begging/sale script rather than normal chat.
 * The caller applies it only to unbadged, non-privileged accounts.
 */
export function isSolicitation(text: unknown) {
  if (typeof text !== 'string' || text.length < 6) {
    return false;
  }
  const lower = text.toLowerCase();
  if (SCAM_RE.test(lower)) {
    return true;
  }

  const contact = SOLICIT_CONTACT_RE.test(lower);
  const money = SOLICIT_MONEY_RE.test(lower);
  const goods = SOLICIT_GOODS_RE.test(lower);
  const payment = SOLICIT_PAYMENT_RE.test(lower);
  if (contact && (money || payment)) {
    return true;
  }
  if (contact && /\b(?:account|acc|login|password)\b/iu.test(lower)) {
    return true;
  }
  if (money && (goods || payment)) {
    return true;
  }
  if (SOLICIT_TRANSFER_RE.test(lower)) {
    return true;
  }
  if (SOLICIT_RU_RE.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Spam pattern: the same character (or a two/three-character motif) repeated
 * until it dominates the message. Catches "wwwwwwwww" and emoji floods that
 * normalization removes before R9K can see them.
 */
export function isCharacterFlood(text: unknown) {
  if (typeof text !== 'string') {
    return false;
  }
  const compact = text.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }

  const chars = Array.from(compact);
  if (chars.length < 4) {
    return false;
  }

  const counts = new Map();
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    counts.set(char, (counts.get(char) || 0) + 1);
  }

  let max = 0;
  counts.forEach((count) => {
    if (count > max) {
      max = count;
    }
  });
  if (max / chars.length >= 0.8) {
    return true;
  }

  return chars.length >= 10 && counts.size <= 3;
}

export function detectRhythm(timestamps: number[]) {
  if (!Array.isArray(timestamps) || timestamps.length < 3) {
    return false;
  }

  const slice = timestamps.slice(-6);
  const deltas = [];
  for (let i = 1; i < slice.length; i += 1) {
    const delta = (slice[i] ?? NaN) - (slice[i - 1] ?? NaN);
    if (!(delta > 0)) {
      return false;
    }
    deltas.push(delta);
  }
  if (deltas.length < 2) {
    return false;
  }

  const average = mean(deltas);
  if (average < 1000 || average > 15 * 60 * 1000) {
    return false;
  }

  const deviation = standardDeviation(deltas);
  return deviation / average <= 0.08;
}

export function findSelfSimilarity(history: string[], threshold: number) {
  if (!Array.isArray(history) || history.length < 3) {
    return 0;
  }

  const values = history.filter((text) => typeof text === 'string' && text.length >= 3);
  if (values.length < 3) {
    return 0;
  }

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      total += trigramJaccard(values[i] ?? '', values[j] ?? '');
      pairs += 1;
    }
  }
  if (!pairs) {
    return 0;
  }

  const average = total / pairs;
  return average > threshold ? average : 0;
}

/**
 * Heuristic: detects automated bot farm nickname patterns.
 * e.g. base word + 4+ random digits: "gamer_4892", "alex8921", "chatter128392",
 * or high digit density in usernames >= 6 chars.
 */
export function hasNumericSuffixPattern(login: unknown) {
  if (typeof login !== 'string') {
    return false;
  }
  const clean = login.trim().toLowerCase();
  if (clean.length < 6) {
    return false;
  }

  // Suffix of 4 or more digits at the end: e.g. "alexander8492", "bot_91823"
  if (/^[a-zа-я0-9_]{2,}[a-zа-я_]\d{4,}$/i.test(clean)) {
    return true;
  }

  // Heavy digit density: 45%+ digits in a 7+ char username
  if (clean.length >= 7) {
    const digits = (clean.match(/\d/g) || []).length;
    if (digits >= 4 && digits / clean.length >= 0.45) {
      return true;
    }
  }

  return false;
}
