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
