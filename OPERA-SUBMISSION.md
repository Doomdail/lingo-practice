# Поля заявки Opera / Opera submission fields

Материалы для Lingo Practice 0.3.1, разработчик **doomdail**. Ниже — английские значения для формы. Перед отправкой проверьте, что репозиторий, лицензия, политика и выбранный тег доступны без входа, а версия совпадает с загруженным пакетом. Создание этих материалов не означает одобрения или публикации в Opera.

## Ссылки из формы

| Field                          | Value                                                             | Как заполнить                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service website URL            | Leave blank                                                       | У расширения нет собственного веб-сервиса. Не указывать YouTube, профиль GitHub или репозиторий как принадлежащий нам сервис.                            |
| Support page URL               | `https://github.com/Doomdail/lingo-practice/issues`               | Публичная поддержка. Не отправлять через Issues личные ответы, секреты или конфиденциальные субтитры.                                                    |
| Public source code URL         | `https://github.com/Doomdail/lingo-practice`                      | Публичный репозиторий исходников.                                                                                                                        |
| Source code URL for moderators | `https://github.com/Doomdail/lingo-practice/tree/v0.3.1`          | Исходники точной версии пакета. Код не минифицирован и не собран в bundle, поэтому поле необязательно; эту ссылку можно указать для удобства проверки.   |
| License URL                    | `https://github.com/Doomdail/lingo-practice/blob/main/LICENSE`    | Лицензия MIT, Copyright (c) 2026 doomdail. Если поле принимает текст, вставить полное содержимое `LICENSE`, а не только слово MIT.                       |
| Privacy policy URL             | `https://github.com/Doomdail/lingo-practice/blob/main/PRIVACY.md` | Полная политика на русском и английском. Если поле принимает текст, вставить английскую часть вместе с датой, разработчиком и контактом из начала файла. |

Ссылка на тег `v0.3.1` соответствует пакету `lingo-practice-0.3.1-store.zip`. При отправке другой версии укажите её фактический тег или полный SHA коммита.

Если форма называет поля немного иначе, ориентируйтесь на назначение: сайт принадлежащего вам сервиса, поддержка, открытый исходный код, исходники для модераторов, лицензия и политика — это разные сведения. [Руководство Opera по подготовке заявки](https://help.opera.com/en/extensions/publishing-guidelines/#prepare).

## Build instructions — English text to paste

```text
Lingo Practice is a Manifest V3 extension written in plain JavaScript, CSS and JSON. There is no compilation, transpilation, bundling or minification step. The runtime files in the source repository are the files included in the extension package. No npm installation, API key, developer server or Node.js build is required.

Packaging environment:
- Microsoft Windows 11 Pro, version 10.0.26100.
- PowerShell 7.6.5; packaging was also verified with Windows PowerShell 5.1.
- Node.js 22.22.1 is used for optional tests only, not to package or run the extension.

Steps:
1. Download and extract the source for the exact tag or commit corresponding to the submitted extension version. The public repository is https://github.com/Doomdail/lingo-practice .
2. Open PowerShell in the extracted repository directory, which contains manifest.json and scripts/package.ps1.
3. Check that manifest.json contains the submitted version number.
4. Run:
   pwsh -NoProfile -File .\scripts\package.ps1
   Alternatively, with Windows PowerShell 5.1:
   powershell.exe -NoProfile -File .\scripts\package.ps1
5. The script creates lingo-practice-<version>-store.zip in the parent directory. This is the store package: manifest.json is at the ZIP root. It also creates lingo-practice-<version>.zip with the source files for manual distribution.
6. The script verifies the packaged files against the source using SHA-256. It copies existing runtime files and assets; it does not transform the JavaScript or download code. ZIP container bytes may vary with file timestamps, but the runtime file contents are checked.
7. To inspect the package, extract the store ZIP and load its directory as an unpacked extension from opera://extensions with Developer mode enabled. Open a regular YouTube watch page and click the extension icon.

Optional unit tests, using Node.js 22.22.1:
node --test tests/exercise.test.cjs tests/storage.test.cjs tests/i18n.test.cjs

The extension uses the existing YouTube player. Packaged code reads available caption information, may request caption text over HTTPS from YouTube in the current page context, and may read the native transcript panel. It does not download or execute remote extension code. Lesson data is saved locally in chrome.storage.local and is not sent to the developer.
```

Исходный тег для модератора и архив для магазина должны соответствовать друг другу. Для версии 0.3.1 имя загружаемого файла — `lingo-practice-0.3.1-store.zip`. Не загружайте вместо него архив GitHub с внешней папкой или архив исходников `lingo-practice-0.3.1.zip`.

## Description — English text to paste

**Name:** Lingo Practice — YouTube

**Summary:** Practise listening with YouTube captions, fill missing words and replay difficult segments.

**Description:**

```text
Lingo Practice turns captions on regular YouTube video pages into listening exercises. Open a video, click the extension icon and fill in missing words while you listen. The existing video player appears above the exercise rows.

Features:
- Caption tracks, the native YouTube transcript and local SRT/VTT import.
- Word hints, short segment replay and review of difficult parts.
- Adjustable difficulty, caption timing, video size and text size.
- Russian and English interface.
- Locally saved answers, preferences and playback position so you can resume a lesson in the same browser profile.

The extension is free and open source under the MIT License. Created by doomdail.

The extension reads the current video's title, identifier and caption text after you activate it. Exercise text, answers, progress and preferences are stored locally in your browser. They are not sent to the developer. Caption loading may communicate with YouTube in the current page context. Local lesson records are not encrypted by the extension; removing the extension deletes its saved local data. See the privacy policy for details.

Caption availability and accuracy depend on the video and YouTube's interface. Shorts and live streams are not supported. Language-learning difficulty is designed primarily for English captions. The extension adds no advertisements and pauses exercises while it detects a YouTube video advertisement.

Lingo Practice is an independent extension. It is not affiliated with or endorsed by YouTube, Google or LingoClip.

Support: https://github.com/Doomdail/lingo-practice/issues
Privacy: https://github.com/Doomdail/lingo-practice/blob/main/PRIVACY.md
```

Имя в карточке должно совпадать с именем в итоговом manifest/локализации. Если оно отличается от предложенного выше, используйте фактическое имя релиза. Не добавляйте неподтверждённые утверждения об одобрении Opera, Google или YouTube.
