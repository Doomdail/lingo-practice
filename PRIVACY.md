# Lingo Practice — Privacy Policy / Политика конфиденциальности

Дата вступления в силу / Effective date: 24 September 2026.

- Разработчик / Developer: **doomdail**
- Контакт по вопросам данных / Privacy contact: [GitHub Issues](https://github.com/Doomdail/lingo-practice/issues)

## Русский

Lingo Practice помогает тренировать аудирование на обычных страницах видео YouTube. Расширение обрабатывает данные занятия на вашем устройстве. Оно не имеет собственного сервера, учётных записей, аналитики или рекламных трекеров и не отправляет данные занятия разработчику.

### Какие данные используются

После нажатия значка расширение получает доступ к текущей странице YouTube. Оно читает идентификатор и название видео, доступные дорожки и текст субтитров/расшифровки, время воспроизведения и состояние проигрывателя. Это нужно для упражнений, повторения фрагментов и синхронизации строк. Расширение не просматривает общую историю браузера и не работает в фоне на всех сайтах.

Если вы выбираете файл SRT/VTT, расширение читает его название и текст локально. Оно не загружает этот файл разработчику и не получает доступ к другим файлам. Для упражнения сохраняется обработанный текст, а не отдельная копия исходного файла.

В локальном хранилище расширения (`chrome.storage.local`) сохраняются:

- идентификатор и название видео, выбранный источник субтитров и его название, включая имя импортированного файла;
- текст строк, временные отметки, выбранные слова для пропусков и правильные ответы;
- введённые ответы, статусы заданий, количество ошибок и использованных подсказок;
- позиция воспроизведения, сдвиг субтитров, сложность, отметка приблизительных таймкодов и время последнего сохранения;
- настройки языка/размеров интерфейса и автопаузы, статистика трудных слов и контекстов, служебная версия записи и идентификатор экземпляра занятия для предотвращения конфликтов между вкладками.

Эти данные используются для продолжения занятий, подсказок, подсчёта результатов и разбора трудных мест. Они не продаются и не используются для рекламы.

### YouTube и сетевые запросы

Для получения субтитров расширение может выполнить HTTPS-запрос к YouTube в контексте открытой страницы. Браузер прилагает обычные данные запроса и применимые cookies YouTube. Расширение также может открыть штатную панель расшифровки YouTube, которая выполняет собственные запросы. Код расширения не извлекает и не сохраняет пароли или значения cookies и не передаёт их разработчику.

Видео воспроизводит штатный проигрыватель YouTube. Упражнения отображаются на странице YouTube; расширение не управляет обработкой данных самим сайтом. Обычная работа YouTube, включая воспроизведение, рекламу и сетевые запросы, регулируется [политикой конфиденциальности Google](https://policies.google.com/privacy). Код расширения не отправляет ваши ответы или импортированные субтитры отдельным сетевым запросом в YouTube либо разработчику.

### Хранение и удаление

Настройки и занятия остаются в текущем профиле браузера после закрытия вкладки или браузера. Расширение не синхронизирует их между устройствами и не удаляет старые занятия по расписанию. Данные хранятся до их перезаписи, удаления хранилища или удаления расширения. Собственное шифрование расширением не применяется.

В разделе **Мои занятия → Данные и помощь** можно удалить отдельное занятие или все сохранённые данные. Удаление всех данных очищает занятия, статистику слов и настройки в текущем профиле. Также данные удаляются при удалении Lingo Practice через страницу управления расширениями (`chrome://extensions` или `opera://extensions`). Простое отключение расширения, выход из тренировки или очистка истории YouTube не удаляют занятия.

Экспорт JSON содержит субтитры, правильные и введённые ответы, а CSV — трудные слова и контексты. Файлы создаются локально и не отправляются разработчику; после скачивания они остаются там, куда их сохранил браузер, пока вы не удалите их сами. Исходные SRT/VTT на диске и данные YouTube удалением расширения не затрагиваются. При сбое субтитров диагностический отчёт можно скопировать вручную: он содержит код ошибки и технические признаки, но не адрес/название видео, текст субтитров, ответы или имена файлов.

### Контакт и изменения

По вопросам этой политики используйте [GitHub Issues](https://github.com/Doomdail/lingo-practice/issues). Разработчик не может прочитать или удалить занятия на вашем устройстве удалённо.

Если вы добровольно создаёте обращение, разработчик получает опубликованный вами текст, вложения и публичные данные профиля GitHub и использует их для ответа и исправления проблем. Обращения публичны: не публикуйте личные ответы, конфиденциальные субтитры, пароли или другие секреты. Публикации в Issues хранятся отдельно от данных расширения и не удаляются при его удалении; ими можно управлять через GitHub. Использование GitHub регулируется [его политикой конфиденциальности](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Изменения в обработке данных будут отражаться в обновлённой политике и необходимых уведомлениях расширения/магазина.

## English

Lingo Practice helps you practise listening on regular YouTube video pages. The extension processes lesson data on your device. It has no developer-operated server, user accounts, analytics or advertising trackers, and does not send lesson data to the developer.

### Data used

After you click the extension icon, it accesses the current YouTube page. It reads the video identifier and title, available caption tracks and caption/transcript text, playback time and player state. This supports exercises, segment replay and caption synchronisation. It does not read your general browser history or run in the background on all websites.

If you select an SRT/VTT file, the extension reads its name and text locally. It does not upload the file to the developer or gain access to other files. It saves processed exercise text rather than a separate copy of the original file.

The extension's local storage (`chrome.storage.local`) contains:

- the video identifier and title, selected caption source and its label, including the imported file's name;
- caption text, timestamps, selected gap words and expected answers;
- your entered answers, task status, mistake counts and hint usage;
- playback position, caption offset, difficulty, an approximate-timing flag and the last save time;
- interface language/size and auto-pause preferences, difficult-word statistics and contexts, a record revision and a lesson-instance identifier used to prevent conflicting writes from multiple tabs.

This data supports lesson resumption, hints, results and review of difficult parts. It is not sold or used for advertising.

### YouTube and network requests

To retrieve captions, the extension may make an HTTPS request to YouTube in the open page's context. The browser includes ordinary request information and applicable YouTube cookies. The extension may also open YouTube's native transcript panel, which makes its own requests. Extension code does not extract or store passwords or cookie values, or transmit them to the developer.

YouTube's existing player plays the video. Exercises appear on the YouTube page; the extension does not control the website's own data processing. YouTube's normal operation, including playback, advertising and network requests, is covered by [Google's Privacy Policy](https://policies.google.com/privacy). Extension code does not upload your answers or imported subtitles to YouTube or the developer through a separate network request.

### Retention and deletion

Preferences and lessons remain in the current browser profile after a tab or the browser closes. The extension does not sync them across devices or automatically expire old lessons. They remain until overwritten, their storage is cleared, or the extension is removed. The extension does not apply its own encryption.

In **My lessons → Data and help**, you can delete one lesson or all saved data. Delete all data clears lessons, word statistics, and settings in this browser profile. Removing Lingo Practice through the browser's extensions page (`chrome://extensions` or `opera://extensions`) also deletes its saved data. Disabling the extension, exiting an exercise, or clearing YouTube history does not delete lessons.

The JSON backup contains captions and correct and entered answers; the CSV contains difficult words and contexts. These files are created locally and are not sent to the developer. Downloads remain where the browser saved them until you delete them yourself. Removing the extension does not delete original SRT/VTT files on disk or data held by YouTube. If caption loading fails, you can copy a diagnostic report containing an error code and technical availability flags, but no video address or title, caption text, answers, or file names.

### Contact and updates

For questions about this policy, use [GitHub Issues](https://github.com/Doomdail/lingo-practice/issues). The developer cannot remotely read or delete lessons on your device.

If you voluntarily open an issue, the developer receives the text, attachments and public GitHub profile information you publish and uses them to respond and fix problems. Issues are public: do not post private answers, confidential subtitles, passwords or other secrets. Issue posts are stored separately from extension data and are not deleted when you remove the extension; you can manage them through GitHub. Use of GitHub is covered by [its Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

Changes to data practices will be reflected in an updated policy and applicable extension/store notices.
