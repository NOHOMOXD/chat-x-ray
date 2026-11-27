# Разработка

[English](../development.md) · **Русский** · [К документации](../../README.ru.md)

Пользователи ставят ZIP из релиза — [README](../../README.ru.md#установка). Здесь — сборка и поддержка.

## Из исходников

Node.js 24+.

```bash
npm ci
npm run build:all    # dist/chrome, dist/firefox
```

`dist/chrome` грузится как распакованное расширение, `dist/firefox/manifest.json` — как временное дополнение.

| Команда | Назначение |
| --- | --- |
| `npm run typecheck` | Проверка переведённых исходников и тестов TypeScript |
| `npm test` | Модульные и DOM-тесты (Vitest, happy-dom) |
| `npm run build` / `build:firefox` | Одна цель |
| `npm run build:all` | Все цели |
| `npm run dev` | Пересборка при изменениях |
| `npm run test:e2e` | Собранное расширение в Chromium и Firefox из Playwright |
| `npm run lint:firefox` | `web-ext lint` |
| `npm run verify` | Всё, что гоняет CI |
| `npm run package` | Архивы расширений и исходников в `release/` |

В `src/`: `app` — контроллер, фон и страница параметров, `core` — анализатор, R9K, группы ID, `analysis` — оценка аудитории, история и запись, `platform` — перехват сокета, IRC-парсер и браузерный API, плюс `config`, `i18n`, `ui`. Тесты повторяют структуру.

## Веса

Источник — `WEIGHTS` в [src/core/score-message.ts](../../src/core/score-message.ts). Десять признаков в сумме дают 100; `HARD_SIGNAL_WEIGHTS.solicitation` добавляет +25 сверху.

| Ключ | Баллы | Ключ | Баллы |
| --- | :---: | --- | :---: |
| `no-badges` | 15 | `fresh-account` | 10 |
| `id-cluster` | 15 | `wave` | 10 |
| `default-color` | 10 | `self-repeat` | 10 |
| `username-digits` | 10 | `mechanical-rhythm` | 5 |
| `first-msg` | 10 | `sterile-text` | 5 |

Неизвестный возраст даёт 0 баллов. Расширение определяет служебных ботов по официальному бейджу Twitch `bot-badge` или известному логину и исключает их из числа чаттерсов аудитории. Привилегированные роли текущего канала освобождены от скоринга. R9K продолжает проверять повторы сообщений.

## Заметки

- MAIN-мир общий со Twitch, поэтому `inject.js` принимает данные только с токеном рукопожатия. E2E проверяет, что подделка отбрасывается.
- E2E поднимает локальную страницу на `https://www.twitch.tv/`; Chrome убрал `--load-extension`, поэтому используется Chromium из Playwright.
- Схема записи сессии 3: время UTC, изменения настроек, минутные сводки, замеры, разрывы, рейды, аномалии, последние десять минут сообщений.

```bash
node tools/analyze-capture.mjs --snapshot snapshot.json [--reference viewers.jsonl]
node tools/analyze-capture.mjs --chat chat.jsonl --viewers viewers.jsonl [--json out.json]
```

Сырые записи содержат публичные ники; в `viewers.jsonl` по одному JSON в строке с `ts` (мс эпохи). `testing_logs/` и выгрузки аудита в git не попадают.

## Релиз

Workflow **Release** запускают вручную для репетиции: проверки, чистая пересборка исходников, параллельный E2E. Пуш тега `vX.Y.Z`, совпадающего со всеми тремя полями версии, публикует GitHub Release. `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` включают подпись Mozilla. Gecko ID и `data_collection_permissions: none` менять нельзя — иначе Firefox перестанет обновляться. `npm run package` запускают в чистой копии.

## Как читать код

Сообщение Twitch проходит через `src/platform/inject.ts` и парсер
`src/platform/irc-parser.ts`. Пакет принимает `MessageBridge` в
`src/platform/message-bridge.ts`, затем `ChatXRayApp.processMessages` в `src/app/app-controller.ts`
передаёт его в `processChatMessage` из `src/app/process-chat-message.ts`, а тот — в `Analyzer.ingest` из `src/core/analyzer.ts`. Проверка текста и
имени автора находится в `src/core/analyzer-input.ts`, а общая форма принятой
записи — в `src/core/analyzer-record.ts`.

- Базовые баллы и причины находятся в `src/core/score-message.ts`. Позднее
  уточнение возраста выполняет `src/core/apply-account-age.ts`, а баллы за
  волну добавляет `src/core/wave-boost.ts`; подтверждения и сохранённые
  бонусы обновляет `src/core/bot-confirmation.ts`. Анализатор управляет порядком.
  Порядок сценариев скоринга проверяется в `tests/core/analyzer.test.ts` и
  `tests/core/score-message.test.ts`.
- Повторы ищет `src/core/r9k-matcher.ts`. Итоговое действие `none`, `mute` или
  `hide` выбирает `src/ui/chat/row-mode.ts`, а `message-row.ts` применяет его к
  строке чата. Сценарии выбора действия находятся в `tests/ui/message-row.test.ts`.
- Оценку аудитории строит `src/analysis/viewer-estimate.ts`. Состояние окна
  хранит `src/core/chat-session.ts`, а восстановленные после перезагрузки
  строки описаны в `src/analysis/live-rows.ts`. Восстановление снимка находится
  в `src/analysis/live-state.ts`.
- Настройки нормализует `src/config/settings-model.ts`, сохраняет
  `src/config/settings.ts`. Историей эфиров управляет фоновый обработчик через
  `src/analysis/broadcast-history.ts`. Временные снимки вкладок сохраняет
  `src/platform/tab-checkpoints.ts`.
- При добавлении настройки проверьте её значение по умолчанию и нормализацию,
  страницу параметров `src/app/options.ts`, панель `src/ui/settings/settings-panel.ts`
  и потребителя настройки. Проверки репозитория настроек находятся в
  `tests/config/settings.test.ts`.
- Если Twitch изменил расположение меню или заголовка чата, начните с
  `src/ui/settings/twitch-settings-host.ts` и
  `src/ui/settings/twitch-settings-integration.ts`. Последний модуль отвечает
  за добавление кнопки и строки, подписку на события и очистку таймеров;
  `SettingsModal` отвечает за открытое окно и поля формы.

### Пять вопросов для разбора кода

Команды ниже запускают только указанный тестовый файл. Их можно выполнять из
корня проекта; для полной проверки всех тестов используйте `npm test`.

1. **Почему сообщение получило такой балл?** IRC-кадр разбирает
   [`parseFrame`](../../src/platform/irc-parser.ts), затем
   [`processChatMessage`](../../src/app/process-chat-message.ts) передаёт его в
   `Analyzer.ingest`. Базовые причины и баллы создаёт
   [`scoreMessage`](../../src/core/score-message.ts); поздний возраст и волна
   могут дополнить запись. Подсказку строит
   [`buildBadgeTooltip`](../../src/ui/shared/tooltip-badge.ts). Проверка:
   `npx vitest run tests/core/score-message.test.ts`.
2. **Почему строка скрыта при небольшом балле?** R9K-повтор ищет
   [`R9KMatcher`](../../src/core/r9k-matcher.ts), а
   [`resolveRowMode`](../../src/ui/chat/row-mode.ts) объединяет результат
   скоринга, R9K и настройки действия. Правило применяется к строке в
   [`MessageRow`](../../src/ui/chat/message-row.ts). Проверка:
   `npx vitest run tests/ui/message-row.test.ts`.
3. **Почему оценка аудитории ещё не появилась или изменилась после перезагрузки?**
   Официальные замеры хранит [`ViewerHistory`](../../src/analysis/viewer-history.ts),
   диапазон строит [`buildViewerModel`](../../src/analysis/viewer-estimate.ts),
   а [`restoreLiveSnapshot`](../../src/analysis/live-state.ts) восстанавливает
   допустимые данные вкладки. Неполное окно и отсутствие замера — разные состояния.
   Проверка: `npx vitest run tests/analysis/viewer-estimate.test.ts`.
4. **Что хранится после закрытия вкладки и что удаляет очистка истории?**
   Настройки находятся под ключом `tcxSettings` в
   [`SettingsRepository`](../../src/config/settings.ts). История хранится под
   `tcx:broadcastHistory:v1`, отметка очистки — под
   `tcx:broadcastHistory:clearedAt`; операции принадлежат
   [`BroadcastHistory`](../../src/analysis/broadcast-history.ts). Временные
   снимки с префиксом `tcx:reload:v2:` обрабатывает
   [`TabCheckpoints`](../../src/platform/tab-checkpoints.ts). Команда очистки в
   [`background.ts`](../../src/app/background.ts) очищает снимки и историю, но
   не настройки. Проверка: `npx vitest run tests/analysis/broadcast-history.test.ts`.
5. **Где менять одну настройку?** Добавьте поле и значение по умолчанию в
   [`settings-model.ts`](../../src/config/settings-model.ts), обработайте его в
   нормализации, странице [`options.ts`](../../src/app/options.ts), панели
   [`settings-panel.ts`](../../src/ui/settings/settings-panel.ts) и коде,
   которому настройка нужна. Затем проверьте сохранение и применение:
   `npx vitest run tests/config/settings.test.ts`.
