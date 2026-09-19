const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'i18n.js');
const api = () => {
  assert.ok(fs.existsSync(modulePath), 'the shared translation module must exist');
  return require(modulePath);
};

test('language selection honors overrides and otherwise follows the browser', () => {
  const { resolve } = api();
  for (const [language, browser, expected] of [
    ['auto', 'ru', 'ru'],
    ['auto', 'ru-RU', 'ru'],
    ['auto', 'RU-kz', 'ru'],
    ['auto', 'en-GB', 'en'],
    ['auto', 'de-DE', 'en'],
    ['auto', 'russian', 'en'],
    ['ru', 'en-US', 'ru'],
    ['en', 'ru-RU', 'en'],
    ['invalid', 'ru-RU', 'ru'],
    [null, 'en-US', 'en'],
    [undefined, undefined, 'en'],
  ])
    assert.equal(resolve(language, browser), expected, `${language}/${browser}`);
});

test('English translates controls, help, accessibility labels and errors', () => {
  const { text } = api();
  assert.equal(text('Настройки', {}, 'en'), 'Settings');
  assert.equal(text('Верно с подсказкой', {}, 'en'), 'Correct with a hint');
  assert.equal(text('Источник субтитров', {}, 'en'), 'Subtitle source');
  assert.equal(
    text('Файл слишком большой: максимум 2 МБ.', {}, 'en'),
    'The file is too large: the limit is 2 MB.',
  );
  assert.equal(
    text('Расшифровка YouTube · текущий язык', {}, 'en'),
    'YouTube transcript · current language',
  );
  assert.equal(text('Настройки', {}, 'ru'), 'Настройки');
});

test('library strings, templates and trusted server errors exist in both languages', () => {
  const { text } = api();
  const keys = [
    'Мои занятия',
    'Занятия',
    'Трудные слова',
    'Данные и помощь',
    'Разделы',
    'Обновить библиотеку',
    'Загрузка библиотеки…',
    'Сохранённых занятий пока нет.',
    'Трудных слов пока нет.',
    'Ничего не найдено.',
    'Не удалось загрузить библиотеку.',
    'Пропущено повреждённых записей: {count}.',
    'Источник: {source}',
    'Обновлено: {date}',
    'Позиция: {time}',
    'Завершено: {completed} / {total}',
    'Удалить занятие?',
    'Занятие удалено.',
    'Некорректный идентификатор видео.',
    'Поиск по словам и контексту',
    'Сортировка',
    'По сложности',
    'По последнему появлению',
    'Попыток: {count}',
    'Самостоятельно: {count}',
    'Ошибок: {count}',
    'Подсказок: {count}',
    'Пропусков: {count}',
    'Контекст недоступен.',
    'Открыть видео с {time}',
    'Скачать CSV',
    'CSV скачан.',
    'Экспортировать резервную копию',
    'Экспорт резервной копии',
    'В резервную копию входят открытый текст субтитров, правильные и введённые ответы.',
    'Скачать JSON',
    'Резервная копия скачана.',
    'Файл резервной копии',
    'Импорт резервной копии',
    'Импортировать настройки',
    'Добавлено: {count}',
    'Обновлено занятий: {count}',
    'Пропущено занятий: {count}',
    'Обновлено слов: {count}',
    'Импортировать',
    'Импорт завершён.',
    'Удалить все данные',
    'Удалить все данные?',
    'Будут удалены занятия, ответы, настройки и статистика слов.',
    'Удалить всё',
    'Все данные удалены.',
    'Как заниматься',
    'Выберите дорожку или импортируйте SRT/VTT.',
    'Слушайте, вписывайте слово и нажимайте Enter.',
    'Используйте повтор и подсказки; прогресс сохраняется автоматически.',
    'Отмена',
    'Удалить',
    'Закрыть',
    'Расширение не ответило.',
    'Некорректные данные запроса.',
    'Хранилище изменено. Обновите библиотеку.',
    'Занятие изменено. Обновите библиотеку.',
    'Занятие не найдено.',
    'Данные изменились. Повторите предпросмотр импорта.',
    'Резервная копия слишком большая: максимум 10 МБ.',
    'Не удалось прочитать JSON резервной копии.',
    'Неподдерживаемый формат резервной копии.',
    'Резервная копия повреждена или превышает лимиты.',
    'Резервная копия содержит неверное или повторяющееся занятие.',
    'Резервная копия содержит неверный профиль слов.',
    'Резервная копия содержит неверный ID видео.',
    'Не удалось сохранить или прочитать прогресс. Проверьте разрешение «storage» и свободное место в хранилище расширения.',
  ];
  for (const key of keys) {
    assert.doesNotMatch(text(key, {}, 'en'), /[А-Яа-яЁё]/u, key);
    assert.ok(text(key, {}, 'ru').trim(), key);
  }
});

test('parameters preserve zero, quotes and unknown placeholders without changing user text', () => {
  const { text } = api();
  assert.equal(text('Повторить с {time}', { time: '00:15' }, 'en'), 'Replay from 00:15');
  assert.equal(
    text('Ошибок: {mistakes} · подсказок: {hints}', { mistakes: 0, hints: 2 }, 'en'),
    'Mistakes: 0 · hints: 2',
  );
  assert.equal(text('Первая буква: {letter}', { letter: 'Я' }, 'ru'), 'Первая буква: Я');
  assert.equal(text('Повторить с {time}', {}, 'en'), 'Replay from {time}');
  for (const source of [
    'My lesson.srt',
    'Мой урок.srt',
    'English (United States)',
    'A "quoted" video title',
    'constructor',
    '__proto__',
  ]) {
    assert.equal(text(source, {}, 'en'), source);
  }
  assert.equal(
    text('{caption}', { caption: '$& <b>hello</b> {time}' }, 'en'),
    '$& <b>hello</b> {time}',
  );
});

test('dynamic translations retain every named placeholder in both languages', () => {
  const { text } = api();
  const templates = [
    'Повторить с {time}',
    'Пропущенное слово, строка {number}',
    'Первая буква: {letter}',
    ' · сдвиг {offset} с',
    'Тренировка восстановлена · {source}',
    'Самостоятельно: {independent}. С подсказкой: {assisted}. Показано: {revealed}. Пропущено: {skipped}. Осталось: {remaining}.',
    'Готово · самостоятельно {independent} · с подсказкой {assisted}',
    'Самостоятельно: {independent} · с подсказкой: {assisted} · показано: {revealed} · пропущено: {skipped} · без ответа: {remaining}',
    'Ошибок: {mistakes} · подсказок: {hints}',
    'Повтор сложных мест · {current} из {total}',
  ];
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of templates) {
    const english = text(key, {}, 'en');
    assert.doesNotMatch(english, /[А-Яа-яЁё]/u, `missing English template: ${key}`);
    assert.deepEqual(placeholders(english), placeholders(text(key, {}, 'ru')), key);
  }
});

test('browser script uses navigator language without requiring CommonJS', () => {
  const source = fs.readFileSync(modulePath, 'utf8');
  for (const [language, expected] of [
    ['ru-RU', 'Настройки'],
    ['en-GB', 'Settings'],
  ]) {
    const context = vm.createContext({ navigator: { language } });
    vm.runInContext(source, context);
    assert.equal(context.LingoI18n.text('Настройки'), expected);
  }
});

test('both native locales provide usable extension metadata', () => {
  const keys = [
    'extensionName',
    'extensionDescription',
    'actionTitle',
    'openYouTubeTitle',
    'activationFailureTitle',
  ].sort();
  for (const language of ['en', 'ru']) {
    const localePath = path.join(root, '_locales', language, 'messages.json');
    assert.ok(fs.existsSync(localePath), `${language} metadata must exist`);
    const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    assert.deepEqual(Object.keys(messages).sort(), keys);
    for (const key of keys) {
      assert.equal(typeof messages[key].message, 'string');
      assert.ok(messages[key].message.trim(), `${language}/${key} cannot be empty`);
      if (language === 'en') assert.doesNotMatch(messages[key].message, /[А-Яа-яЁё]/u);
    }
  }
});
