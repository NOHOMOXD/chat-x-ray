export function badgesArray(rawBadges: unknown) {
  if (!Array.isArray(rawBadges)) {
    return [];
  }

  const badges = [];
  for (let i = 0; i < rawBadges.length; i += 1) {
    let badge = rawBadges[i];
    if (typeof badge !== 'string') {
      continue;
    }
    badge = badge.toLowerCase();
    if (badge && badges.indexOf(badge) === -1) {
      badges.push(badge);
    }
  }
  return badges;
}

export function parseNumericId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

