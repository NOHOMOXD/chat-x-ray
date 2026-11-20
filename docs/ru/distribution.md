# Установка и обновления

[English](../distribution.md) · **Русский** · [К документации](../../README.ru.md)

## Что в релизе

| Файл | Для кого |
| --- | --- |
| `chat-x-ray-vX.Y.Z-chrome-opera.zip` | Chrome, Edge, Opera |
| `chat-x-ray-vX.Y.Z-firefox.zip` | Firefox (временная установка) |
| `*.xpi` | Firefox, подписанный — только если настроены секреты AMO |
| `chat-x-ray-vX.Y.Z-source.zip` | Сборка из исходников |
| `SHA256SUMS.txt` | Контрольные суммы |

Для установки распакуйте архив Вашего браузера (с окончанием `-chrome-opera.zip` или `-firefox.zip`). В корне распакованной папки находится `manifest.json`. Дальнейшие шаги описаны в [README](../../README.ru.md#установка).

Проверка загрузки, по желанию:

```bash
shasum -a 256 -c SHA256SUMS.txt   # macOS
sha256sum -c SHA256SUMS.txt       # Linux
```

## Обновление

Замените файлы в **той же** папке и нажмите «Обновить» на странице расширений — иначе браузер поставит его как новое. Временные дополнения Firefox загружаются заново после каждого перезапуска. Перед удалением выгрузите то, что нужно сохранить: локальное хранилище вместе с историей эфиров может исчезнуть вместе с расширением.

## Safari на Mac

Режима «загрузить распакованное» в Safari нет. Нужны полный Xcode и Safari 18+:

```bash
npm ci
npm run package:safari    # проект Xcode в release/
```

Откройте проект и один раз запустите схему приложения macOS, затем разрешите неподписанные расширения в настройках разработчика Safari, включите Chat X-Ray и предоставьте ему доступ к Twitch. Быстрая локальная проверка в Safari 18.4+: `npm run build:safari`, затем **Add Temporary Extension** с папкой `dist/safari`. Apple описывает [подписанное распространение и локальную проверку](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension).
