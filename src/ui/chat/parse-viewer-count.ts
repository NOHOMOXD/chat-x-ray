const MULTIPLIERS: Record<string, number> = {
  k: 1000,
  к: 1000,
  тыс: 1000,
  'тыс.': 1000,
  m: 1000000,
  м: 1000000,
  млн: 1000000,
  'млн.': 1000000,
  million: 1000000,
};

export function parseTwitchViewerCount(rawText: unknown) {
  if (typeof rawText !== 'string') {
    return null;
  }

  let text = rawText
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[~≈+]+\s*/, '');

  if (!text) {
    return null;
  }

  text = text.replace(/\s*(?:зрител[а-яё]*|viewers?)\s*$/iu, '').trim();

  const match = text.match(
    /^([\d.,\s]+?)\s*(k|к|тыс\.?|m|м|млн\.?|million)?$/i
  );
  if (!match) {
    return null;
  }

  const matchedNumber = match[1];
  if (!matchedNumber) return null;
  let numberPart = matchedNumber.replace(/\s+/g, '');
  if (!/\d/.test(numberPart)) {
    return null;
  }

  const suffix = match[2] ? match[2].toLowerCase() : '';
  if (suffix) {
    numberPart = numberPart.replace(',', '.');
    const base = Number.parseFloat(numberPart);
    const multiplier = MULTIPLIERS[suffix];
    if (!Number.isFinite(base) || !multiplier) {
      return null;
    }
    return Math.round(base * multiplier);
  }

  const value = Number.parseInt(numberPart.replace(/[.,]/g, ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

