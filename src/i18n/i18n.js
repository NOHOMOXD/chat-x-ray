/*
 * Twitch Chat X-Ray — tiny dependency-free i18n layer.
 *
 * Two locales are shipped: Russian and English. The language is resolved from
 * the saved setting, otherwise from the browser language, and any language
 * other than Russian falls back to English.
 *
 * Messages are plain templates with {placeholder} slots. The catalogue is
 * never mutated at runtime, so the same key always resolves to the same text
 * for a given locale.
 */
export const SUPPORTED_LOCALES = Object.freeze(['ru', 'en']);
export const DEFAULT_LOCALE = 'en';

export function normalizeLocale(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw) {
    return null;
  }
  const base = raw.split(/[-_]/)[0];
  return SUPPORTED_LOCALES.indexOf(base) !== -1 ? base : null;
}

/**
 * Resolve the UI language: explicit setting wins, then the browser languages
 * (navigator.languages / navigator.language / <html lang>), and everything
 * that is not Russian becomes English.
 */
export function resolveLocale(explicit, options) {
  const opts = options || {};
  const fromSetting = normalizeLocale(explicit);
  if (fromSetting) {
    return fromSetting;
  }

  const candidates = [];
  if (Array.isArray(opts.languages)) {
    for (let i = 0; i < opts.languages.length; i += 1) {
      candidates.push(opts.languages[i]);
    }
  }
  if (opts.language) {
    candidates.push(opts.language);
  }
  if (opts.htmlLang) {
    candidates.push(opts.htmlLang);
  }

  if (!candidates.length) {
    try {
      if (typeof navigator !== 'undefined') {
        if (Array.isArray(navigator.languages)) {
          candidates.push(...navigator.languages);
        }
        if (navigator.language) {
          candidates.push(navigator.language);
        }
      }
      if (
        typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.lang
      ) {
        candidates.push(document.documentElement.lang);
      }
    } catch (_error) {
      // Non-browser environment: fall through to the default locale.
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const locale = normalizeLocale(candidates[i]);
    if (locale === 'ru') {
      return 'ru';
    }
  }
  return DEFAULT_LOCALE;
}

/** BCP-47 tag used by Intl formatters for a UI language. */
export function intlLocale(locale) {
  return normalizeLocale(locale) === 'ru' ? 'ru-RU' : 'en-US';
}

/**
 * Plural form selector for the two shipped languages. English only needs
 * one/other, Russian keeps the three-form rules, but every message can also
 * be written without a plural slot.
 */
export function pluralForm(locale, count) {
  const n = Math.abs(Number(count) || 0);
  if (normalizeLocale(locale) !== 'ru') {
    return n === 1 ? 'one' : 'other';
  }
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 > 10 && mod100 < 20) {
    return 'many';
  }
  if (mod10 > 1 && mod10 < 5) {
    return 'few';
  }
  if (mod10 === 1) {
    return 'one';
  }
  return 'many';
}

export const MESSAGES = Object.freeze({
  ru: {
    'app.name': 'Chat X-Ray',
    'app.lead':
      'Локальный рентген чата Twitch: бейджи ботов, клиентский R9K, аудит и оценка живого онлайна.',
    'app.settings': 'Настройки',
    'app.settingsEntry': 'Настройки Chat X-Ray',
    'app.close': 'Закрыть',
    'app.reset': 'Сбросить настройки',
    'app.saved': 'Сохранено',
    'app.resetDone': 'Сброшено',

    'counter.loading': 'Загружаю',
    'counter.loadingPercent': 'Загружаю… {percent}%',
    'counter.aria':
      'Оценка загрузки данных: {percent}%. {done} из {required} проверок пройдено: {checks}.',
    'counter.check.duration': 'время · {minutes} / {required} мин',
    'counter.check.chatters': 'чаттеры · {value} / {required}',
    'counter.check.messages': 'сообщения · {value} / {required}',
    'counter.check.wave': 'волна ботов',

    'viewer.rangeAria': 'Оценка реальных зрителей: {range}.',
    'viewer.noRange': 'Недостаточно чистых чаттеров для оценки зрителей.',
    'viewer.official': 'Официально на Twitch: {value}.',
    'viewer.engagement': 'Вовлечённость чата: {percent}%.',
    'viewer.suspicious': 'Подозрительных аккаунтов в чате: {users} из {active}.',
    'viewer.status': 'Статус: {label}.',
    'viewer.wave': 'Волна ботов в чате.',

    'tip.badge.points': 'BOT {score}',
    'tip.history.previous': 'Прошлый эфир',
    'tip.history.typical': 'Обычно на канале',
    'tip.history.range': '{median} · {low}–{high} · эфиры {count}',
    'tip.history.relation': 'Вовлечённость',
    'tip.history.low': 'Ниже обычной для канала',
    'tip.history.high': 'Выше обычной для канала',
    'tip.history.normal': 'Обычная для канала',
    'tip.history.group': 'В группе на {count} из {total} прошлых эфиров',
    'tip.history.coordination': 'Совпадения состава и текста · эфиры {count}',
    'settings.clearHistory': 'Очистить историю эфиров',
    'settings.historyCleared': 'История очищена',
    'settings.historyClearFailed': 'Не удалось очистить историю',
    'tip.badge.subtitle': 'Оценка подозрительности аккаунта',
    'tip.badge.scoreAria':
      'Подозрительность — {score} из 100. {triggers}',
    'tip.badge.exempt': 'Привилегированный аккаунт: скоринг отключён',
    'tip.badge.noTriggers': 'Триггеры не сработали',
    'tip.badge.flood':
      'Флуд символами: R9K применит выбранное действие (приглушить/скрыть).',
    'tip.badge.age': 'Возраст аккаунта: {days} дн. (Twitch GQL).',
    'tip.badge.r9k': 'R9K: похоже на недавнее сообщение ({percent}%)',
    'tip.badge.footer':
      'Порог действий: {threshold}/100 · R9K {state}',
    'tip.badge.wave': 'Волна ботов: аккаунт попал в аномальный всплеск чата.',

    'tip.details': 'Подробнее',
    'tip.eventTime': 'Время события',
    'tip.onlineTransition': 'Было → стало',
    'tip.observationLabel': 'Наблюдаем',
    'tip.lastMeasurementLabel': 'Последний замер',
    'tip.chatAlertLabel': 'Предупреждение чата',
    'tip.chatAlertValue': '{suspicious} из {active} авторов с баллом ≥ {threshold}',
    'tip.gathering': 'Собираем данные · {percent}%',
    'tip.missing.duration': 'Нужно {required} мин наблюдения',
    'tip.missing.chatters': 'Чистых авторов {value} из {required}',
    'tip.missing.messages': 'Сообщений аудитории {value} из {required}',
    'tip.estimate': 'Оценка по чату',
    'tip.provisional': 'Предварительно',
    'tip.estimateNote': 'Расчёт предполагает, что за 10 минут пишут 8–12,5% живой аудитории.',
    'tip.seconds': '{count} с',
    'tip.minutes': '{minutes} мин',
    'tip.hoursMinutes': '{hours} ч {minutes} мин',
    'tip.observing': 'Наблюдаем {duration}',
    'tip.covered': 'собрано {minutes} из 10 мин',
    'tip.sliding': 'чат за последние 10 мин',
    'tip.lastMeasurement': 'Последний замер · {time}',
    'tip.medianLabel': 'Медиана онлайна',
    'tip.lastChurn': 'Последний откат',
    'tip.lastSurge': 'Последний наплыв',
    'tip.precedingDrop': 'Перед ростом · {values} · {time}',
    'tip.surges': 'Наплывы за сессию',
    'tip.outflows': 'Оттоки за сессию',
    'tip.lastOutflow': 'Последний отток',
    'tip.noEventData': 'Нет данных',
    'tip.outflow.observing': 'Ожидаем восстановления',
    'tip.outflow.recovered': 'Восстановился в {time}',
    'tip.outflow.unrecovered': 'За 5 мин не восстановился',
    'tip.outflow.interrupted': 'Наблюдение прервано',
    'tip.badge.ageUnknown': 'Возраст неизвестен',
    'tip.idGroups': 'Плотные группы ID',
    'tip.idGroupCounts': '{groups} групп · {authors} авторов',
    'tip.idGroup': 'Группа ID · {count} авт. · {from}–{to}',
    'tip.churns': 'Откаты',
    'tip.eventAverage': '{count} · в среднем {average}',
    'tip.chatThreshold': 'Чат · {suspicious} из {active} авторов с баллом ≥ {threshold}',
    'tip.suspiciousAuthors': 'Подозрительных авторов',
    'tip.lastWave': 'Последняя волна · {time} · авторов {count}',
    'tip.waveCount': 'Волн за сессию',
    'tip.status.waiting': 'Идёт сбор данных',
    'tip.status.disconnected': 'Соединение с чатом прервано',
    'tip.status.ok': 'Без текущих предупреждений',
    'tip.status.stale': 'Текущий онлайн недоступен',
    'tip.status.surge': 'Недавний наплыв зрителей',
    'tip.status.churn': 'Недавний откат онлайна',
    'tip.status.lowEr': 'Низкая вовлечённость по отношению к онлайну',
    'tip.status.wave': 'Обнаружена волна в чате',
    'tip.status.suspicious': 'Высокая доля подозрительных авторов',
    'tip.viewer.title': 'Оценка зрителей',
    'tip.viewer.official': 'Официально Twitch: {value}',
    'tip.viewer.median': 'медиана {value}',
    'tip.viewer.heroRange': 'живых зрителей (по чату)',
    'tip.viewer.heroEmpty': 'мало чистых чаттеров',
    'tip.viewer.er': 'ER (чистые / онлайн)',
    'tip.viewer.erProvisional': 'ER (чистые / онлайн, предв.)',
    'tip.viewer.erUsually': ' · обычно {percent}',
    'tip.viewer.clean': 'Чистых чаттеров',
    'tip.viewer.cleanValue': '{clean} из {active}',
    'tip.viewer.tempo': 'Темп чата',
    'tip.viewer.tempoValue': '{value} сообщ/мин',
    'tip.viewer.suspicious': 'Подозрительных в чате',
    'tip.viewer.suspiciousValue': '{users} ({percent}%)',
    'tip.viewer.fresh': 'Новых аккаунтов',
    'tip.viewer.loading': 'Загрузка данных',
    'tip.viewer.loadingValue': '{percent}%',
    'tip.viewer.churn': 'Скачки онлайна',
    'tip.viewer.churnValue': '{count} {word} · средний −{avg}',
    'tip.viewer.churnRecent': 'из них за 15 мин',
    'tip.viewer.churnWord.one': 'откат',
    'tip.viewer.churnWord.few': 'отката',
    'tip.viewer.churnWord.many': 'откатов',
    'tip.viewer.drops': 'Откаты: {list}',
    'tip.viewer.lastDrop': 'Последний откат: {parts}',
    'tip.viewer.pendingDrop': '−{drop} · ждём возврата',
    'tip.viewer.volatility': 'Разброс онлайна',
    'tip.viewer.wave': 'Волна ботов в чате',
    'tip.viewer.waveYes': 'да',
    'tip.viewer.window': 'Окно наблюдения',
    'tip.viewer.windowValue': '{minutes} мин · {confidence}',
    'tip.viewer.confidence.high': 'точность высокая',
    'tip.viewer.confidence.medium': 'точность средняя',
    'tip.viewer.confidence.low': 'точность низкая',
    'tip.viewer.note':
      'Оценка: 8–12,5% живой аудитории пишут в чат за 10 минут. Доля ботов в чате не равна доле ботов среди зрителей: вьюботы не заходят в IRC.',
    'tip.viewer.foot':
      'Не официальные данные Twitch. Оценка по чистым уникальным чаттерам.',

    'verdict.low-er-and-churn':
      'высокий риск: низкая вовлечённость + скачки онлайна',
    'verdict.churn': 'подтверждённый откат онлайна',
    'verdict.low-er': 'низкая вовлечённость: возможна накрутка на потоке',
    'verdict.below-organic-er': 'вовлечённость ниже органического диапазона',
    'verdict.bot-wave': 'волна ботов в чате',
    'verdict.chat-bots': 'много подозрительных аккаунтов в чате',
    'verdict.no-data': 'мало данных для оценки',
    'verdict.clean': 'признаков накрутки не видно',

    'stats.title': 'Сводка чата',
    'stats.subtitle': 'Скользящее окно 10 минут',
    'stats.mpm': 'сообщ/мин',
    'stats.mpmLabel': 'Сообщений в минуту',
    'stats.active': 'активных в чате',
    'stats.activeLabel': 'Активных чаттеров',
    'stats.activeValue': '{value} ({clean} чистых)',
    'stats.suspicious': 'подозрительных сообщ.',
    'stats.suspiciousLabel': 'Подозрительных сообщений',
    'stats.window': 'Сообщений в окне',
    'stats.windowValue': '{value} / 10 мин',
    'stats.audit': 'Записей в аудите',
    'stats.wave': 'волна',
    'stats.loadingValue': '{percent}%',
    'stats.loadingTitle': 'Загружаю… {percent}%',
    'stats.loadingTip': 'Загрузка данных: {percent}%',
    'stats.loadingDone': 'Готово: {done} из {required} проверок.',
    'stats.foot':
      'Данные считаются только в этой вкладке и никуда не отправляются.',

    'trigger.auto.no-badges': 'Нет значков',
    'trigger.auto.default-color': 'Дефолтный цвет',
    'trigger.auto.username-digits': 'Цифровой суффикс ника',
    'trigger.auto.first-msg': 'Первое сообщение',
    'trigger.auto.id-cluster': 'Кластер ID',
    'trigger.auto.mechanical-rhythm': 'Механический ритм',
    'trigger.auto.sterile-text': 'Стерильный текст',
    'trigger.auto.self-repeat': 'Самоповторы',
    'trigger.groupRecurrence': 'Повтор фразы из другого эфира',
    'trigger.auto.solicitation': 'Скам / попрошайничество',
    'trigger.auto.char-flood': 'Флуд символами',
    'trigger.clusterSuffix': ' ×{count}',
    'trigger.freshAccount': 'Новый аккаунт ({days} дн.)',
    'trigger.auto.veteran-account': 'Старый аккаунт ({days} дн.)',
    'trigger.freshAccountId': 'Новый пустой аккаунт (ID > 1.45 млрд)',
    'trigger.wave': 'Волна ботов',

    'settings.title': 'Настройки',
    'settings.section.filters': 'Бейджи и фильтрация',
    'settings.showBadges': 'Показывать баллы подозрительности',
    'settings.mute': 'Приглушать подозрительные аккаунты',
    'settings.hide': 'Скрывать подозрительные аккаунты',
    'settings.threshold': 'Порог срабатывания',
    'settings.thresholdAria':
      'Порог подозрительности от 10 до 100 баллов',
    'settings.thresholdHelp':
      '10–30 баллов — чувствительно, 30 — по умолчанию, 50 — средний порог, 70–100 — строгий порог.',
    'settings.section.r9k': 'R9K',
    'settings.r9k': 'Клиентский R9K (пасты и дубликаты)',
    'settings.r9kAction': 'Действие R9K',
    'settings.r9kActionAria': 'Действие клиентского R9K',
    'settings.r9kMute': 'Приглушать',
    'settings.r9kHide': 'Скрывать',
    'settings.section.data': 'Данные',
    'settings.adjustViewer': 'Корректировать онлайн Twitch (≈живых)',
    'settings.audit': 'Вести JSON-журнал ботов',
    'settings.accountAge': 'Уточнять возраст аккаунтов через Twitch GQL (неофициально)',
    'settings.section.chat': 'Чат',
    'settings.showChatStats': 'Показывать статистику над чатом',
    'settings.showChatStatsHelp':
      'Когда выключено, полоса «сообщ/мин · активных · подозрительных» над чатом скрыта. Число зрителей и бейджи остаются.',
    'settings.section.interface': 'Интерфейс',
    'settings.language': 'Язык',
    'settings.languageAuto': 'Авто (по браузеру)',
    'settings.languageRu': 'Русский',
    'settings.languageEn': 'English',
    'settings.auditCount': 'Зафиксировано ботов: ',
    'settings.recordSession': 'Записывать статистику сессии',
    'settings.sessionDownload': 'Скачать снимок сессии',
    'settings.previousSessionDownload': 'Скачать предыдущую сессию',
    'tip.viewer.anomalies': 'Крупные изменения счётчика Twitch',
    'tip.viewer.anomalyTotals': 'Наплывы {surges} (ср. +{rises}) · откаты {churn} (ср. −{drops})',
    'tip.viewer.lastAnomaly': 'Последний скачок',
    'tip.viewer.lastAnomalyValue': '{from} → {to} ({delta})',
    'tip.viewer.minute': 'Чат за минуту',
    'tip.viewer.minuteChat': 'Авторов {authors} · сообщений {messages}',
    'tip.viewer.minuteViewers': 'Онлайн за минуту',
    'tip.viewer.completeWindow': 'Полное окно 10 минут',
    'tip.viewer.partialWindow': 'Наблюдаем {minutes} из 10 минут',
    'settings.copyJson': 'Копировать JSON',
    'settings.copied': '✔ Скопировано!',
    'settings.download': 'Скачать .json',
    'settings.clear': 'Очистить',
    'settings.hint':
      'Анализ в памяти вкладки · сеть только при включённом GQL-возрасте',
    'settings.scrollMore': 'Прокрутите ниже ↓',

    'options.title': 'Twitch Chat X-Ray — настройки',
    'options.eyebrow': 'ЛОКАЛЬНО · БЕЗ СЕТИ',
    'options.lead':
      'Локальный рентген чата: бейджи ботов, клиентский R9K, аудит и расчёт реального онлайна. Всё считается в памяти вкладки.',
    'options.help': 'Как это работает',
    'options.filters': 'Подозрительные аккаунты',
    'options.badge': 'Показывать бейдж BOT',
    'options.action': 'Сообщения выше порога',
    'options.keep': 'Оставлять',
    'options.repeats': 'Повторы в чате',
    'options.stats': 'Статистика',
    'options.estimate': 'Оценка рядом со счётчиком Twitch',
    'options.data': 'Данные и язык',
    'options.exportHint': 'Скачать журнал и запись можно в настройках чата на странице эфира.',
    'options.weights': 'За что начисляются баллы',
    'options.scoreHelp': 'BOT 30 означает 30 баллов подозрительности. Наведи курсор на бейдж перед ником, чтобы увидеть признаки и их вклад.',
    'options.repeatHelp': 'R9K ищет одинаковые и похожие сообщения и цепочки повторяющихся символов. Поэтому даже реплика автора без бейджа BOT может приглушаться.',
    'options.estimateHelp': 'Модель предполагает, что за 10 минут пишут 8–12,5% зрителей. Например, 1 000 уникальных авторов, прошедших фильтр, дают оценку 8 000–12 500 зрителей до ограничения текущим онлайном Twitch и его медианой. Доля пишущих на конкретном эфире может отличаться.',
    'options.heading': 'Настройки',
    'options.thresholdLabel': 'Порог срабатывания (10–100 баллов)',
    'options.auditHelp':
      'Журнал хранится в памяти вкладки. Копирование и скачивание доступны в панели настроек Chat X-Ray на странице стрима.',
    'options.accountAgeHelp':
      'При включении расширение запрашивает createdAt у gql.twitch.tv для подозрительных аккаунтов и тех, кто может пересечь порог после проверки возраста. Расширение кэширует ответы в памяти вкладки. Это неофициальный endpoint.',
    'options.hint':
      'Анализ в памяти вкладки; сеть — только при включённом GQL-возрасте. Те же настройки доступны в панели Chat X-Ray на странице стрима.',
    'options.cardR9k.title': 'Почему сообщение приглушено?',
    'options.cardR9k.body':
      'Точные нормализованные повторы ищутся в 15-минутном индексе, нечёткий поиск — по последним 1000 сообщений. Короткие сообщения и символьный флуд проверяются отдельно.',
    'options.cardScore.title': 'Что значит BOT 30?',
    'options.cardScore.body':
      'Пустые значки 15, дефолтный цвет 10, цифровой суффикс 10, первое сообщение 10, кластер ID 15, новый пустой аккаунт 10, волна 10, ритм 5, стерильный текст 5, самоповторы 10. Отдельно жёсткий сигнал «скам» +25.',
    'options.cardViewers.title': 'Откуда берётся оценка зрителей?',
    'options.cardViewers.body':
      'Официальное число Twitch не меняется. Рядом — диапазон живых зрителей по чистым уникальным чаттерам. Скобки показывают загрузку данных, волна ботов красит счётчик в красный.',
    'options.footerLib': 'Twitch Chat X-Ray · Manifest V3 · ES Modules',
    'options.footerPrivacy':
      'Пассивный IRC-перехват · GQL-возраст только по желанию',
  },

  en: {
    'app.name': 'Chat X-Ray',
    'app.lead':
      'A local Twitch chat X-ray: bot badges, client-side R9K, audit log and a live-viewer estimate.',
    'app.settings': 'Settings',
    'app.settingsEntry': 'Chat X-Ray Settings',
    'app.close': 'Close',
    'app.reset': 'Reset settings',
    'app.saved': 'Saved',
    'app.resetDone': 'Reset',

    'counter.loading': 'Loading',
    'counter.loadingPercent': 'Loading… {percent}%',
    'counter.aria':
      'Data loading progress: {percent}%. {done} of {required} checks passed: {checks}.',
    'counter.check.duration': 'time · {minutes} / {required} min',
    'counter.check.chatters': 'chatters · {value} / {required}',
    'counter.check.messages': 'messages · {value} / {required}',
    'counter.check.wave': 'bot wave',

    'viewer.rangeAria': 'Estimated real viewers: {range}.',
    'viewer.noRange': 'Not enough clean chatters to estimate viewers.',
    'viewer.official': 'Official Twitch number: {value}.',
    'viewer.engagement': 'Chat engagement: {percent}%.',
    'viewer.suspicious': 'Suspicious accounts in chat: {users} of {active}.',
    'viewer.status': 'Status: {label}.',
    'viewer.wave': 'Bot wave in chat.',

    'tip.badge.points': 'BOT {score}',
    'tip.history.previous': 'Previous broadcast',
    'tip.history.typical': 'Typical for this channel',
    'tip.history.range': '{median} · {low}–{high} · broadcasts {count}',
    'tip.history.relation': 'Engagement',
    'tip.history.low': 'Below the channel’s usual range',
    'tip.history.high': 'Above the channel’s usual range',
    'tip.history.normal': 'Typical for this channel',
    'tip.history.group': 'In a group in {count} of {total} past broadcasts',
    'tip.history.coordination': 'Matching members and text · broadcasts {count}',
    'settings.clearHistory': 'Clear broadcast history',
    'settings.historyCleared': 'History cleared',
    'settings.historyClearFailed': 'Could not clear history',
    'tip.badge.subtitle': 'Account suspiciousness score',
    'tip.badge.scoreAria':
      'Suspiciousness {score} out of 100. {triggers}',
    'tip.badge.exempt': 'Privileged account: scoring disabled',
    'tip.badge.noTriggers': 'No triggers fired',
    'tip.badge.flood':
      'Character flood: R9K applies the selected action (mute/hide).',
    'tip.badge.age': 'Account age: {days} days (Twitch GQL).',
    'tip.badge.r9k': 'R9K: similar to a recent message ({percent}%)',
    'tip.badge.footer': 'Action threshold: {threshold}/100 · R9K {state}',
    'tip.badge.wave': 'Bot wave: this account landed in an abnormal chat spike.',

    'tip.details': 'Details',
    'tip.eventTime': 'Event time',
    'tip.onlineTransition': 'Before → after',
    'tip.observationLabel': 'Observing for',
    'tip.lastMeasurementLabel': 'Last measurement',
    'tip.chatAlertLabel': 'Chat alert',
    'tip.chatAlertValue': '{suspicious} of {active} authors scored ≥ {threshold}',
    'tip.gathering': 'Collecting data · {percent}%',
    'tip.missing.duration': 'Requires {required} min of observation',
    'tip.missing.chatters': 'Clean authors {value} of {required}',
    'tip.missing.messages': 'Audience messages {value} of {required}',
    'tip.estimate': 'Estimate from chat',
    'tip.provisional': 'Provisional',
    'tip.estimateNote': 'The estimate assumes 8–12.5% of live viewers write in chat over 10 minutes.',
    'tip.seconds': '{count} s',
    'tip.minutes': '{minutes} min',
    'tip.hoursMinutes': '{hours} h {minutes} min',
    'tip.observing': 'Observing for {duration}',
    'tip.covered': '{minutes} of 10 min collected',
    'tip.sliding': 'chat over the last 10 min',
    'tip.lastMeasurement': 'Last measurement · {time}',
    'tip.medianLabel': 'Median viewer count',
    'tip.lastChurn': 'Last drop and recovery',
    'tip.lastSurge': 'Last surge',
    'tip.precedingDrop': 'Before the rise · {values} · {time}',
    'tip.surges': 'Surges this session',
    'tip.outflows': 'Drops this session',
    'tip.lastOutflow': 'Latest drop',
    'tip.noEventData': 'No data',
    'tip.outflow.observing': 'Watching for recovery',
    'tip.outflow.recovered': 'Recovered at {time}',
    'tip.outflow.unrecovered': 'Did not recover within 5 min',
    'tip.outflow.interrupted': 'Observation interrupted',
    'tip.badge.ageUnknown': 'Account age unknown',
    'tip.idGroups': 'Dense ID groups',
    'tip.idGroupCounts': '{groups} groups · {authors} authors',
    'tip.idGroup': 'ID group · {count} authors · {from}–{to}',
    'tip.churns': 'Drops and recoveries',
    'tip.eventAverage': '{count} · average {average}',
    'tip.chatThreshold': 'Chat · {suspicious} of {active} authors scored ≥ {threshold}',
    'tip.suspiciousAuthors': 'Suspicious authors',
    'tip.lastWave': 'Last wave · {time} · {count} authors',
    'tip.waveCount': 'Waves this session',
    'tip.status.waiting': 'Collecting data',
    'tip.status.disconnected': 'Chat connection interrupted',
    'tip.status.ok': 'No current alerts',
    'tip.status.stale': 'Current viewer count unavailable',
    'tip.status.surge': 'Recent surge in viewer count',
    'tip.status.churn': 'Recent drop and recovery',
    'tip.status.lowEr': 'Low chat engagement relative to viewer count',
    'tip.status.wave': 'Chat wave detected',
    'tip.status.suspicious': 'High share of suspicious authors',
    'tip.viewer.title': 'Viewer estimate',
    'tip.viewer.official': 'Official Twitch: {value}',
    'tip.viewer.median': 'median {value}',
    'tip.viewer.heroRange': 'live viewers (from chat)',
    'tip.viewer.heroEmpty': 'too few clean chatters',
    'tip.viewer.er': 'ER (clean / live)',
    'tip.viewer.erProvisional': 'ER (clean / live, prov.)',
    'tip.viewer.erUsually': ' · usually {percent}',
    'tip.viewer.clean': 'Clean chatters',
    'tip.viewer.cleanValue': '{clean} of {active}',
    'tip.viewer.tempo': 'Chat tempo',
    'tip.viewer.tempoValue': '{value} msg/min',
    'tip.viewer.suspicious': 'Suspicious in chat',
    'tip.viewer.suspiciousValue': '{users} ({percent}%)',
    'tip.viewer.fresh': 'Fresh accounts',
    'tip.viewer.loading': 'Data loading',
    'tip.viewer.loadingValue': '{percent}%',
    'tip.viewer.churn': 'Viewer swings',
    'tip.viewer.churnValue': '{count} {word} · avg −{avg}',
    'tip.viewer.churnRecent': 'of them in the last 15 min',
    'tip.viewer.churnWord.one': 'rollback',
    'tip.viewer.churnWord.few': 'rollbacks',
    'tip.viewer.churnWord.many': 'rollbacks',
    'tip.viewer.drops': 'Rollbacks: {list}',
    'tip.viewer.lastDrop': 'Last rollback: {parts}',
    'tip.viewer.pendingDrop': '−{drop} · waiting for refill',
    'tip.viewer.volatility': 'Viewer volatility',
    'tip.viewer.wave': 'Bot wave in chat',
    'tip.viewer.waveYes': 'yes',
    'tip.viewer.window': 'Observation window',
    'tip.viewer.windowValue': '{minutes} min · {confidence}',
    'tip.viewer.confidence.high': 'high confidence',
    'tip.viewer.confidence.medium': 'medium confidence',
    'tip.viewer.confidence.low': 'low confidence',
    'tip.viewer.note':
      'Assumption: 8–12.5% of a live audience writes in chat within 10 minutes. The bot share of chat is not the bot share of viewers: viewbots never join IRC.',
    'tip.viewer.foot':
      'Not official Twitch data. Estimated from clean unique chatters.',

    'verdict.low-er-and-churn':
      'high risk: low engagement + viewer swings',
    'verdict.churn': 'confirmed viewer count rollback',
    'verdict.low-er': 'low engagement: possible view inflation',
    'verdict.below-organic-er': 'engagement below the organic band',
    'verdict.bot-wave': 'bot wave in chat',
    'verdict.chat-bots': 'many suspicious accounts in chat',
    'verdict.no-data': 'not enough data to estimate',
    'verdict.clean': 'no signs of view inflation',

    'stats.title': 'Chat summary',
    'stats.subtitle': '10-minute rolling window',
    'stats.mpm': 'msg/min',
    'stats.mpmLabel': 'Messages per minute',
    'stats.active': 'active in chat',
    'stats.activeLabel': 'Active chatters',
    'stats.activeValue': '{value} ({clean} clean)',
    'stats.suspicious': 'suspicious msgs',
    'stats.suspiciousLabel': 'Suspicious messages',
    'stats.window': 'Messages in window',
    'stats.windowValue': '{value} / 10 min',
    'stats.audit': 'Audit entries',
    'stats.wave': 'wave',
    'stats.loadingValue': '{percent}%',
    'stats.loadingTitle': 'Loading… {percent}%',
    'stats.loadingTip': 'Data loading: {percent}%',
    'stats.loadingDone': 'Ready: {done} of {required} checks.',
    'stats.foot': 'Computed inside this tab only; nothing is ever uploaded.',

    'trigger.auto.no-badges': 'No badges',
    'trigger.auto.default-color': 'Default color',
    'trigger.auto.username-digits': 'Numeric name suffix',
    'trigger.auto.first-msg': 'First message',
    'trigger.auto.id-cluster': 'ID cluster',
    'trigger.auto.mechanical-rhythm': 'Mechanical rhythm',
    'trigger.auto.sterile-text': 'Sterile text',
    'trigger.auto.self-repeat': 'Self-repeats',
    'trigger.groupRecurrence': 'The same authors repeated a rare phrase on another broadcast',
    'trigger.auto.solicitation': 'Scam / begging',
    'trigger.auto.char-flood': 'Character flood',
    'trigger.clusterSuffix': ' ×{count}',
    'trigger.freshAccount': 'New account ({days} days)',
    'trigger.auto.veteran-account': 'Established account ({days} days)',
    'trigger.freshAccountId': 'New empty account (ID > 1.45B)',
    'trigger.wave': 'Bot wave',

    'settings.title': 'Settings',
    'settings.section.filters': 'Badges & filtering',
    'settings.showBadges': 'Show suspiciousness scores',
    'settings.mute': 'Mute suspicious accounts',
    'settings.hide': 'Hide suspicious accounts',
    'settings.threshold': 'Action threshold',
    'settings.thresholdAria':
      'Bot score action threshold from 10 to 100 points',
    'settings.thresholdHelp':
      '10–30 points is sensitive, 30 is the default, 50 is balanced, and 70–100 is strict.',
    'settings.section.r9k': 'R9K',
    'settings.r9k': 'Client-side R9K (pastes & duplicates)',
    'settings.r9kAction': 'R9K action',
    'settings.r9kActionAria': 'Client-side R9K action',
    'settings.r9kMute': 'Mute',
    'settings.r9kHide': 'Hide',
    'settings.section.data': 'Data',
    'settings.adjustViewer': 'Adjust Twitch viewer count (≈live)',
    'settings.audit': 'Keep a JSON bot log',
    'settings.accountAge': 'Look up account age via Twitch GQL (unofficial)',
    'settings.section.chat': 'Chat',
    'settings.showChatStats': 'Show the stats strip above chat',
    'settings.showChatStatsHelp':
      'When off, the “msg/min · active · suspicious” strip above chat is hidden. The viewer count and badges stay.',
    'settings.section.interface': 'Interface',
    'settings.language': 'Language',
    'settings.languageAuto': 'Auto (browser)',
    'settings.languageRu': 'Русский',
    'settings.languageEn': 'English',
    'settings.auditCount': 'Bots logged: ',
    'settings.recordSession': 'Record session statistics',
    'settings.sessionDownload': 'Download session snapshot',
    'settings.previousSessionDownload': 'Download previous session',
    'tip.viewer.anomalies': 'Large changes in the Twitch count',
    'tip.viewer.anomalyTotals': 'Surges {surges} (avg +{rises}) · rollbacks {churn} (avg −{drops})',
    'tip.viewer.lastAnomaly': 'Latest swing',
    'tip.viewer.lastAnomalyValue': '{from} → {to} ({delta})',
    'tip.viewer.minute': 'Chat in the last minute',
    'tip.viewer.minuteChat': 'Authors {authors} · messages {messages}',
    'tip.viewer.minuteViewers': 'Viewers in the last minute',
    'tip.viewer.completeWindow': 'Full 10-minute window',
    'tip.viewer.partialWindow': 'Observed {minutes} of 10 minutes',
    'settings.copyJson': 'Copy JSON',
    'settings.copied': '✔ Copied!',
    'settings.download': 'Download .json',
    'settings.clear': 'Clear',
    'settings.hint':
      'Analysis lives in the tab · network only with GQL age lookup',
    'settings.scrollMore': 'Scroll for more ↓',

    'options.title': 'Twitch Chat X-Ray — settings',
    'options.eyebrow': 'LOCAL · NO NETWORK',
    'options.lead':
      'A local chat X-ray: bot badges, client-side R9K, audit log and a live-viewer estimate. Everything is computed inside the tab.',
    'options.help': 'How it works',
    'options.filters': 'Suspicious accounts',
    'options.badge': 'Show BOT badges',
    'options.action': 'Messages at or above threshold',
    'options.keep': 'Keep visible',
    'options.repeats': 'Repeated messages',
    'options.stats': 'Statistics',
    'options.estimate': 'Show estimate beside the Twitch viewer count',
    'options.data': 'Data and language',
    'options.exportHint': 'Download the audit log and recording from the chat settings on the stream page.',
    'options.weights': 'Score breakdown',
    'options.scoreHelp': 'BOT 30 means a suspicion score of 30 points. Hover over the badge before a username to see which signals contributed.',
    'options.repeatHelp': 'R9K detects repeated or similar messages and runs of identical characters. It can dim a message even when its author has no BOT badge.',
    'options.estimateHelp': 'The model assumes that 8–12.5% of viewers write in ten minutes. For example, 1,000 unique authors passing the filter yield an estimate of 8,000–12,500 viewers before applying the lower of the current and median Twitch counts as a cap. Participation varies by stream.',
    'options.heading': 'Settings',
    'options.thresholdLabel': 'Action threshold (10–100 points)',
    'options.auditHelp':
      'The log lives in the tab memory. Copy and download buttons are available in the Chat X-Ray panel on the stream page.',
    'options.accountAgeHelp':
      'When enabled, the extension asks gql.twitch.tv for createdAt of suspicious accounts and accounts that could reach the threshold after the age check. It caches answers in tab memory. This is an unofficial endpoint.',
    'options.hint':
      'Analysis lives in the tab; network only with GQL age lookup. The same settings are available in the Chat X-Ray panel on the stream page.',
    'options.cardR9k.title': 'Why is a message dimmed?',
    'options.cardR9k.body':
      'Exact normalized repeats are searched in a 15-minute index; fuzzy matching scans the last 1000 messages. Short messages and character floods are checked separately.',
    'options.cardScore.title': 'What does BOT 30 mean?',
    'options.cardScore.body':
      'No badges 15, default color 10, numeric suffix 10, first message 10, id cluster 15, fresh empty account 10, wave 10, rhythm 5, sterile text 5, self-repeat 10. A hard “scam” signal adds +25.',
    'options.cardViewers.title': 'How is the audience estimated?',
    'options.cardViewers.body':
      'The official Twitch number stays untouched. Next to it is a live-viewer range built from clean unique chatters. The parentheses show data loading, and a bot wave turns the counter red.',
    'options.footerLib': 'Twitch Chat X-Ray · Manifest V3 · ES Modules',
    'options.footerPrivacy':
      'Passive IRC capture · GQL age lookup is opt-in',
  },
});

function templateCache(locale) {
  return MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];
}

function interpolate(template, params) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

let currentLocale = resolveLocale(null);

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  const next = resolveLocale(locale);
  const changed = next !== currentLocale;
  currentLocale = next;
  return changed;
}

/**
 * Translate a key with optional {placeholder} params. Unknown keys return the
 * key itself so a missing string is visible in development instead of
 * silently rendering an empty node.
 */
export function t(key, params, locale) {
  const resolved = normalizeLocale(locale) || currentLocale;
  const table = templateCache(resolved);
  let template = table[key];
  if (template === undefined) {
    template = MESSAGES[DEFAULT_LOCALE][key];
  }
  if (template === undefined) {
    return String(key);
  }
  return interpolate(template, params);
}

/** Format a locale-aware number for display. */
export function formatLocalizedNumber(value, locale, options) {
  const resolved = normalizeLocale(locale) || currentLocale;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  try {
    return new Intl.NumberFormat(intlLocale(resolved), options || {}).format(
      number
    );
  } catch (_error) {
    return String(Math.round(number));
  }
}

/** Format a percent with a fixed number of fraction digits. */
export function formatPercent(value, locale, digits) {
  const places = Number.isFinite(digits) ? digits : 1;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '—';
  }
  const formatted = formatLocalizedNumber(number, locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return formatted + '%';
}
