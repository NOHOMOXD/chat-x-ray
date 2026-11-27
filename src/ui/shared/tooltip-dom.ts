import { getLocale, t } from '../../i18n/i18n.ts';

export function el(tag: string, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function row(label: string, value: unknown, options: { className?: string } = {}) {
  const line = el('div', 'tcx-tip__row');
  line.appendChild(el('span', 'tcx-tip__label', label));
  line.appendChild(
    el('span', options.className || 'tcx-tip__value', String(value))
  );
  return line;
}

export function head(title: string, subtitle?: string, hue?: number) {
  const header = el('div', 'tcx-tip__head');
  const dot = el('span', 'tcx-tip__dot');
  if (Number.isFinite(hue)) {
    dot.style.setProperty('--tcx-tip-hue', String(hue));
  }
  const copy = el('div', 'tcx-tip__head-copy');
  copy.appendChild(el('div', 'tcx-tip__title', title));
  if (subtitle) {
    copy.appendChild(el('div', 'tcx-tip__subtitle', subtitle));
  }
  header.appendChild(dot);
  header.appendChild(copy);
  return header;
}


export function statusHead(title: string, subtitle: string, status: string) {
  const header = head(title, subtitle);
  const red = ['surge', 'churn', 'outflow', 'lowEr', 'wave', 'suspicious'].includes(status);
  header.dataset.status = red ? 'alert' : status === 'ok' ? 'ok' : 'neutral';
  header.querySelector('.tcx-tip__dot')?.setAttribute('aria-hidden', 'true');
  return header;
}

export function detailsSection(root: HTMLElement) {
  const details = el('details', 'tcx-tip__details');
  details.appendChild(el('summary', '', t('tip.details')));
  root.appendChild(details);
  const list = el('div', 'tcx-tip__list');
  details.appendChild(list);
  return list;
}

export function eventTime(ts: unknown) {
  return typeof ts === 'number' && Number.isFinite(ts) ? new Intl.DateTimeFormat(getLocale(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(ts) : '';
}

