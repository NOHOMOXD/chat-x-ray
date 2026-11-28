/*
 * Twitch Chat X-Ray — options page.
 * Uses the same chrome.storage.local record as the in-chat settings window.
 * Every label carries data-i18n (or data-i18n-attr for attributes) and is
 * rendered with the active UI language, so the page is English on English
 * browsers and Russian on Russian ones.
 */
import { createScoreHelp } from '../ui/settings/score-help.ts';
import { createBroadcastHistoryClient } from '../platform/broadcast-history-client.ts';
import { SettingsRepository, normalizeSettings, DEFAULTS } from '../config/settings.ts';
import {
  getLocale,
  resolveLocale,
  setLocale,
  t,
} from '../i18n/i18n.ts';

(function () {
  'use strict';

  const repository = new SettingsRepository();
  document.querySelectorAll('[data-score-help]').forEach((node) => node.appendChild(createScoreHelp('i18n')));

  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-opt-setting]'));
  const saveState = document.getElementById('save-state');
  const resetButton = document.getElementById('reset-settings');
  const languageSelect = document.querySelector('[data-opt-setting="language"]');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let settings = normalizeSettings(DEFAULTS);

  function navigate() {
    const active = location.hash === '#help' ? 'help' : 'settings';
    for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a')) {
      const id = link.hash.slice(1);
      const section = document.getElementById(id);
      if (!section) throw new Error(`Missing options section: ${id}`);
      section.hidden = id !== active;
      if (id === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  window.addEventListener('hashchange', navigate);
  navigate();

  const clearHistoryButton = document.getElementById('clear-history');
  if (!clearHistoryButton) throw new Error('Missing clear history button');
  clearHistoryButton.addEventListener('click', async () => {
    await createBroadcastHistoryClient().clear();
    showSaved(t('settings.historyCleared'));
  });

  function applyLanguage(locale: string) {
    setLocale(locale);
    const html = document.documentElement;
    html.setAttribute('lang', getLocale());
    document.title = t('options.title');

    const nodes = document.querySelectorAll<HTMLElement>('[data-i18n]');
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node) continue;
      // <option> elements describe their reserved label with a value, so the
      // inner <option> nodes only carry data-i18n — translate them first and
      // skip the attribute pass that would overwrite the parent's label.
      const key = node.dataset.i18n;
      if (key === undefined) continue;
      const attr = node.dataset.i18nAttr;
      if (attr) {
        node.setAttribute(attr, t(key));
      } else if (node.tagName !== 'SELECT' && node.tagName !== 'INPUT') {
        node.textContent = t(key);
      }
    }
  }

  function showSaved(message?: string) {
    if (!saveState) {
      return;
    }
    saveState.textContent = message || t('app.saved');
    saveState.classList.add('is-visible');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveState?.classList.remove('is-visible');
    }, 1600);
  }

  function sync(next: unknown) {
    settings = normalizeSettings(next);
    const values: Record<string, unknown> = { ...settings };
    inputs.forEach((input) => {
      const key = input.dataset.optSetting;
      if (key === 'suspectAction' || key === 'r9kAction' || key === 'language') {
        input.value = settings[key];
      } else if (key === 'suspiciousThreshold') {
        input.value = String(settings.suspiciousThreshold);
      } else {
        if (input instanceof HTMLInputElement) input.checked = Boolean(key && values[key]);
      }
    });

    if (languageSelect) {
      // "Auto" follows the browser; show which language that resolves to.
      const auto = languageSelect.querySelector('option[value=""]');
      if (auto) {
        const resolved = resolveLocale('') === 'ru' ? 'Русский' : 'English';
        auto.textContent = t('settings.languageAuto') + ' — ' + resolved;
      }
    }
  }

  function readFromInputs() {
    const next: Record<string, unknown> = { ...settings };
    inputs.forEach((input) => {
      const key = input.dataset.optSetting;
      if (key === 'suspiciousThreshold') {
        next[key] = Number(input.value);
      } else if (key === 'suspectAction' || key === 'r9kAction' || key === 'language') {
        next[key] = input.value;
      } else if (key) {
        next[key] = input instanceof HTMLInputElement && Boolean(input.checked);
      }
    });

    return normalizeSettings(next);
  }

  function commit() {
    const next = readFromInputs();
    const languageChanged = next.language !== settings.language;
    sync(next);
    if (languageChanged) {
      applyLanguage(resolveLocale(next.language));
      sync(next);
    }
    repository.save(next).then(() => {
      showSaved(t('app.saved'));
    });
  }

  inputs.forEach((input) => input.addEventListener('change', commit));

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      const defaults = normalizeSettings(DEFAULTS);
      sync(defaults);
      applyLanguage(resolveLocale(defaults.language));
      sync(defaults);
      repository.save(defaults).then(() => {
        showSaved(t('app.resetDone'));
      });
    });
  }

  applyLanguage(resolveLocale(''));
  repository.load().then((loaded) => {
    applyLanguage(resolveLocale(loaded.language));
    sync(loaded);
  });
  repository.subscribe((next) => {
    applyLanguage(resolveLocale(next.language));
    sync(next);
  });
})();
