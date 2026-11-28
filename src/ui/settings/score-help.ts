import { t } from '../../i18n/i18n.ts';
import { HARD_SIGNAL_WEIGHTS, HISTORY_WEIGHTS, WEIGHTS } from '../../core/score-message.ts';

const criteria = [
  ['badges', WEIGHTS.noBadges], ['color', WEIGHTS.defaultColor],
  ['digits', WEIGHTS.usernameDigits], ['first', WEIGHTS.firstMessage],
  ['ids', WEIGHTS.idCluster], ['age', WEIGHTS.freshAccount],
  ['wave', WEIGHTS.botWave], ['rhythm', WEIGHTS.mechanicalRhythm],
  ['sterile', WEIGHTS.sterileText], ['repeat', WEIGHTS.selfRepeat],
  ['scam', HARD_SIGNAL_WEIGHTS.solicitation], ['phrase', HISTORY_WEIGHTS.wavePhrase],
  ['order', HISTORY_WEIGHTS.waveOrder], ['crossStream', HISTORY_WEIGHTS.groupRecurrence],
  ['returning', HISTORY_WEIGHTS.returning],
] as const;

export function createScoreHelp(attribute: 'i18n' | 'tcxI18n') {
  const details = document.createElement('details');
  details.className = 'tcx-score-help';
  const translated = (tag: string, key: string) => {
    const node = document.createElement(tag);
    node.dataset[attribute] = key;
    node.textContent = t(key);
    return node;
  };
  details.appendChild(translated('summary', 'scoreHelp.title'));
  details.appendChild(translated('p', 'scoreHelp.example'));
  details.appendChild(translated('p', 'scoreHelp.notes'));
  const list = document.createElement('dl');
  for (const [key, points] of criteria) {
    const item = document.createElement('div');
    const title = document.createElement('dt');
    title.appendChild(translated('span', `scoreHelp.${key}.title`));
    const value = document.createElement('strong');
    value.textContent = `+${points}`;
    title.appendChild(value);
    item.appendChild(title);
    item.appendChild(translated('dd', `scoreHelp.${key}.description`));
    list.appendChild(item);
  }
  details.appendChild(list);
  return details;
}
