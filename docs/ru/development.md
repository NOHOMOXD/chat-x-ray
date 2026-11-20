# Разработка

[English](../development.md) · **Русский** · [К документации](../../README.ru.md)

Пользователи ставят ZIP из релиза — [README](../../README.ru.md#установка). Здесь — сборка и поддержка.

## Из исходников

Node.js 20+.

```bash
npm ci
npm run build:all    # dist/chrome, dist/firefox, dist/safari
```

`dist/chrome` грузится как распакованное расширение, `dist/firefox/manifest.json` — как временное дополнение, `dist/safari` — через **Add Temporary Extension**.

| Команда | Назначение |
| --- | --- |
| `npm test` | Модульные и DOM-тесты (Vitest, happy-dom) |
| `npm run build` / `build:firefox` / `build:safari` | Одна цель |
| `npm run build:all` | Все цели |
| `npm run dev` | Пересборка при изменениях |
| `npm run test:e2e` | Собранное расширение в Chromium и Firefox из Playwright |
| `npm run lint:firefox` | `web-ext lint` |
| `npm run verify` | Всё, что гоняет CI |
| `npm run package` | Архивы и `SHA256SUMS.txt` в `release/` |
| `npm run package:safari` | Проект Xcode в `release/` (macOS, полный Xcode) |

В `src/`: `app` — контроллер, фон и страница параметров, `core` — анализатор, R9K, группы ID, `analysis` — оценка аудитории, история и запись, `platform` — перехват сокета, IRC-парсер и браузерный API, плюс `config`, `i18n`, `ui`. Тесты повторяют структуру.

## Веса

Источник — `WEIGHTS` в [src/core/analyzer.js](../../src/core/analyzer.js). Десять признаков в сумме дают 100; `HARD_SIGNAL_WEIGHTS.solicitation` добавляет +25 сверху.

| Ключ | Баллы | Ключ | Баллы |
| --- | :---: | --- | :---: |
| `no-badges` | 15 | `fresh-account` | 10 |
| `id-cluster` | 15 | `wave` | 10 |
| `default-color` | 10 | `self-repeat` | 10 |
| `username-digits` | 10 | `mechanical-rhythm` | 5 |
| `first-msg` | 10 | `sterile-text` | 5 |

Неизвестный возраст даёт 0. Привилегированные роли и `SERVICE_BOT_LOGINS` не оцениваются. `id-cluster` снизили до 15, когда окно ID выросло в десять раз, а прежний `mechanical` 10 разделён на ритм 5 + текст 5 ради фильтрации.

## Заметки

- MAIN-мир общий со Twitch, поэтому `inject.js` принимает данные только с токеном рукопожатия. E2E проверяет, что подделка отбрасывается.
- E2E поднимает локальную страницу на `https://www.twitch.tv/`; Chrome убрал `--load-extension`, поэтому используется Chromium из Playwright.
- Схема записи сессии 1: время UTC, изменения настроек, минутные сводки, замеры, разрывы, рейды, аномалии, последние десять минут сообщений.

```bash
node tools/analyze-capture.mjs --snapshot snapshot.json [--reference viewers.jsonl]
node tools/analyze-capture.mjs --chat chat.jsonl --viewers viewers.jsonl [--json out.json]
```

Сырые записи содержат публичные ники; в `viewers.jsonl` по одному JSON в строке с `ts` (мс эпохи). `testing_logs/` и выгрузки аудита в git не попадают.

## Релиз

Workflow **Release** запускают вручную для репетиции: проверки, чистая пересборка исходников, параллельный E2E. Пуш тега `vX.Y.Z`, совпадающего со всеми тремя полями версии, публикует GitHub Release. `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` включают подпись Mozilla. Gecko ID и `data_collection_permissions: none` менять нельзя — иначе Firefox перестанет обновляться. `npm run package` запускают в чистой копии.
