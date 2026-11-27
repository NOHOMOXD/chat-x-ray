import { clamp } from './text-analysis.ts';

/*
 * 100-point matrix (sum = 100).
 *
 * Rebalanced when `fresh-account` was added: `idCluster` 20 → 15 because the
 * id window grew 10× and the trigger now fires much more often, `botWave`
 * 15 → 10 because it is a bucket-level flag applied on top of account-level
 * evidence, and the old combined `mechanical` 10 was split into rhythm 5 +
 * sterile text 5 so the two keys can be filtered separately in audit dumps.
 */
export const WEIGHTS = Object.freeze({
  noBadges: 15,
  defaultColor: 10,
  usernameDigits: 10,
  firstMessage: 10,
  idCluster: 15,
  freshAccount: 10,
  botWave: 10,
  mechanicalRhythm: 5,
  sterileText: 5,
  selfRepeat: 10,
});

/*
 * Hard content signals applied on top of the 100-point matrix. The matrix
 * describes the account profile; a scam script is direct evidence and must be
 * able to push an otherwise ordinary unbadged account over the action
 * threshold (a classic "dm me, buy me a code" bot scores 35 + 25 = 60).
 */
export const HARD_SIGNAL_WEIGHTS = Object.freeze({
  solicitation: 25,
});

interface ScoreInput {
  roleExempt: boolean;
  hasBadges: boolean;
  color: unknown;
  firstMsg: unknown;
  hasDigitPattern: boolean;
  clusterPeers: number;
  freshAccount: boolean;
  apiAgeDays: number | undefined;
  rhythm: boolean;
  sterile: boolean;
  selfSimilarity: number;
  solicitation: boolean;
  spamFlood: boolean;
}

interface ScoreTrigger {
  key: string;
  labelKey: string;
  label: string;
  points: number;
  peers?: number;
  labelParams?: { days: number | undefined };
}

export function scoreMessage({
  roleExempt, hasBadges, color, firstMsg, hasDigitPattern, clusterPeers,
  freshAccount, apiAgeDays, rhythm, sterile, selfSimilarity, solicitation, spamFlood,
}: ScoreInput) {
  // Single source of truth for the 100-point matrix. The wave weight is
  // applied later, after the base score is known.
  let score = 0;
  const triggers: ScoreTrigger[] = [];

  if (!roleExempt) {
    if (!hasBadges) {
      score += WEIGHTS.noBadges;
      triggers.push({
        key: 'no-badges',
        labelKey: 'trigger.auto.no-badges',
        label: 'Нет значков',
        points: WEIGHTS.noBadges,
      });
    }
    if (!color) {
      score += WEIGHTS.defaultColor;
      triggers.push({
        key: 'default-color',
        labelKey: 'trigger.auto.default-color',
        label: 'Дефолтный цвет',
        points: WEIGHTS.defaultColor,
      });
    }
    if (hasDigitPattern) {
      score += WEIGHTS.usernameDigits;
      triggers.push({
        key: 'username-digits',
        labelKey: 'trigger.auto.username-digits',
        label: 'Цифровой суффикс ника',
        points: WEIGHTS.usernameDigits,
      });
    }
    if (firstMsg === true || firstMsg === '1') {
      score += WEIGHTS.firstMessage;
      triggers.push({
        key: 'first-msg',
        labelKey: 'trigger.auto.first-msg',
        label: 'Первое сообщение',
        points: WEIGHTS.firstMessage,
      });
    }
    if (clusterPeers >= 2) {
      score += WEIGHTS.idCluster;
      triggers.push({
        key: 'id-cluster',
        labelKey: 'trigger.auto.id-cluster',
        peers: clusterPeers,
        label: 'Кластер ID ×' + (clusterPeers + 1),
        points: WEIGHTS.idCluster,
      });
    }
    if (freshAccount) {
      score += WEIGHTS.freshAccount;
      triggers.push({
        key: 'fresh-account',
        labelKey: 'trigger.freshAccount',
        labelParams: { days: apiAgeDays },
        label: `Новый аккаунт (${apiAgeDays} дн.)`,
        points: WEIGHTS.freshAccount,
      });
    }
    // Rhythm and sterile text are separate keys so audit dumps can be
    // filtered by either signal; each contributes half of the old weight.
    if (rhythm) {
      score += WEIGHTS.mechanicalRhythm;
      triggers.push({
        key: 'mechanical-rhythm',
        labelKey: 'trigger.auto.mechanical-rhythm',
        label: 'Механический ритм',
        points: WEIGHTS.mechanicalRhythm,
      });
    }
    if (sterile) {
      score += WEIGHTS.sterileText;
      triggers.push({
        key: 'sterile-text',
        labelKey: 'trigger.auto.sterile-text',
        label: 'Стерильный текст',
        points: WEIGHTS.sterileText,
      });
    }
    if (selfSimilarity > 0) {
      score += WEIGHTS.selfRepeat;
      triggers.push({
        key: 'self-repeat',
        labelKey: 'trigger.auto.self-repeat',
        label: 'Самоповторы',
        points: WEIGHTS.selfRepeat,
      });
    }
    if (solicitation) {
      score += HARD_SIGNAL_WEIGHTS.solicitation;
      triggers.push({
        key: 'solicitation',
        labelKey: 'trigger.auto.solicitation',
        label: 'Скам / попрошайничество',
        points: HARD_SIGNAL_WEIGHTS.solicitation,
      });
    }
    if (spamFlood) {
      triggers.push({
        key: 'char-flood',
        labelKey: 'trigger.auto.char-flood',
        label: 'Флуд символами',
        points: 0,
      });
    }
  }

  score = clamp(score, 0, 100);
  return { score, triggers };
}
