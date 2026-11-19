# Разработка

[English](../development.md) · **Русский** · [К документации](../../README.ru.md)

Потребуется Node.js 20 или новее. Из корня репозитория выполни `npm ci`, затем `npm run build:all`. В каталоге `dist` появятся ресурсы для Chromium, Firefox и Safari. Загрузка в браузер описана в [инструкции по установке](distribution.md).

| Команда | Назначение |
| --- | --- |
| `npm test` | Модульные и DOM-тесты на Vitest и happy-dom |
| `npm run test:watch` | Перезапуск тестов при изменениях |
| `npm run test:coverage` | Отчёт о покрытии V8 |
| `npm run build` | Сборка для Chrome |
| `npm run build:all` | Сборка ресурсов для всех браузеров |
| `npm run dev` | Пересборка при изменениях |
| `npm run test:e2e` | Браузерные тесты Chromium и Firefox |
| `npm run lint:firefox` | Проверка сборки Firefox через web-ext |
| `npm run verify` | Комплексная проверка проекта |
| `npm run package` | Архивы в каталоге release |
| `npm run package:safari` | Подготовка Safari-проекта на Mac с полным Xcode |

Для браузерных тестов установи браузеры командой `npx playwright install chromium firefox`. Сценарии загружают собранное расширение и подставляют локальную страницу Twitch. Среди проверок — перехват IRC, отображение интерфейса и отклонение сообщения без токена моста. Для загрузки расширения используется Chromium из Playwright.

## Где искать код

В `src/app` находятся контроллер и страница параметров, в `src/core` — скоринг, R9K и сессия чата, в `src/analysis` — оценка аудитории и история. Каталог `src/platform` содержит перехват сокета, IRC-парсер и адаптер браузера. Настройки находятся в `src/config`, переводы интерфейса — в `src/i18n`, переводы манифеста — в `src/_locales`. Папка `src/ui` содержит элементы чата, панель настроек, общие компоненты и стили. Сборщик `build.js` адаптирует `src/manifest.json` для целевого браузера. Тесты находятся в `tests`, сценарии Playwright — в `tests/e2e`.
