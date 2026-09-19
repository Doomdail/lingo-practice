(function (root) {
  'use strict';

  // Russian UI copy is the key and fallback; subtitles and user filenames stay untouched.
  const english = {
    'Тренировка аудирования': 'Listening practice',
    Настройки: 'Settings',
    Выйти: 'Exit',
    'СЛУШАЙ. ВПИСЫВАЙ. ЗАПОМИНАЙ.': 'LISTEN. FILL IN. REMEMBER.',
    'Твоя следующая маленькая победа': 'Your next small win',
    Результат: 'Result',
    Продолжить: 'Continue',
    Пауза: 'Pause',
    '↶ Повторить строку': '↶ Replay line',
    'К текущей строке': 'Go to current line',
    'Источник субтитров': 'Subtitle source',
    Автоматически: 'Automatically',
    'Расшифровка YouTube': 'YouTube transcript',
    'Файл субтитров': 'Subtitle file',
    'Открыть SRT/VTT': 'Open SRT/VTT',
    'Разбор ошибок': 'Review mistakes',
    'Загружаем субтитры…': 'Loading subtitles…',
    'Повторить загрузку': 'Retry loading',
    'К основной тренировке': 'Back to practice',
    'Субтитры с пропусками': 'Subtitles with missing words',
    'Enter — проверить · можно исправить ответ': 'Enter — check · you can edit your answer',
    'Enter — проверить · ошибку можно исправить': 'Enter — check · you can correct a mistake',
    'Пауза в конце строки': 'Pause at the end of a line',
    'Прогресс хранится на устройстве': 'Progress is stored on this device',
    'Настройки тренировки': 'Practice settings',
    'Подстрой под себя': 'Make it your own',
    Сложность: 'Difficulty',
    Лёгкая: 'Easy',
    Обычная: 'Balanced',
    Сложная: 'Hard',
    'Размер видео': 'Video size',
    Компактное: 'Compact',
    Среднее: 'Medium',
    Большое: 'Large',
    'Размер текста': 'Text size',
    'Количество строк': 'Number of lines',
    'Сдвиг субтитров, секунды': 'Subtitle offset, seconds',
    '+ задерживает субтитры, − показывает раньше. Например, +1,5 — на полторы секунды позже.':
      '+ delays subtitles; − shows them earlier. For example, +1.5 means one and a half seconds later.',
    'Сложность меняет только ещё не начатые задания. На небольшом экране видимых строк может быть меньше выбранного числа.':
      'Difficulty only changes exercises you have not started. A small screen may show fewer lines than you selected.',
    'Закрыть настройки': 'Close settings',
    'Язык интерфейса': 'Interface language',
    'По языку браузера': 'Browser language',
    Русский: 'Русский',
    English: 'English',
    'Сохраняем…': 'Saving…',
    'Сохранено на устройстве': 'Saved on this device',
    'Прогресс обновлён в другой вкладке. Переоткройте тренировку.':
      'Progress was updated in another tab. Reopen practice.',
    'Прогресс не сохранён': 'Progress was not saved',
    'Прогресс восстановлен': 'Progress restored',
    'Сохранение недоступно': 'Saving is unavailable',
    ' Текущая тренировка сохранена.': ' Your current practice has been kept.',
    Пропустить: 'Skip',
    Подсказка: 'Hint',
    'Повторить медленнее': 'Replay more slowly',
    'Показать слово': 'Reveal word',
    'Попробуй ещё раз': 'Try again',
    Верно: 'Correct',
    'Верно с подсказкой': 'Correct with a hint',
    Показано: 'Revealed',
    Пропущено: 'Skipped',
    'Повтор на скорости 0,75×': 'Replaying at 0.75× speed',
    'Нажмите кнопку воспроизведения на видео.': 'Press the play button on the video.',
    'Пока нет сложных слов. Здесь появятся ошибки, пропуски и ответы с подсказками.':
      'No difficult words yet. Mistakes, skipped words and answers with hints will appear here.',
    'Повторить сложные места': 'Repeat difficult parts',
    'Закрыть разбор': 'Close review',
    'Повтор завершён. Основная оценка сохранена.':
      'Review complete. Your main result is unchanged.',
    'Реклама · задания приостановлены. ': 'Ad · practice is paused. ',
    ' · автоматические': ' · auto-generated',
    'Расшифровка YouTube · текущий язык': 'YouTube transcript · current language',
    ' · время округлено до секунд; окончание строки приблизительное':
      ' · times are rounded to seconds; line endings are approximate',

    'Повторить с {time}': 'Replay from {time}',
    'Пропущенное слово, строка {number}': 'Missing word, line {number}',
    'Первая буква: {letter}': 'First letter: {letter}',
    ' · сдвиг {offset} с': ' · offset {offset} s',
    'Тренировка восстановлена · {source}': 'Practice restored · {source}',
    'Самостоятельно: {independent}. С подсказкой: {assisted}. Показано: {revealed}. Пропущено: {skipped}. Осталось: {remaining}.':
      'Without hints: {independent}. With hints: {assisted}. Revealed: {revealed}. Skipped: {skipped}. Remaining: {remaining}.',
    'Готово · самостоятельно {independent} · с подсказкой {assisted}':
      'Complete · without hints {independent} · with hints {assisted}',
    'Самостоятельно: {independent} · с подсказкой: {assisted} · показано: {revealed} · пропущено: {skipped} · без ответа: {remaining}':
      'Without hints: {independent} · with hints: {assisted} · revealed: {revealed} · skipped: {skipped} · unanswered: {remaining}',
    'Ошибок: {mistakes} · подсказок: {hints}': 'Mistakes: {mistakes} · hints: {hints}',
    'Повтор сложных мест · {current} из {total}':
      'Reviewing difficult parts · {current} of {total}',

    'Расширение не ответило. Обновите страницу YouTube.':
      'The extension did not respond. Reload the YouTube page.',
    'Обновите расширение: сохранение прогресса недоступно.':
      'Update the extension: saving progress is unavailable.',
    'Выберите файл .srt или .vtt.': 'Choose an .srt or .vtt file.',
    'Файл слишком большой: максимум 2 МБ.': 'The file is too large: the limit is 2 MB.',
    'В этой дорожке нет слов для тренировки. Выберите другой источник.':
      'This track has no words to practice. Choose another source.',
    'Некорректный таймкод в файле субтитров.': 'Invalid timestamp in the subtitle file.',
    'Не удалось прочитать SRT/VTT: проверьте формат файла.':
      'Could not read SRT/VTT: check the file format.',
    'Некорректный фрагмент субтитров: проверьте время и текст.':
      'Invalid subtitle segment: check its timing and text.',
    'Слишком много фрагментов: максимум 5000.': 'Too many subtitle segments: the limit is 5000.',
    'Слишком длинный объединённый фрагмент: максимум 4000 символов.':
      'The merged segment is too long: the limit is 4000 characters.',
    'В файле нет речевых субтитров для тренировки.':
      'The file has no spoken subtitles to practice.',
    'Тренировка изменена в другой вкладке. Закройте режим и откройте снова, чтобы загрузить свежий прогресс.':
      'Practice was changed in another tab. Close and reopen practice to load the latest progress.',
    'Не удалось сохранить или прочитать прогресс. Проверьте разрешение «storage» и свободное место в хранилище расширения.':
      'Could not save or read progress. Check the storage permission and the available space in extension storage.',
    'Проигрыватель не ответил. Повторите загрузку.':
      'The player did not respond. Try loading again.',
    'Страница изменилась. Закройте режим и включите его снова.':
      'The page changed. Close and reopen practice.',
    'Открыто другое видео.': 'A different video is open.',
    'Проигрыватель ещё не загрузился. Повторите попытку.':
      'The player has not loaded yet. Try again.',
    'Дождитесь загрузки нового видео.': 'Wait for the new video to load.',
    'YouTube не отдал эту дорожку. Выберите «Расшифровка YouTube» или «Автоматически».':
      'YouTube did not provide this track. Choose “YouTube transcript” or “Automatically”.',
    'Субтитры недоступны. Откройте «Показать текст видео» в описании YouTube и повторите загрузку.':
      'Subtitles are unavailable. Open “Show transcript” in the YouTube description and try loading again.',
    'Загрузка отменена.': 'Loading cancelled.',
    'YouTube не загрузил текст субтитров. Попробуйте открыть расшифровку вручную или выбрать другое видео.':
      'YouTube did not load the subtitles. Try opening the transcript manually or choose another video.',
    'Не удалось прочитать субтитры. Обновите страницу и повторите попытку.':
      'Could not read the subtitles. Reload the page and try again.',
  };

  function resolve(language, browserLanguage) {
    return language === 'ru' || language === 'en'
      ? language
      : /^ru(?:-|$)/i.test(browserLanguage ?? '')
        ? 'ru'
        : 'en';
  }

  function text(key, parameters = {}, language = 'auto') {
    const message =
      resolve(language, root.navigator?.language) === 'en' && Object.hasOwn(english, key)
        ? english[key]
        : String(key);
    return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
      parameters && Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder,
    );
  }

  const api = { resolve, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LingoI18n = api;
})(globalThis);
