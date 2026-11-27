/*
 * Twitch Chat X-Ray — small DOM helpers.
 *
 * All extension-owned DOM writes go through setTextIfChanged so a
 * MutationObserver can never be re-triggered by an identical write.
 */
import { formatLocalizedNumber, getLocale, intlLocale, t } from '../../i18n/i18n.ts';

interface ViewerRange { low: number; high: number; }
interface AlertInput {
  isBotWave?: boolean;
  verdict?: { level?: string } | null;
  threshold?: number;
  suspiciousShare?: number;
}

export function setTextIfChanged(element: Element | null, value: unknown) {
  if (!element) {
    return false;
  }
  const text = String(value);
  if (element.textContent !== text) {
    element.textContent = text;
    return true;
  }
  return false;
}

export function setAttributeIfChanged(element: Element | null, name: string, value: unknown) {
  if (!element) {
    return false;
  }
  const next = value === null || value === undefined ? null : String(value);
  if (next === null) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
      return true;
    }
    return false;
  }
  if (element.getAttribute(name) !== next) {
    element.setAttribute(name, next);
    return true;
  }
  return false;
}

export function formatNumber(value: unknown, locale?: string) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return '0';
  }
  return formatLocalizedNumber(number, locale || getLocale(), {
    maximumFractionDigits: 0,
  });
}

/**
 * Age of a saved estimate in the user's language: seconds under a minute, then
 * rounded minutes. A restored estimate can be minutes old, so "480 s ago"
 * would be unreadable.
 */
export function formatAge(seconds: unknown) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return value < 60
    ? t('tip.seconds', { count: value })
    : t('tip.minutes', { minutes: Math.max(1, Math.round(value / 60)) });
}

export function formatViewerRange(range: ViewerRange | null, locale?: string) {
  if (!range) return '';
  const low = formatNumber(range.low, locale);
  const high = formatNumber(range.high, locale);
  return low === high ? '≈' + low : low + ' – ' + high;
}

/**
 * Compact viewer range for the inline counter: `≈8–12,5 тыс.` / `≈2,4–3,8 тыс.`
 * / `≈640–900`. The full, exact range stays in the tooltip.
 */
export function formatViewerRangeCompact(range: ViewerRange | null, locale?: string, official = Infinity) {
  if (!range) {
    return '';
  }
  const low = Number(range.low);
  const high = Number(range.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return '';
  }

  const lower = Math.min(low, high);
  const upper = Math.max(low, high);
  const resolvedLocale = intlLocale(locale || getLocale());
  const compact = (value: number, divisor: number) => {
    try {
      return new Intl.NumberFormat(resolvedLocale, {
        maximumFractionDigits: 1,
      }).format(value / divisor);
    } catch (_error) {
      return String(Math.round((value / divisor) * 10) / 10);
    }
  };

  // Suffixes follow the UI language, not the number format: English viewers
  // read "12.5K", Russian viewers read "12,5 тыс.".
  const isRu = String(resolvedLocale).toLowerCase().startsWith('ru');
  const millions = isRu ? ' млн' : 'M';
  const thousands = isRu ? ' тыс.' : 'K';

  const divisor = upper >= 1000000 ? 1000000 : upper >= 1000 ? 1000 : 1;
  const suffix = divisor === 1000000 ? millions : divisor === 1000 ? thousands : '';
  const display = (value: number) => divisor === 1 ? formatNumber(value, resolvedLocale) : compact(value, divisor);
  if (divisor > 1 && Math.round(upper / divisor * 10) * divisor / 10 > official) {
    return lower === upper ? formatNumber(upper, locale)
      : formatNumber(lower, locale) + '–' + formatNumber(upper, locale);
  }
  const first = display(lower);
  const last = display(upper);
  return (first === last ? first : first + '–' + last) + suffix;
}

export function isExtensionNode(node: Node | null) {
  if (!node) {
    return false;
  }

  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement || null;

  if (!element || typeof element.closest !== 'function') {
    return false;
  }

  return Boolean(
    element.closest(
      '[data-tcx-ui], [data-tippy-root], .tippy-box, .tippy-content'
    )
  );
}

/**
 * Returns true when a MutationRecord was produced by our own UI (tooltips,
 * badges, stats, counters). Such mutations must never schedule another update.
 */
export function isExtensionMutation(mutation: MutationRecord | null) {
  if (!mutation) {
    return false;
  }
  if (isExtensionNode(mutation.target)) {
    return true;
  }

  const changed: Node[] = [];
  if (mutation.addedNodes) {
    for (let i = 0; i < mutation.addedNodes.length; i += 1) {
      const node = mutation.addedNodes[i];
      if (node) changed.push(node);
    }
  }
  if (mutation.removedNodes) {
    for (let i = 0; i < mutation.removedNodes.length; i += 1) {
      const node = mutation.removedNodes[i];
      if (node) changed.push(node);
    }
  }

  if (!changed.length) {
    return false;
  }

  return changed.every(isExtensionNode);
}

export function botHue(score: number, threshold?: number) {
  const minimum = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : 50;
  const span = Math.max(1, 100 - minimum);
  const t = Math.min(1, Math.max(0, (score - minimum) / span));
  return Math.round(52 - 52 * t);
}

/**
 * A single, shared "problem" predicate so every red element in the UI means
 * the same thing: a bot wave in chat, a warning/critical viewer verdict, or a
 * suspicious share that reached the user's own threshold.
 *
 * Units are explicit: `suspiciousShare` is a 0..1 fraction, `threshold` is a
 * 10..100 percent (the slider value). Comparing the two raw was a real bug —
 * 0.3 >= 25 is never true — so the share is converted here, once.
 */
export function isAlertState(input: AlertInput | null | undefined) {
  const source = input || {};
  if (source.isBotWave) {
    return true;
  }
  const verdict = source.verdict;
  if (verdict && (verdict.level === 'critical' || verdict.level === 'warn')) {
    return true;
  }
  const thresholdPercent = Number(source.threshold);
  const share = Number(source.suspiciousShare);
  if (!Number.isFinite(thresholdPercent) || !(share > 0)) {
    return false;
  }
  return share * 100 >= thresholdPercent;
}
