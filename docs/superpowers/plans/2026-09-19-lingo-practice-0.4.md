# Lingo Practice 0.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить Lingo Practice 0.4 с локальной библиотекой занятий, адаптивным обучением, резервными копиями, безопасной сменой источника, корректным автопродолжением, диагностикой субтитров и доступным интерфейсом.

**Architecture:** `background.js` остаётся единственным владельцем `chrome.storage.local` и сериализует операции через `storageQueue`; чистая учебная логика живёт в `exercise.js`, а профиль, словарь и формат обмена — в новом `data.js`. Урок на YouTube остаётся shadow-DOM интерфейсом в `content.js`, а `library.html`/`library.js`/`library.css` образуют отдельную options page и обращаются к данным только сообщениями фоновой службе.

**Tech Stack:** Manifest V3, обычные JavaScript/CSS/HTML без runtime-зависимостей и сборки, `node:test`, VM-тест фонового service worker, Playwright + Chromium/Opera GX для browser smoke, PowerShell 5+ для проверяемых ZIP.

**Spec:** `docs/superpowers/specs/2026-09-19-learning-library-design.md`

## Global Constraints

- Все учебные данные остаются в `chrome.storage.local`; сервер, аккаунт, аналитика, синхронизация и новые сетевые сервисы не добавляются.
- Сохраняются только разрешения `activeTab`, `scripting`, `storage`; широкое постоянное разрешение YouTube и `clipboardWrite` не добавляются.
- Нажатие значка расширения по-прежнему включает или закрывает урок; библиотека открывается как `options_ui` в новой вкладке.
- Схема урока остаётся `schema: 2`; отсутствие `gapFrequency` означает `dense`, неизвестная сложность означает `balanced`.
- Формат профиля слов — `schema: 1`, максимум `2_000` слов; одно занятие содержит максимум `5_000` заданий.
- Формат резервной копии — `lingo-practice-backup`, `version: 1`; файл ограничен `10_000_000` байтами и `1_000` занятиями.
- `balanced` остаётся сложностью по умолчанию, `adaptive` включается явно; `dense` остаётся частотой по умолчанию.
- Новые видимые строки, статусы и aria-метки доступны на русском и английском через `i18n.js`.
- Интерфейс поддерживает клавиатуру, ширину `320` CSS px, масштаб `200%`, `:focus-visible`, `prefers-reduced-motion` и контраст WCAG AA, без заявления о полной сертификации WCAG.
- Shorts, live, другие видеосайты, речь, перевод, календарное интервальное повторение и несколько пропусков в одной строке остаются вне версии.
- Общие файлы `background.js`, `content.js`, `exercise.js`, `i18n.js` и интеграционные тесты имеют одного владельца за раз; параллельные агенты работают в отдельных worktree и передают отдельные коммиты.
- `main`, тег и публичный release не меняются; результат собирается в `feature/0.4-learning` и передаётся владельцу до отдельного решения о слиянии.

## Scope Check

Функции образуют одну версию, потому что библиотека, адаптивный профиль, backup и защита устаревших вкладок используют один schema/message contract, а source guard, onboarding и diagnostics делят состояние одного `content.js`. Каждая задача ниже заканчивается отдельным тестируемым коммитом и может быть отклонена reviewer отдельно, но разносить их по независимым планам означало бы временно зафиксировать несовместимые storage/UI контракты. Один план также сохраняет согласованную владельцем последовательную интеграцию в одну feature-ветку.

## Review Focus

- Unicode, типографские апострофы и пробельный пользовательский ввод должны сохранять начатое задание, а CSV-значения с `=`, `+`, `-`, `@` после пробелов не должны исполняться как формулы; это закрепляют Tasks 1 и 2.
- Повреждённая, слишком большая, будущая или содержащая повторяющийся video ID резервная копия должна целиком отклоняться без частичной записи; это закрепляют Tasks 2 и 4.
- Устаревшая вкладка после удаления, полной очистки или импорта не должна воскресить занятие, профиль или настройки, включая очередь быстрых сохранений одного writer; это закрепляют Tasks 3 и 4.
- Ручная пауза, реклама, seek, смена видео, раскрытие, пропуск и завершение видео не должны неожиданно запускать воспроизведение; это закрепляет Task 7.
- Timeout, HTTP error, пустой/невалидный JSON, отсутствие кнопки и циклическая/слишком большая модель YouTube должны завершаться ограниченно и давать диагностику без URL, video ID, текста, ответов, имени файла, cookies, user agent, stack trace и сырых исключений; это закрепляют Tasks 8 и 9.

---

## File Map

| Файл                                                             | Ответственность в 0.4                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exercise.js`                                                    | Нормализация слов, выбор пропуска, adaptive-веса, частота, сохранение начатых заданий, `hasUserWork`, preferences/session/profile validators и однократный учёт завершений. |
| `data.js`                                                        | Агрегация глобального словаря, безопасный CSV, backup v1, строгая проверка и детерминированный merge-preview.                                                               |
| `background.js`                                                  | Авторизация отправителя, единственная очередь storage, revision/epoch/tombstone, миграция профиля и lesson/admin message API.                                               |
| `library.html`                                                   | Семантический каркас вкладки «Мои занятия» и доступные диалоги.                                                                                                             |
| `library.js`                                                     | Рендер занятий/слов, поиск/сортировка, Continue/Delete/Clear, JSON export/preview/import, CSV download и help.                                                              |
| `library.css`                                                    | Адаптивный layout options page, состояние фокуса, 320 px/200%, reduced motion и печатные/скрытые utility-классы.                                                            |
| `content.js`                                                     | Интеграция профиля/частоты, доступное подтверждение источника, библиотека/help, причина автопаузы, диагностика и live announcements.                                        |
| `youtube.js`                                                     | Ограниченный каскад извлечения субтитров и структурированные privacy-safe failures/diagnostics.                                                                             |
| `i18n.js`                                                        | Полный RU/EN словарь обеих страниц и стабильные шаблоны ошибок/aria-label.                                                                                                  |
| `styles.css`                                                     | Доступные диалоги/статусы урока, reflow и фокус без изменения страницы YouTube вне режима.                                                                                  |
| `manifest.json`                                                  | Версия `0.4.0`, `options_ui`, icon 64; список разрешений не меняется.                                                                                                       |
| `tests/exercise.test.cjs`                                        | Учебная чистая логика и совместимость старых уроков.                                                                                                                        |
| `tests/data.test.cjs`                                            | Профильный словарь, CSV и backup/merge как чистые функции.                                                                                                                  |
| `tests/storage.test.cjs`                                         | Реальный message handler с mock StorageArea, sender rules, queue, revision/epoch и admin API.                                                                               |
| `tests/youtube.test.cjs`                                         | MAIN-world функция с ограниченными DOM/fetch fixtures для кодов ошибок и privacy whitelist.                                                                                 |
| `tests/library-smoke.cjs`                                        | Options page в реальном extension context: список, словарь, экспорт/import/delete/clear, RU/EN и reflow.                                                                    |
| `tests/browser-smoke.cjs`                                        | Интеграция урока: source guard, adaptive/frequency, resume, onboarding, diagnostics, accessibility и регрессии.                                                             |
| `tests/keyboard-smoke.cjs`                                       | NumPad/NumLock, диалоги, focus return и Opera GX.                                                                                                                           |
| `scripts/package.ps1`                                            | Полный allowlist runtime/source файлов и SHA-256 проверка ZIP.                                                                                                              |
| `scripts/render-assets.cjs`                                      | Воспроизводимый `icon64.png` и `promo300x188.png` вместе с текущими изображениями.                                                                                          |
| `README.md`, `README.ru.md`, `PRIVACY.md`, `OPERA-SUBMISSION.md` | Поведение 0.4, локальные данные, диагностика, удаление/import/export и команды проверки.                                                                                    |

## Execution Topology

1. В первой волне параллельно выполняются Task 1 (`exercise.js`) и чистая часть Task 8 (`youtube.js` + `tests/youtube.test.cjs`); файлы не пересекаются.
2. Task 2 следует за Task 1, потому что `data.js` импортирует утверждённый API `LingoExercise`.
3. Tasks 3 и 4 выполняются последовательно одним владельцем `background.js`; каждый принятый коммит прогоняет unit/storage suite.
4. После Task 4 параллельно выполняются Task 5 (только новые library-файлы + manifest/library smoke) и Tasks 6–7 одним последовательным владельцем `content.js`/`styles.css`; переводы `i18n.js` сводит интегратор после обоих коммитов.
5. UI-часть Task 8 интегрируется после Task 7 одним владельцем `content.js`; затем Tasks 9–10 выполняются последовательно в общей ветке.
6. После каждого агентского коммита свежий reviewer сверяет diff с этой задачей до cherry-pick; интегратор не разрешает два незавершённых изменения одного общего файла.

## Shared Test Fixtures

Pure-logic tests use concrete factories, copied into each test file that needs them:

```js
const cue = (text, start = 0) => ({ id: 0, start, end: start + 2, text });
const task = (patch = {}) => ({
  id: 0,
  start: 0,
  end: 2,
  text: 'word',
  before: '',
  answer: 'word',
  after: '',
  value: '',
  status: 'pending',
  mistakes: 0,
  hints: 0,
  ...patch,
});
const session = (videoId, updatedAt, tasks, patch = {}) => ({
  schema: 2,
  videoId,
  title: videoId,
  sourceLabel: 'English',
  sourceSelection: 'auto',
  approximate: false,
  difficulty: 'balanced',
  gapFrequency: 'dense',
  offset: 0,
  position: 0,
  updatedAt,
  tasks,
  ...patch,
});
```

Storage tests use these exact senders and derive rejected cases with object spread:

```js
const extensionId = 'lingo-test-extension';
const lessonSender = {
  id: extensionId,
  tab: { id: 1 },
  frameId: 0,
  url: 'https://www.youtube.com/watch?v=video01',
};
const librarySender = {
  id: extensionId,
  tab: { id: 2 },
  frameId: 0,
  url: `chrome-extension://${extensionId}/library.html`,
};
const iframeSender = { ...lessonSender, frameId: 2 };
const httpSender = { ...lessonSender, url: 'http://www.youtube.com/watch?v=video01' };
const shortsSender = { ...lessonSender, url: 'https://www.youtube.com/shorts/video01' };
const evilHostSender = {
  ...lessonSender,
  url: 'https://www.youtube.com.evil.test/watch?v=video01',
};
const foreignExtension = { ...lessonSender, id: 'foreign-extension' };
const libraryWithQuery = { ...librarySender, url: `${librarySender.url}?x=1` };
const libraryWithHash = { ...librarySender, url: `${librarySender.url}#x` };
const foreignLibrary = { ...librarySender, id: 'foreign-extension' };
const libraryIframe = { ...librarySender, frameId: 1 };
const webLookalike = { ...librarySender, url: 'https://example.test/library.html' };
```

`worker().sendRaw()` resolves `undefined` immediately when the registered listener does not return `true`; accepted asynchronous requests resolve from `sendResponse`. Browser helpers named later (`activate`, `openLibrary`, `callLibrary`, `readStorage`, `importThroughUi`) operate only through the real service worker/page UI except `readStorage`, which is a test-only `worker.evaluate(() => chrome.storage.local.get(null))` snapshot.

### Task 1: Учебное ядро — adaptive, частота и совместимость

**Files:**

- Modify: `exercise.js:4-64,225-330`
- Modify: `tests/exercise.test.cjs:1-214`

**Interfaces:**

- Consumes: существующие `Cue`, `Task`, `schema: 2` и функция случайности `() => number`.
- Produces: `normalizeAnswer(value)`, `hasStarted(task)`, `hasUserWork(tasks)`, `create(cue, random, difficulty, wordProfile)`, `createTasks(cues, options)`, `restoreWordProfile(value, strict)`, `updateWordProfile(profile, previousTasks, nextTasks, now)`, `buildWordProfile(lessons)`, расширенные `preferences(value)` и `restoreSession(saved, videoId)`.

- [ ] **Step 1: Зафиксировать failing tests для пользовательской работы, defaults и миграции**

```js
test('user work includes every destructive source-change case', () => {
  const clean = { value: '', mistakes: 0, hints: 0, status: 'pending' };
  assert.equal(exercise.hasUserWork([]), false);
  assert.equal(exercise.hasUserWork([clean]), false);
  for (const patch of [
    { value: ' ' },
    { mistakes: 1 },
    { hints: 1 },
    { status: 'wrong' },
    { status: 'correct', value: 'word', answer: 'word' },
    { status: 'assisted', value: 'word', answer: 'word' },
    { status: 'skipped', value: 'word', answer: 'word' },
    { status: 'revealed', value: 'word', answer: 'word' },
  ])
    assert.equal(exercise.hasUserWork([{ ...clean, ...patch }]), true);
});

test('legacy sessions retain exact tasks and default to balanced dense', () => {
  const legacyTask = task({
    text: 'Hello friend',
    before: 'Hello ',
    answer: 'friend',
    after: '',
    value: 'fri',
  });
  const legacySession = session('legacy01', 10, [legacyTask]);
  delete legacySession.difficulty;
  delete legacySession.gapFrequency;
  const restored = exercise.restoreSession(legacySession, legacySession.videoId);
  assert.equal(restored.difficulty, 'balanced');
  assert.equal(restored.gapFrequency, 'dense');
  assert.equal(restored.tasks[0].answer, 'friend');
  assert.equal(restored.tasks[0].value, 'fri');
});
```

- [ ] **Step 2: Запустить новые тесты и подтвердить ожидаемое падение**

Run: `node --test tests/exercise.test.cjs`

Expected: FAIL с `exercise.hasUserWork is not a function` и отсутствующим `gapFrequency`.

- [ ] **Step 3: Добавить общие predicates и расширить preferences/session**

```js
const normalizeAnswer = (value) =>
  String(value).normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[’‘ʼ]/g, "'");
const hasStarted = (task) =>
  Boolean(task) && (Boolean(task.value) || Number(task.mistakes) > 0 ||
    Number(task.hints) > 0 || task.status !== 'pending');
const hasUserWork = (tasks) => Array.isArray(tasks) && tasks.some(hasStarted);

// In preferences(value):
difficulty: ['easy', 'balanced', 'hard', 'adaptive'].includes(value.difficulty)
  ? value.difficulty : 'balanced',
gapFrequency: ['dense', 'normal', 'sparse'].includes(value.gapFrequency)
  ? value.gapFrequency : 'dense',
onboardingSeen: value.onboardingSeen === true,

// In restoreSession(saved, videoId):
difficulty: preferences(saved).difficulty,
gapFrequency: preferences(saved).gapFrequency,
```

- [ ] **Step 4: Проверить predicates и legacy restore**

Run: `node --test tests/exercise.test.cjs --test-name-pattern="user work|legacy sessions"`

Expected: PASS.

- [ ] **Step 5: Зафиксировать failing tests для dense/normal/sparse и сохранения начатых строк**

```js
test('gap frequency counts only eligible cues and starts with the first', () => {
  const cues = [
    cue('Alpha one'),
    cue('[Music]'),
    cue('Bravo two'),
    cue('Charlie three'),
    cue('Delta four'),
    cue('Echo five'),
    cue('Foxtrot six'),
    cue('Golf seven'),
  ];
  assert.equal(
    exercise.createTasks(cues, { random: () => 0, gapFrequency: 'dense' }).filter((t) => t.answer)
      .length,
    7,
  );
  assert.equal(
    exercise.createTasks(cues, { random: () => 0, gapFrequency: 'normal' }).filter((t) => t.answer)
      .length,
    4,
  );
  assert.equal(
    exercise.createTasks(cues, { random: () => 0, gapFrequency: 'sparse' }).filter((t) => t.answer)
      .length,
    3,
  );
});

test('rebuild preserves every started task byte-for-byte', () => {
  const startedVariants = [
    task({ value: 'draft' }),
    task({ mistakes: 1 }),
    task({ hints: 1 }),
    task({ status: 'wrong' }),
    task({ status: 'correct', value: 'word' }),
  ];
  const previousTasks = startedVariants.map((task, id) => ({ ...task, id }));
  const rebuilt = exercise.createTasks(previousTasks, {
    random: () => 0.99,
    difficulty: 'hard',
    gapFrequency: 'sparse',
    previousTasks,
  });
  for (const previous of previousTasks) {
    if (exercise.hasStarted(previous)) assert.deepEqual(rebuilt[previous.id], previous);
  }
});
```

- [ ] **Step 6: Реализовать единый генератор заданий и cadence**

Rename the current `create()` implementation at `exercise.js:23-64` to internal `createWithProfile(cue, random, difficulty, profile)`, leaving its current selection behavior intact at this step. Add the public validating wrapper before `createTasks`:

```js
function usableProfile(value) {
  return value?.schema === 1 && value.words && !Array.isArray(value.words)
    ? value
    : { schema: 1, words: {} };
}
function create(cue, random = Math.random, difficulty = 'random', wordProfile = null) {
  return createWithProfile(cue, random, difficulty, usableProfile(wordProfile));
}

function createTasks(cues, options = {}) {
  const random = options.random ?? Math.random;
  const difficulty = preferences(options).difficulty;
  const gapFrequency = preferences(options).gapFrequency;
  const stride = { dense: 1, normal: 2, sparse: 3 }[gapFrequency];
  const wordProfile = usableProfile(options.wordProfile);
  const previous = Array.isArray(options.previousTasks) ? options.previousTasks : [];
  let eligible = 0;
  return cues.map((cue, id) => {
    const prior = previous[id];
    const candidate = createWithProfile({ ...cue, id }, random, difficulty, wordProfile);
    if (!candidate.answer) return candidate;
    const keep = eligible++ % stride === 0;
    if (prior && hasStarted(prior)) return { ...prior };
    return keep ? candidate : { ...candidate, before: candidate.text, answer: null, after: '' };
  });
}
```

- [ ] **Step 7: Запустить frequency/rebuild tests**

Run: `node --test tests/exercise.test.cjs --test-name-pattern="frequency|rebuild"`

Expected: PASS, включая `[Music]`, которая не сдвигает счётчик eligible-строк.

- [ ] **Step 8: Зафиксировать failing tests adaptive-весов и нормализации**

```js
test('adaptive uses balanced pool and deterministic cumulative weights', () => {
  const profile = {
    schema: 1,
    words: {
      difficult: { attempts: 3, clean: 0, mistakes: 5, hints: 1, misses: 1, lastSeenAt: 10 },
      ordinary: { attempts: 5, clean: 5, mistakes: 0, hints: 0, misses: 0, lastSeenAt: 9 },
    },
  };
  assert.equal(
    exercise.create(cue('the difficult ordinary'), () => 0.7, 'adaptive', profile).answer,
    'difficult',
  );
  assert.equal(exercise.normalizeAnswer(' Don’t '), "don't");
});
```

- [ ] **Step 9: Реализовать adaptive pool и взвешенный выбор**

In `createWithProfile`, keep its excluded-range, tokenization and easy/hard scoring statements unchanged; replace the balanced branch and final picker with:

```js
const adaptiveWeight = (entry = {}) => {
  const need = (entry.mistakes ?? 0) + (entry.hints ?? 0) + 2 * (entry.misses ?? 0);
  return Math.min(8, Math.max(0.25, (1 + need) / (1 + (entry.clean ?? 0))));
};
const pickWeighted = (words, random, profile) => {
  const weighted = words.map((word) => [
    word,
    adaptiveWeight(profile.words[normalizeAnswer(word[0])]),
  ]);
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.min(0.999999999999, Math.max(0, random())) * total;
  return weighted.find(([, weight]) => (cursor -= weight) < 0)?.[0] ?? weighted.at(-1)?.[0];
};

// In createWithProfile(), both modes build the same meaningful-word pool.
if (['balanced', 'adaptive'].includes(difficulty)) {
  const meaningful = words.filter(
    (word) => word[0].length >= 4 && !common.has(normalizeAnswer(word[0])),
  );
  if (meaningful.length) words = meaningful;
}
const word =
  difficulty === 'adaptive'
    ? pickWeighted(words, random, profile)
    : words[Math.min(words.length - 1, Math.max(0, Math.floor(random() * words.length)))];
```

- [ ] **Step 10: Зафиксировать failing tests профиля и однократного перехода**

```js
test('profile counts only unfinished-to-finished transitions and caps one task at five mistakes', () => {
  const pending = task({ answer: 'Don’t', value: '', status: 'pending' });
  const corrected = task({
    answer: "Don't",
    value: "don't",
    status: 'correct',
    mistakes: 6,
    hints: 0,
  });
  const once = exercise.updateWordProfile(null, [pending], [corrected], 100);
  assert.deepEqual(once.words["don't"], {
    attempts: 1,
    clean: 0,
    mistakes: 5,
    hints: 0,
    misses: 0,
    lastSeenAt: 100,
  });
  assert.deepEqual(exercise.updateWordProfile(once, [corrected], [corrected], 200), once);
});
```

- [ ] **Step 11: Реализовать tolerant working-profile validator, strict backup mode и eviction**

```js
function restoreWordProfile(value, strict = false) {
  if (!value || value.schema !== 1 || !value.words || Array.isArray(value.words))
    return strict ? null : { schema: 1, words: {} };
  const entries = [];
  for (const [word, raw] of Object.entries(value.words)) {
    const valid =
      Boolean(word) &&
      word === normalizeAnswer(word) &&
      word.length <= 100 &&
      PROFILE_COUNTER_FIELDS.every(
        (key) =>
          Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 && raw[key] <= PROFILE_COUNTER_MAX,
      ) &&
      Number.isSafeInteger(raw?.lastSeenAt) &&
      raw.lastSeenAt >= 0;
    if (!valid) {
      if (strict) return null;
      else continue;
    }
    entries.push([word, { ...raw }]);
  }
  if (strict && entries.length > 2000) return null;
  entries.sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt || a[0].localeCompare(b[0]));
  return { schema: 1, words: Object.fromEntries(entries.slice(0, 2000)) };
}
```

`PROFILE_COUNTER_FIELDS` is `['attempts', 'clean', 'mistakes', 'hints', 'misses']`; counters use `PROFILE_COUNTER_MAX = 1_000_000`, while `lastSeenAt` is checked separately as a nonnegative safe integer.

After adding `restoreWordProfile`, replace the provisional `usableProfile` body from Step 6 with the full tolerant validator:

```js
function usableProfile(value) {
  return restoreWordProfile(value);
}
```

- [ ] **Step 12: Реализовать update/build profile и экспортировать финальный API**

```js
function updateWordProfile(profile, previousTasks = [], nextTasks = [], now = Date.now()) {
  const result = structuredClone(restoreWordProfile(profile));
  const samePrompt = (a, b) =>
    a?.id === b.id &&
    a.start === b.start &&
    a.end === b.end &&
    a.text === b.text &&
    normalizeAnswer(a.answer) === normalizeAnswer(b.answer);
  const add = (value, amount) => Math.min(PROFILE_COUNTER_MAX, value + amount);
  for (const [index, next] of nextTasks.entries()) {
    const previous = previousTasks[index];
    if (
      !next?.answer ||
      !finished(next) ||
      (previous && samePrompt(previous, next) && finished(previous))
    )
      continue;
    const key = normalizeAnswer(next.answer);
    const entry = result.words[key] ?? {
      attempts: 0,
      clean: 0,
      mistakes: 0,
      hints: 0,
      misses: 0,
      lastSeenAt: 0,
    };
    entry.attempts = add(entry.attempts, 1);
    entry.clean = add(
      entry.clean,
      next.status === 'correct' && next.mistakes === 0 && next.hints === 0 ? 1 : 0,
    );
    entry.mistakes = add(entry.mistakes, Math.min(5, next.mistakes));
    entry.hints = add(entry.hints, next.hints);
    entry.misses = add(entry.misses, ['skipped', 'revealed'].includes(next.status) ? 1 : 0);
    entry.lastSeenAt = now;
    result.words[key] = entry;
  }
  return restoreWordProfile(result);
}

function buildWordProfile(lessons) {
  return [...lessons]
    .sort((a, b) => a.updatedAt - b.updatedAt || a.videoId.localeCompare(b.videoId))
    .reduce((profile, lesson) => updateWordProfile(profile, [], lesson.tasks, lesson.updatedAt), {
      schema: 1,
      words: {},
    });
}
```

- [ ] **Step 13: Запустить полный exercise suite и formatter**

Run: `node --test tests/exercise.test.cjs`

Expected: PASS, включая cold start, Unicode apostrophe, `2_001`-е слово и malformed strict profile.

Run: `npx --yes prettier@3.6.2 --check exercise.js tests/exercise.test.cjs`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 14: Commit**

```powershell
git add exercise.js tests/exercise.test.cjs
git commit -m "feat: add adaptive exercise generation"
```

### Task 2: Чистый слой словаря, CSV и backup v1

**Files:**

- Create: `data.js`
- Create: `tests/data.test.cjs`

**Interfaces:**

- Consumes: `LingoExercise.normalizeAnswer`, `restoreSession`, `preferences`, `restoreWordProfile`, `isDifficult` из Task 1.
- Produces: `LingoData.limits`, `vocabulary(profile, lessons)`, `createVocabularyCsv(entries)`, `createBackup(state, exportedAt)`, `parseBackup(value)`, `planBackupImport(current, backup, importPreferences) -> {summary, changedLessons, next}`.

At the top of `tests/data.test.cjs`, derive named fixtures from the shared factories:

```js
const difficultFriend = task({
  text: 'Hello, friend!',
  before: 'Hello, ',
  answer: 'friend',
  after: '!',
  value: 'friend',
  status: 'correct',
  mistakes: 3,
  hints: 1,
  start: 12,
  end: 14,
});
const profile = {
  schema: 1,
  words: {
    friend: {
      attempts: 4,
      clean: 1,
      mistakes: 3,
      hints: 1,
      misses: 0,
      lastSeenAt: 20,
    },
  },
};
const olderLesson = session('older01', 10, [
  { ...difficultFriend, text: 'Old friend', before: 'Old ', start: 2, end: 4 },
]);
const newerLesson = session('newer01', 20, [difficultFriend], { title: 'Newer' });
const lessonWithUnansweredDifficultTask = session('unanswered01', 30, [
  task({
    text: 'An unfamiliar phrase',
    before: 'An ',
    answer: 'unfamiliar',
    after: ' phrase',
    mistakes: 1,
  }),
]);
```

- [ ] **Step 1: Написать failing tests агрегированного словаря**

```js
test('vocabulary joins profile with the newest available difficult context', () => {
  const entries = data.vocabulary(profile, [olderLesson, newerLesson]);
  assert.deepEqual(entries[0], {
    word: 'friend',
    attempts: 4,
    clean: 1,
    mistakes: 3,
    hints: 1,
    misses: 0,
    lastSeenAt: 20,
    score: 4,
    context: {
      text: 'Hello, friend!',
      time: 12,
      videoTitle: 'Newer',
      videoId: 'newer01',
      source: 'English',
    },
  });
});

test('a difficult saved task appears even before it has a profile counter', () => {
  const [entry] = data.vocabulary({ schema: 1, words: {} }, [lessonWithUnansweredDifficultTask]);
  assert.equal(entry.word, 'unfamiliar');
  assert.equal(entry.attempts, 0);
  assert.equal(entry.context.text, 'An unfamiliar phrase');
});
```

- [ ] **Step 2: Запустить test и подтвердить отсутствие модуля**

Run: `node --test tests/data.test.cjs`

Expected: FAIL с `Cannot find module '../data.js'`.

- [ ] **Step 3: Создать UMD-style модуль и vocabulary aggregation**

```js
(function (root) {
  'use strict';
  const exercise =
    typeof module !== 'undefined' && module.exports ? require('./exercise.js') : root.LingoExercise;
  const limits = { backupBytes: 10_000_000, lessons: 1000, tasks: 5000, words: 2000 };

  function vocabulary(profileValue, lessons) {
    const profile = exercise.restoreWordProfile(profileValue);
    const contexts = new Map();
    for (const lesson of [...lessons].sort((a, b) => b.updatedAt - a.updatedAt)) {
      for (const task of [...lesson.tasks].reverse()) {
        if (!task.answer || !exercise.isDifficult(task)) continue;
        const word = exercise.normalizeAnswer(task.answer);
        if (!contexts.has(word))
          contexts.set(word, {
            text: task.text,
            time: task.start + lesson.offset,
            videoTitle: lesson.title,
            videoId: lesson.videoId,
            source: lesson.sourceLabel,
          });
      }
    }
    const words = new Set([...Object.keys(profile.words), ...contexts.keys()]);
    return [...words]
      .map((word) => {
        const entry = profile.words[word] ?? {
          attempts: 0,
          clean: 0,
          mistakes: 0,
          hints: 0,
          misses: 0,
          lastSeenAt: 0,
        };
        return {
          word,
          ...entry,
          score: entry.mistakes + entry.hints + 2 * entry.misses,
          context: contexts.get(word) ?? null,
        };
      })
      .filter((entry) => entry.score > 0 || entry.context);
  }
  const api = { limits, vocabulary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LingoData = api;
})(globalThis);
```

- [ ] **Step 4: Проверить vocabulary test**

Run: `node --test tests/data.test.cjs --test-name-pattern="vocabulary"`

Expected: PASS, а удалённый урок больше не предоставляет context, title или video ID.

- [ ] **Step 5: Написать failing CSV tests для BOM/CRLF/quotes/formulas**

```js
test('CSV is Excel-safe UTF-8 with the exact public columns', () => {
  const csv = data.createVocabularyCsv([
    {
      word: ' =SUM(A1:A2)',
      context: 'say "hi",\nnow',
      attempts: 1,
      clean: 0,
      mistakes: 1,
      hints: 0,
      misses: 0,
      time: 1.5,
      videoTitle: '+title',
      videoId: 'id01',
      source: '@source',
    },
  ]);
  assert.ok(
    csv.startsWith(
      '\uFEFFword,context,attempts,clean,mistakes,hints,misses,time,video_title,video_id,source\r\n',
    ),
  );
  assert.match(csv, /"' =SUM\(A1:A2\)"/);
  assert.match(csv, /"say ""hi"",\r\nnow"/);
  assert.ok(csv.endsWith('\r\n'));
});
```

- [ ] **Step 6: Реализовать одинаковое quoting для каждой CSV-ячейки**

```js
const csvCell = (value) => {
  let text = String(value ?? '').replace(/\r\n?|\n/g, '\r\n');
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
};
function createVocabularyCsv(entries) {
  const columns = [
    'word',
    'context',
    'attempts',
    'clean',
    'mistakes',
    'hints',
    'misses',
    'time',
    'video_title',
    'video_id',
    'source',
  ];
  const rows = entries.map((entry) =>
    [
      entry.word,
      entry.context?.text,
      entry.attempts,
      entry.clean,
      entry.mistakes,
      entry.hints,
      entry.misses,
      entry.context?.time,
      entry.context?.videoTitle,
      entry.context?.videoId,
      entry.context?.source,
    ]
      .map(csvCell)
      .join(','),
  );
  return '\uFEFF' + columns.join(',') + '\r\n' + rows.join('\r\n') + (rows.length ? '\r\n' : '');
}
```

- [ ] **Step 7: Написать failing backup validation/merge tests**

```js
test('backup strips internals and round-trips answers', () => {
  const preferences = exercise.preferences({ difficulty: 'adaptive', gapFrequency: 'normal' });
  const storedLesson = { ...newerLesson, revision: 4, writerId: 'writer-a' };
  const wordProfile = profile;
  const backup = data.createBackup(
    { preferences, wordProfile, lessons: [storedLesson] },
    '2026-09-19T12:00:00.000Z',
  );
  assert.equal(backup.format, 'lingo-practice-backup');
  assert.equal(backup.version, 1);
  assert.equal('revision' in backup.lessons[0], false);
  assert.equal('writerId' in backup.lessons[0], false);
  assert.equal(data.parseBackup(backup).ok, true);
});

test('future, duplicate, oversized and one-bad-record backups fail atomically', () => {
  const base = data.createBackup(
    { preferences: {}, wordProfile: profile, lessons: [olderLesson, newerLesson] },
    '2026-09-19T12:00:00.000Z',
  );
  const futureBackup = { ...structuredClone(base), version: 2 };
  const duplicateIds = structuredClone(base);
  duplicateIds.lessons[1].videoId = duplicateIds.lessons[0].videoId;
  const tooManyLessons = {
    ...structuredClone(base),
    lessons: Array.from({ length: 1001 }, (_, id) => session(`video${id}`, id, [task()])),
  };
  const oversizedFileObject = { ...structuredClone(base), padding: 'x'.repeat(10_000_001) };
  const oneBrokenTask = structuredClone(base);
  oneBrokenTask.lessons.at(-1).tasks[0].end = -1;
  for (const value of [
    futureBackup,
    duplicateIds,
    tooManyLessons,
    oversizedFileObject,
    oneBrokenTask,
  ]) {
    const parsed = data.parseBackup(value);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.backup, undefined);
  }
});

test('merge chooses strictly newer lessons and words and is idempotent', () => {
  const local = {
    preferences: exercise.preferences(),
    wordProfile: profile,
    lessons: [olderLesson, newerLesson],
  };
  const imported = data.createBackup(
    {
      preferences: { fontSize: 24 },
      wordProfile: {
        schema: 1,
        words: { friend: { ...profile.words.friend, clean: 2, lastSeenAt: 21 } },
      },
      lessons: [
        session('added01', 30, [task()]),
        session('older01', 11, [task()]),
        session('newer01', 20, [task()]),
      ],
    },
    '2026-09-19T12:00:00.000Z',
  );
  const first = data.planBackupImport(local, imported, true);
  assert.deepEqual(first.summary, { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 });
  const second = data.planBackupImport(first.next, imported, true);
  assert.deepEqual(second.summary, { added: 0, updated: 0, skipped: 3, wordsUpdated: 0 });
});
```

- [ ] **Step 8: Реализовать canonical backup creation и строгий parser**

```js
function createBackup(state, exportedAt = new Date().toISOString()) {
  return {
    format: 'lingo-practice-backup',
    version: 1,
    exportedAt,
    preferences: exercise.preferences(state.preferences),
    wordProfile: exercise.restoreWordProfile(state.wordProfile),
    lessons: state.lessons.map((lesson) => exercise.restoreSession(lesson, lesson.videoId)),
  };
}
function parseBackup(value) {
  const fail = (message) => ({ ok: false, message });
  let encoded;
  try {
    encoded = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return fail('Не удалось прочитать JSON резервной копии.');
  }
  if (encoded > limits.backupBytes) return fail('Резервная копия слишком большая: максимум 10 МБ.');
  if (!value || value.format !== 'lingo-practice-backup' || value.version !== 1)
    return fail('Неподдерживаемый формат резервной копии.');
  if (
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !value.preferences ||
    typeof value.preferences !== 'object' ||
    Array.isArray(value.preferences) ||
    !Array.isArray(value.lessons) ||
    value.lessons.length > limits.lessons
  )
    return fail('Резервная копия повреждена или превышает лимиты.');
  const ids = new Set();
  const lessons = [];
  for (const raw of value.lessons) {
    const lesson = exercise.restoreSession(raw, raw?.videoId);
    if (!lesson || ids.has(lesson.videoId))
      return fail('Резервная копия содержит неверное или повторяющееся занятие.');
    ids.add(lesson.videoId);
    lessons.push(lesson);
  }
  const wordProfile = exercise.restoreWordProfile(value.wordProfile, true);
  if (!wordProfile) return fail('Резервная копия содержит неверный профиль слов.');
  return {
    ok: true,
    backup: {
      ...value,
      preferences: exercise.preferences(value.preferences),
      wordProfile,
      lessons,
    },
  };
}
```

- [ ] **Step 9: Реализовать pure merge preview без revision/writerId**

```js
function planBackupImport(current, backup, importPreferences = false) {
  const localById = new Map(current.lessons.map((lesson) => [lesson.videoId, lesson]));
  const nextLessons = [...current.lessons];
  const changedLessons = [];
  const summary = { added: 0, updated: 0, skipped: 0, wordsUpdated: 0 };
  for (const lesson of backup.lessons) {
    const local = localById.get(lesson.videoId);
    if (!local) {
      nextLessons.push(lesson);
      changedLessons.push(lesson);
      summary.added++;
    } else if (lesson.updatedAt > local.updatedAt) {
      nextLessons[nextLessons.indexOf(local)] = lesson;
      changedLessons.push(lesson);
      summary.updated++;
    } else summary.skipped++;
  }
  const wordProfile = mergeWords(current.wordProfile, backup.wordProfile, summary);
  return {
    summary,
    changedLessons,
    next: {
      lessons: nextLessons,
      preferences: importPreferences ? backup.preferences : current.preferences,
      wordProfile,
    },
  };
}

function mergeWords(localValue, importedValue, summary) {
  const local = exercise.restoreWordProfile(localValue);
  const imported = exercise.restoreWordProfile(importedValue, true);
  for (const [word, entry] of Object.entries(imported.words)) {
    if (!local.words[word] || entry.lastSeenAt > local.words[word].lastSeenAt) {
      local.words[word] = { ...entry };
      summary.wordsUpdated++;
    }
  }
  return exercise.restoreWordProfile(local);
}
```

- [ ] **Step 10: Запустить data suite, обе pure suites и formatter**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs`

Expected: PASS, включая повторный import без удвоения, future version и ошибку в последней записи большого массива.

Run: `npx --yes prettier@3.6.2 --check data.js tests/data.test.cjs`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 11: Commit**

```powershell
git add data.js tests/data.test.cjs
git commit -m "feat: add local learning data formats"
```

### Task 3: Надёжный lesson storage — sender, epoch и профиль

**Files:**

- Modify: `background.js:1-102`
- Modify: `tests/storage.test.cjs:1-187`

**Interfaces:**

- Consumes: `LingoExercise.restoreSession`, `preferences`, `restoreWordProfile`, `updateWordProfile`, `buildWordProfile`; Chrome `StorageArea` and existing `LINGO_STORE` request shape.
- Produces: lesson `get -> {session, preferences, wordProfile, version, storageEpoch}`; lesson `save -> {saved, version, storageEpoch}`; internal `isLessonSender`, `enqueue`, `handleLessonMessage`, `readEpoch`, `readRevision`, `isTombstone`.

- [ ] **Step 1: Расширить test harness до реального StorageArea/sender контракта**

```js
function worker(initial = {}, hooks = {}) {
  const data = structuredClone(initial);
  let receive,
    reads = 0;
  const get = async (keys) => {
    reads++;
    await hooks.beforeGet?.(keys);
    if (keys === null) return structuredClone(data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.map((key) => [key, structuredClone(data[key])]));
  };
  const remove = async (keys) => {
    await hooks.beforeRemove?.(keys);
    for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
  };
  // chrome.runtime.id/getURL, crypto.randomUUID, set/get/remove are passed into vm.runInNewContext.
  return {
    sendLesson(message, sender = lessonSender) {
      return send({ type: 'LINGO_STORE', videoId: 'video01', ...message }, sender);
    },
    sendLibrary(message, sender = librarySender) {
      return send({ type: 'LINGO_LIBRARY', ...message }, sender);
    },
    sendRaw: send,
    snapshot: () => structuredClone(data),
    reads: () => reads,
  };
}
```

- [ ] **Step 2: Написать failing sender-routing tests**

```js
test('only the extension main frame on a YouTube watch page reaches lesson storage', async () => {
  const app = worker();
  assert.equal((await app.sendLesson({ action: 'get' })).storageEpoch, 0);
  for (const sender of [foreignExtension, iframeSender, httpSender, shortsSender, evilHostSender]) {
    assert.equal(
      await app.sendRaw({ type: 'LINGO_STORE', action: 'get', videoId: 'video01' }, sender),
      undefined,
    );
  }
  assert.equal(app.reads(), 1);
});

test('lesson and library message namespaces cannot impersonate each other', async () => {
  assert.equal(
    await app.sendRaw({ type: 'LINGO_LIBRARY', action: 'list' }, lessonSender),
    undefined,
  );
  assert.equal(
    await app.sendRaw({ type: 'LINGO_STORE', action: 'get', videoId: 'video01' }, librarySender),
    undefined,
  );
});
```

- [ ] **Step 3: Запустить sender tests и подтвердить падение**

Run: `node --test tests/storage.test.cjs --test-name-pattern="extension main frame|namespaces"`

Expected: FAIL, потому что текущий handler не проверяет `sender.id`, не знает `LINGO_LIBRARY`, а mock не поддерживает `get(null)`.

- [ ] **Step 4: Выделить маршрутизацию поверх одной очереди**

```js
const LESSON_ACTIONS = new Set(['get', 'save']);
const LIBRARY_ACTIONS = new Set([
  'list',
  'vocabulary',
  'delete',
  'clear',
  'export',
  'previewImport',
  'import',
]);
const isLessonSender = (message, sender) =>
  message?.type === 'LINGO_STORE' &&
  LESSON_ACTIONS.has(message.action) &&
  sender.id === chrome.runtime.id &&
  Boolean(sender.tab?.id) &&
  sender.frameId === 0 &&
  /^https:\/\/www\.youtube\.com\/watch(?:\?|$)/.test(sender.url ?? '') &&
  /^[\w-]{1,64}$/.test(message.videoId ?? '');
const isLibrarySender = (message, sender) =>
  message?.type === 'LINGO_LIBRARY' &&
  LIBRARY_ACTIONS.has(message.action) &&
  sender.id === chrome.runtime.id &&
  sender.frameId === 0 &&
  sender.url === chrome.runtime.getURL('library.html');

function enqueue(operation, sendResponse) {
  const result = storageQueue.then(operation);
  storageQueue = result.catch(() => {});
  result
    .then(sendResponse)
    .catch(() => sendResponse({ error: STORAGE_MESSAGE, code: 'STORAGE_ERROR' }));
  return true;
}
```

- [ ] **Step 5: Проверить sender routing и восстановление очереди после ошибки**

Run: `node --test tests/storage.test.cjs --test-name-pattern="extension main frame|namespaces|queue"`

Expected: PASS; неверный sender не получает ответа и не читает storage.

- [ ] **Step 6: Написать failing epoch/tombstone get/save tests**

```js
test('legacy epoch zero saves, but a cleared epoch rejects lesson and preference patches', async () => {
  const legacy = worker();
  const loaded = await legacy.sendLesson({ action: 'get' });
  assert.equal(loaded.storageEpoch, 0);
  assert.equal((await legacy.sendLesson(save('Hello', 0, 'writer-a', undefined, 0))).saved, true);
  const app = worker({ storageEpoch: 1 });
  const stale = await app.sendLesson(save('Hello', 0, 'writer-a', { fontSize: 22 }, 0));
  assert.equal(stale.code, 'EPOCH_CONFLICT');
  assert.equal((await app.sendLesson({ action: 'get' })).preferences.fontSize, 18);
});

test('a fresh get can recreate a tombstoned lesson at the next revision', async () => {
  const app = worker({ 'lesson:video01': { deleted: true, revision: 8 }, storageEpoch: 2 });
  const loaded = await app.sendLesson({ action: 'get' });
  assert.equal(loaded.session, null);
  assert.equal(loaded.version, 8);
  assert.deepEqual(await app.sendLesson(save('Hello', 8, 'writer-new', undefined, 2)), {
    saved: true,
    version: 9,
    storageEpoch: 2,
  });
});
```

- [ ] **Step 7: Реализовать epoch-first get/save с одной записью**

```js
const readEpoch = (value) =>
  value === undefined ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : null;
const readRevision = (record) =>
  Number.isSafeInteger(record?.revision) && record.revision >= 0 ? record.revision : 0;
const isTombstone = (record) => record?.deleted === true;

async function handleLessonMessage(message) {
  const key = `lesson:${message.videoId}`;
  const snapshot = await chrome.storage.local.get([
    key,
    'preferences',
    'wordProfile',
    'storageEpoch',
  ]);
  const storageEpoch = readEpoch(snapshot.storageEpoch);
  if (storageEpoch === null) throw new Error('Invalid storage epoch');
  const record = snapshot[key];
  const version = readRevision(record);
  if (message.action === 'get')
    return {
      session: isTombstone(record) ? null : LingoExercise.restoreSession(record, message.videoId),
      preferences: LingoExercise.preferences(snapshot.preferences),
      wordProfile: LingoExercise.restoreWordProfile(snapshot.wordProfile),
      version,
      storageEpoch,
    };
  if ((message.storageEpoch ?? 0) !== storageEpoch)
    return { error: EPOCH_MESSAGE, code: 'EPOCH_CONFLICT', storageEpoch };
  // Validate session/writer/version, then calculate changes and call storage.local.set(changes) once.
}
```

`save()` test helper получает пятый аргумент `storageEpoch`; отсутствие поля разрешается только пока реальный epoch равен `0`.

- [ ] **Step 8: Повторно закрепить быстрые saves одного writer и все conflict paths**

```js
test('same writer may queue drafts, but another writer and malformed counters cannot bypass checks', async () => {
  const first = app.sendLesson(save('H', 0, 'writer-a', undefined, 0));
  const second = app.sendLesson(save('Hello', 0, 'writer-a', undefined, 0));
  assert.equal((await first).version, 1);
  assert.equal((await second).version, 2);
  assert.equal(
    (await app.sendLesson(save('', 0, 'writer-b', undefined, 0))).code,
    'REVISION_CONFLICT',
  );
  for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER])
    assert.equal(
      (await app.sendLesson(save('Hello', version, 'writer-x', undefined, 0))).code,
      'INVALID_MESSAGE',
    );
});
```

- [ ] **Step 9: Написать failing profile migration/transition tests**

```js
test('first read migrates valid legacy lessons once and save counts only a new completion', async () => {
  const app = worker({ 'lesson:old01': completedLesson('old01', 'friend', 10) });
  const first = await app.sendLesson({ action: 'get' });
  assert.equal(first.wordProfile.words.friend.attempts, 1);
  const afterMigration = app.snapshot().wordProfile;
  await app.sendLesson({ action: 'get' });
  assert.deepEqual(app.snapshot().wordProfile, afterMigration);
  const done = await app.sendLesson(
    saveSession(pendingToCorrect, first.version, 'writer-a', first.storageEpoch),
  );
  assert.equal(done.saved, true);
  assert.equal((await app.sendLesson({ action: 'get' })).wordProfile.words.hello.attempts, 1);
});

test('revision/epoch conflicts and set failure never mutate profile', async () => {
  const before = app.snapshot().wordProfile;
  assert.equal((await app.sendLesson(staleCompletion)).code, 'REVISION_CONFLICT');
  assert.deepEqual(app.snapshot().wordProfile, before);
});
```

- [ ] **Step 10: Реализовать one-time migration и atomic lesson+profile update**

```js
async function ensureWordProfile(snapshot) {
  const restored = LingoExercise.restoreWordProfile(snapshot.wordProfile, true);
  if (restored) return { profile: restored, migrated: false };
  const lessons = collectLessons(snapshot).sessions.sort(
    (a, b) => a.updatedAt - b.updatedAt || a.videoId.localeCompare(b.videoId),
  );
  return { profile: LingoExercise.buildWordProfile(lessons), migrated: true };
}

const previousSession = isTombstone(record)
  ? null
  : LingoExercise.restoreSession(record, message.videoId);
const nextProfile = LingoExercise.updateWordProfile(
  currentProfile,
  previousSession?.tasks ?? [],
  session.tasks,
  session.updatedAt,
);
const changes = {
  [key]: { ...session, revision: version + 1, writerId: message.writerId },
  wordProfile: nextProfile,
  ...(preferencePatch ? { preferences: mergedPreferences } : {}),
};
await chrome.storage.local.set(changes);
```

Если `wordProfile` отсутствует или повреждён, migration читает `get(null)`, пропускает неверные/tombstone-занятия и пишет восстановленный профиль один раз. Если `set` падает, lesson, preferences, revision, epoch и профиль остаются прежними.

- [ ] **Step 11: Запустить storage regression и обе зависимые pure suites**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs`

Expected: PASS, включая старые queued saves, preference merge, tombstone takeover, epoch conflict и однократную статистику.

- [ ] **Step 12: Format и commit**

Run: `npx --yes prettier@3.6.2 --check background.js tests/storage.test.cjs`

Expected: `All matched files use Prettier code style!`

```powershell
git add background.js tests/storage.test.cjs
git commit -m "feat: protect lesson storage and word progress"
```

### Task 4: Library storage API — list, vocabulary, delete, clear и backup

**Files:**

- Modify: `background.js:34-127`
- Modify: `tests/storage.test.cjs`

**Interfaces:**

- Consumes: Task 2 `LingoData` API; Task 3 storage helpers and `storageQueue`.
- Produces: trusted `LINGO_LIBRARY` actions `list`, `vocabulary`, `delete`, `clear`, `export`, `previewImport`, `import`; stable error codes `REVISION_CONFLICT`, `EPOCH_CONFLICT`, `INVALID_MESSAGE`, `INVALID_BACKUP`, `IMPORT_CHANGED`, `NOT_FOUND`, `STORAGE_ERROR`.

- [ ] **Step 1: Импортировать data module и написать failing list/vocabulary tests**

```js
test('list is sorted, compact and reports invalid local records without leaking them', async () => {
  const result = await app.sendLibrary({ action: 'list' });
  assert.deepEqual(
    result.lessons.map((item) => item.videoId),
    ['newer01', 'older01'],
  );
  assert.equal(result.invalidCount, 1);
  assert.equal(JSON.stringify(result).includes('tasks'), false);
  assert.equal(JSON.stringify(result).includes('secret answer'), false);
});

test('vocabulary keeps anonymous stats after lesson deletion but removes its context', async () => {
  const before = await app.sendLibrary({ action: 'vocabulary' });
  assert.equal(before.words[0].context.text, 'Hello friend');
  await app.sendLibrary({
    action: 'delete',
    videoId: 'video01',
    expectedRevision: 3,
    expectedEpoch: 0,
  });
  const after = await app.sendLibrary({ action: 'vocabulary' });
  assert.equal(after.words[0].attempts, before.words[0].attempts);
  assert.equal(after.words[0].context, null);
});
```

- [ ] **Step 2: Запустить tests и подтвердить неизвестный library action**

Run: `node --test tests/storage.test.cjs --test-name-pattern="list is sorted|vocabulary"`

Expected: FAIL, потому что `handleLibraryMessage` ещё не реализован.

- [ ] **Step 3: Реализовать snapshot collection и компактные ответы**

```js
function collectLessons(snapshot) {
  const sessions = [],
    recordsByVideoId = new Map();
  let invalidCount = 0;
  for (const [key, record] of Object.entries(snapshot)) {
    if (!key.startsWith('lesson:')) continue;
    const videoId = key.slice(7);
    recordsByVideoId.set(videoId, record);
    if (isTombstone(record)) continue;
    const session = LingoExercise.restoreSession(record, videoId);
    if (session) sessions.push(session);
    else invalidCount++;
  }
  return { sessions, recordsByVideoId, invalidCount };
}
function summarizeLesson(session, revision) {
  const counts = LingoExercise.resultCounts(session.tasks);
  return {
    videoId: session.videoId,
    title: session.title,
    sourceLabel: session.sourceLabel,
    updatedAt: session.updatedAt,
    position: session.position,
    completed: counts.total - counts.remaining,
    total: counts.total,
    revision,
  };
}
```

`list` сортирует `updatedAt DESC`, затем `videoId ASC`; `vocabulary` вызывает `LingoData.vocabulary(profile, sessions)` и возвращает только один разрешённый context на слово.

Exact successful shapes:

```js
// list
{ lessons, invalidCount, preferences: LingoExercise.preferences(snapshot.preferences), storageEpoch: epoch }
// vocabulary
{ words: LingoData.vocabulary(profile, sessions), invalidCount, storageEpoch: epoch }
```

- [ ] **Step 4: Написать failing delete/tombstone tests**

```js
test('delete requires current revision and epoch and stale tabs cannot resurrect the lesson', async () => {
  assert.equal(
    (
      await app.sendLibrary({
        action: 'delete',
        videoId: 'video01',
        expectedRevision: 1,
        expectedEpoch: 0,
      })
    ).code,
    'REVISION_CONFLICT',
  );
  const deleted = await app.sendLibrary({
    action: 'delete',
    videoId: 'video01',
    expectedRevision: 2,
    expectedEpoch: 0,
  });
  assert.deepEqual(deleted, { deleted: true, revision: 3, storageEpoch: 0 });
  assert.deepEqual(app.snapshot()['lesson:video01'], { deleted: true, revision: 3 });
  assert.equal(
    (await app.sendLesson(save('old', 2, 'stale', undefined, 0))).code,
    'REVISION_CONFLICT',
  );
});
```

- [ ] **Step 5: Реализовать delete с точной проверкой непосредственно перед set**

```js
if (message.action === 'delete') {
  if (
    !validVideoId(message.videoId) ||
    !validCounter(message.expectedRevision) ||
    !validCounter(message.expectedEpoch)
  )
    return invalidMessage();
  const snapshot = await chrome.storage.local.get([`lesson:${message.videoId}`, 'storageEpoch']);
  const epoch = readEpoch(snapshot.storageEpoch);
  if (message.expectedEpoch !== epoch) return epochConflict(epoch);
  const revision = readRevision(snapshot[`lesson:${message.videoId}`]);
  if (revision !== message.expectedRevision) return revisionConflict(revision);
  await chrome.storage.local.set({
    [`lesson:${message.videoId}`]: { deleted: true, revision: revision + 1 },
  });
  return { deleted: true, revision: revision + 1, storageEpoch: epoch };
}
```

- [ ] **Step 6: Написать failing clear atomicity tests**

```js
test('clear commits empty values with a new epoch before best-effort cleanup', async () => {
  const app = worker(seed, {
    beforeRemove: async () => {
      throw new Error('remove failed');
    },
  });
  const result = await app.sendLibrary({ action: 'clear', expectedEpoch: 0 });
  assert.deepEqual(result, { cleared: true, storageEpoch: 1, cleanupPending: true });
  assert.deepEqual((await app.sendLibrary({ action: 'list' })).lessons, []);
  assert.deepEqual((await app.sendLibrary({ action: 'vocabulary' })).words, []);
  assert.equal(JSON.stringify(app.snapshot()).includes('private caption'), false);
});

test('failed primary clear set preserves the old epoch and all user values', async () => {
  const before = app.snapshot();
  assert.equal(
    (await app.sendLibrary({ action: 'clear', expectedEpoch: 0 })).code,
    'STORAGE_ERROR',
  );
  assert.deepEqual(app.snapshot(), before);
});
```

- [ ] **Step 7: Реализовать логически атомарный clear**

```js
const nextEpoch = epoch + 1;
const cleared = {
  storageEpoch: nextEpoch,
  preferences: LingoExercise.preferences(),
  wordProfile: { schema: 1, words: {} },
};
for (const [key, record] of Object.entries(snapshot)) {
  if (key.startsWith('lesson:'))
    cleared[key] = { deleted: true, revision: readRevision(record) + 1 };
  else if (!['storageEpoch', 'preferences', 'wordProfile'].includes(key)) cleared[key] = null;
}
await chrome.storage.local.set(cleared); // The only required commit; failure leaves epoch unchanged.
let cleanupPending = false;
try {
  await chrome.storage.local.remove(Object.keys(snapshot).filter((key) => key !== 'storageEpoch'));
} catch {
  cleanupPending = true;
}
return {
  cleared: true,
  storageEpoch: nextEpoch,
  ...(cleanupPending ? { cleanupPending: true } : {}),
};
```

Проверить overflow до `+1`: `Number.MAX_SAFE_INTEGER` возвращает `INVALID_MESSAGE`, а не создаёт неточный revision/epoch.

- [ ] **Step 8: Написать failing export/preview tests**

```js
test('export includes only normalized public data and preview never writes', async () => {
  const exported = await app.sendLibrary({ action: 'export' });
  assert.equal(exported.backup.lessons.length, 2);
  assert.equal(
    JSON.stringify(exported.backup).match(/revision|writerId|storageEpoch|deleted/g),
    null,
  );
  const before = app.snapshot();
  const preview = await app.sendLibrary({
    action: 'previewImport',
    backup,
    importPreferences: false,
  });
  assert.deepEqual(preview.summary, { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 });
  assert.deepEqual(app.snapshot(), before);
});

test('future, duplicate and one-broken-session backup return INVALID_BACKUP without writes', async () => {
  for (const backup of [futureBackup, duplicateIds, brokenLastLesson]) {
    const before = app.snapshot();
    assert.equal(
      (await app.sendLibrary({ action: 'previewImport', backup, importPreferences: true })).code,
      'INVALID_BACKUP',
    );
    assert.deepEqual(app.snapshot(), before);
  }
});
```

- [ ] **Step 9: Реализовать export/preview с одной и той же strict validation**

```js
if (message.action === 'export') {
  const snapshot = await chrome.storage.local.get(null);
  const collected = collectLessons(snapshot);
  return {
    backup: LingoData.createBackup({
      lessons: collected.sessions,
      preferences: LingoExercise.preferences(snapshot.preferences),
      wordProfile: LingoExercise.restoreWordProfile(snapshot.wordProfile),
    }),
    invalidCount: collected.invalidCount,
    storageEpoch: readEpoch(snapshot.storageEpoch),
  };
}
const parsed = LingoData.parseBackup(message.backup);
if (!parsed.ok) return { error: parsed.message, code: 'INVALID_BACKUP' };
const plan = LingoData.planBackupImport(
  currentState(snapshot),
  parsed.backup,
  message.importPreferences === true,
);
return { summary: plan.summary, invalidLocalCount, storageEpoch: epoch };
```

- [ ] **Step 10: Написать failing concurrent/repeated import tests**

```js
test('import re-reads state, assigns new revisions and cannot be replayed as new history', async () => {
  const preview = await app.sendLibrary({
    action: 'previewImport',
    backup,
    importPreferences: true,
  });
  await app.sendLesson(saveNewerLocalBetweenPreviewAndImport);
  const applied = await app.sendLibrary({
    action: 'import',
    backup,
    importPreferences: true,
    expectedEpoch: preview.storageEpoch,
    expectedSummary: preview.summary,
  });
  assert.equal(applied.code, 'IMPORT_CHANGED');
  const nextPreview = await app.sendLibrary({
    action: 'previewImport',
    backup,
    importPreferences: true,
  });
  const success = await app.sendLibrary({
    action: 'import',
    backup,
    importPreferences: true,
    expectedEpoch: nextPreview.storageEpoch,
    expectedSummary: nextPreview.summary,
  });
  assert.equal(success.imported, true);
  assert.equal(
    (await app.sendLibrary({ action: 'previewImport', backup, importPreferences: true })).summary
      .updated,
    0,
  );
});
```

- [ ] **Step 11: Реализовать import revalidation и одну atomic set**

```js
const snapshot = await chrome.storage.local.get(null);
const epoch = readEpoch(snapshot.storageEpoch);
if (message.expectedEpoch !== epoch) return epochConflict(epoch);
const parsed = LingoData.parseBackup(message.backup);
if (!parsed.ok) return { error: parsed.message, code: 'INVALID_BACKUP' };
const plan = LingoData.planBackupImport(
  currentState(snapshot),
  parsed.backup,
  message.importPreferences === true,
);
if (!sameSummary(plan.summary, message.expectedSummary))
  return { error: 'Данные изменились. Повторите предпросмотр импорта.', code: 'IMPORT_CHANGED' };
const writerId = `import:${crypto.randomUUID()}`;
const changes = { wordProfile: plan.next.wordProfile };
for (const lesson of plan.changedLessons) {
  const record = snapshot[`lesson:${lesson.videoId}`];
  changes[`lesson:${lesson.videoId}`] = {
    ...lesson,
    revision: readRevision(record) + 1,
    writerId,
  };
}
if (message.importPreferences) changes.preferences = plan.next.preferences;
await chrome.storage.local.set(changes);
return { imported: true, summary: plan.summary, storageEpoch: epoch };
```

`planBackupImport` должен возвращать `changedLessons` вместе с `next`; импортированный `updatedAt` не заменяется текущим временем. Add поверх tombstone получает `tombstone.revision + 1`; ответ не содержит sessions/tasks.

- [ ] **Step 12: Проверить admin sender exactness**

```js
test('only exact extension library URL can perform admin actions', async () => {
  assert.equal((await app.sendLibrary({ action: 'list' })).lessons.length, 2);
  for (const sender of [
    libraryWithQuery,
    libraryWithHash,
    foreignLibrary,
    libraryIframe,
    webLookalike,
  ])
    assert.equal(await app.sendRaw({ type: 'LINGO_LIBRARY', action: 'list' }, sender), undefined);
});
```

- [ ] **Step 13: Запустить full storage suite и formatter**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs`

Expected: PASS, включая wait-after-save, delete/clear resurrection protection, retry after set/remove failure, preview/import race и equal timestamp local-win.

Run: `npx --yes prettier@3.6.2 --check background.js tests/storage.test.cjs`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 14: Commit**

```powershell
git add background.js tests/storage.test.cjs
git commit -m "feat: add lesson library storage operations"
```

### Task 5: Страница «Мои занятия»

**Files:**

- Create: `library.html`
- Create: `library.js`
- Create: `library.css`
- Create: `tests/library-smoke.cjs`
- Modify: `manifest.json:1-22`
- Modify: `i18n.js:1-160`
- Modify: `tests/i18n.test.cjs:32-93`

**Interfaces:**

- Consumes: Task 4 `LINGO_LIBRARY` API, `LingoData.createVocabularyCsv`, `LingoI18n.resolve/text`, `chrome.runtime.openOptionsPage`/`chrome.tabs.create`.
- Produces: semantic options page with `requestLibrary(action, payload)`, `refreshLibrary()`, `renderLessons()`, `renderVocabulary()`, `downloadBlob()`, `openLesson()`, accessible confirmations/help/import preview.

- [ ] **Step 1: Написать manifest/static failing assertions**

```js
test('manifest exposes a tabbed options page without adding permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.options_ui, { page: 'library.html', open_in_tab: true });
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  for (const file of ['library.html', 'library.js', 'library.css'])
    assert.ok(fs.existsSync(path.join(root, file)), file);
});
```

Add this assertion to `tests/data.test.cjs`, where `root` and `fs` are already available.

- [ ] **Step 2: Запустить assertion и подтвердить отсутствие options page**

Run: `node --test tests/data.test.cjs --test-name-pattern="options page"`

Expected: FAIL because `manifest.options_ui` and `library.html` are absent.

- [ ] **Step 3: Создать semantic HTML shell и manifest entry**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Мои занятия · Lingo Practice</title>
    <link rel="stylesheet" href="library.css" />
    <script src="i18n.js" defer></script>
    <script src="exercise.js" defer></script>
    <script src="data.js" defer></script>
    <script src="library.js" defer></script>
  </head>
  <body>
    <header>
      <p class="eyebrow">LINGO PRACTICE</p>
      <h1 data-i18n="Мои занятия">Мои занятия</h1>
    </header>
    <nav aria-label="Разделы">
      <a href="#lessons">Занятия</a><a href="#words">Трудные слова</a
      ><a href="#data-help">Данные и помощь</a>
    </nav>
    <main>
      <section id="lessons" aria-labelledby="lessons-title">
        <h2 id="lessons-title">Занятия</h2>
        <div id="lesson-list"></div>
      </section>
      <section id="words" aria-labelledby="words-title">
        <h2 id="words-title">Трудные слова</h2>
        <div id="word-list"></div>
      </section>
      <section id="data-help" aria-labelledby="data-title">
        <h2 id="data-title">Данные и помощь</h2>
      </section>
    </main>
    <div id="announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  </body>
</html>
```

In `manifest.json`:

```json
"options_ui": { "page": "library.html", "open_in_tab": true }
```

- [ ] **Step 4: Создать Playwright extension harness и failing list test**

```js
const extensionId = new URL(worker.url()).host;
await worker.evaluate((seed) => chrome.storage.local.set(seed), librarySeed);
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/library.html`);
await page.getByRole('heading', { name: 'Занятия' }).waitFor();
assert.deepEqual(
  await page
    .locator('[data-lesson-id]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.lessonId)),
  ['newer01', 'older01'],
);
assert.match(await page.locator('[data-lesson-id="newer01"]').innerText(), /2 \/ 3/);
```

`tests/library-smoke.cjs` copies every runtime file named in its own explicit list, starts Chromium with the unpacked temporary extension and seeds only valid public fixtures plus internal revisions.

- [ ] **Step 5: Реализовать request/render state без прямого storage access**

```js
const state = { lessons: [], words: [], preferences: null, storageEpoch: 0, invalidCount: 0 };
async function requestLibrary(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type: 'LINGO_LIBRARY', action, ...payload });
  if (!result) throw new Error('Расширение не ответило.');
  if (result.error) throw Object.assign(new Error(result.error), { code: result.code });
  return result;
}
async function refreshLibrary() {
  const [listed, vocabulary] = await Promise.all([
    requestLibrary('list'),
    requestLibrary('vocabulary'),
  ]);
  Object.assign(state, listed, { words: vocabulary.words });
  applyLanguage(listed.preferences.language);
  renderLessons(state.lessons);
  renderVocabulary(filteredWords());
}
```

If `invalidCount > 0`, render a localized warning banner with only the count; never stringify or expose the damaged record. Keep empty states for lessons and vocabulary distinct from load errors.

Add a static assertion:

```js
assert.doesNotMatch(fs.readFileSync(path.join(root, 'library.js'), 'utf8'), /chrome\.storage/);
```

- [ ] **Step 6: Реализовать карточки, поиск, сортировку и Continue**

```js
function openLesson(videoId, position) {
  if (!/^[\w-]{1,64}$/.test(videoId)) throw new Error(t('Некорректный идентификатор видео.'));
  const seconds = Math.max(0, Math.floor(Number(position) || 0));
  return chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` });
}
function filteredWords() {
  const query = normalizeSearch(search.value);
  const result = state.words.filter((entry) =>
    normalizeSearch(`${entry.word} ${entry.context?.text ?? ''}`).includes(query),
  );
  return result.sort(
    wordSort.value === 'recent'
      ? (a, b) => b.lastSeenAt - a.lastSeenAt || a.word.localeCompare(b.word)
      : (a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt || a.word.localeCompare(b.word),
  );
}
```

Lesson cards show title, translated source, date, position and `completed / total`. Continue uses only the validated ID and clamped seconds; it never stores or echoes an arbitrary URL.

- [ ] **Step 7: Добавить accessible delete/clear confirmations и conflict refresh**

```js
async function deleteLesson(lesson, trigger) {
  if (
    !(await confirmDialog({
      title: t('Удалить занятие?'),
      message: lesson.title,
      confirmText: t('Удалить'),
      returnFocus: trigger,
    }))
  )
    return;
  try {
    await requestLibrary('delete', {
      videoId: lesson.videoId,
      expectedRevision: lesson.revision,
      expectedEpoch: state.storageEpoch,
    });
    announce('Занятие удалено.');
  } catch (error) {
    if (['REVISION_CONFLICT', 'EPOCH_CONFLICT'].includes(error.code)) announce(error.message);
    else throw error;
  } finally {
    await refreshLibrary();
  }
}
```

Clear uses its own heading and exact message that lessons, answers, settings and word statistics will be deleted. It sends `{expectedEpoch}` and refreshes after success/conflict. Every dialog has an `h2`, `aria-labelledby`, Escape/cancel, native modal focus containment and explicit return to the trigger.

- [ ] **Step 8: Написать failing export/import/CSV browser flow**

```js
const download = page.waitForEvent('download');
await page.getByRole('button', { name: 'Экспортировать резервную копию' }).click();
await page.getByRole('button', { name: 'Скачать JSON' }).click();
const backupPath = await (await download).path();
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
assert.equal(backup.format, 'lingo-practice-backup');
assert.equal(JSON.stringify(backup).includes('writerId'), false);

await page.getByLabel('Файл резервной копии').setInputFiles({
  name: 'backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(backup)),
});
assert.match(await page.getByRole('dialog').innerText(), /Добавлено: 0.*Обновлено: 0/s);
```

- [ ] **Step 9: Реализовать explicit export disclosure, bounded import preview и downloads**

```js
function downloadBlob(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function readBackupFile(file) {
  if (!file || file.size > LingoData.limits.backupBytes)
    throw new Error(t('Резервная копия слишком большая: максимум 10 МБ.'));
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error(t('Не удалось прочитать JSON резервной копии.'));
  }
  return backup;
}
```

Export dialog states that plaintext captions, correct answers and entered answers are included; only its Download button calls `export`. If the export response has `invalidCount > 0`, show the localized skipped-record count before downloading without exposing content. Import sends `previewImport`, renders add/update/skip counts and a settings checkbox, then sends the same backup plus `expectedEpoch` and `expectedSummary`. A changed preview shows the server message and reruns preview rather than silently applying a different plan. CSV uses `LingoData.createVocabularyCsv(state.words)` with MIME `text/csv;charset=utf-8`.

Use deterministic local filenames:

```js
downloadBlob(
  `lingo-practice-backup-${new Date().toISOString().slice(0, 10)}.json`,
  'application/json;charset=utf-8',
  JSON.stringify(result.backup, null, 2),
);
downloadBlob(
  'lingo-practice-difficult-words.csv',
  'text/csv;charset=utf-8',
  LingoData.createVocabularyCsv(state.words),
);
```

- [ ] **Step 10: Добавить manual help, RU/EN keys и accessibility assertions**

```js
test('library strings and templates exist in both languages', () => {
  for (const key of [
    'Мои занятия',
    'Занятия',
    'Трудные слова',
    'Данные и помощь',
    'Удалить занятие?',
    'Экспортировать резервную копию',
    'Импортировать настройки',
    'Как заниматься',
  ]) {
    assert.doesNotMatch(i18n.text(key, {}, 'en'), /[А-Яа-яЁё]/u, key);
    assert.ok(i18n.text(key, {}, 'ru').trim(), key);
  }
});
```

Manual help repeats the three approved onboarding steps and does not change `onboardingSeen`. Set `document.documentElement.lang` and `<title>` whenever language changes.

- [ ] **Step 11: Реализовать responsive/focus styling и browser assertions**

```css
:focus-visible {
  outline: 3px solid #2f6fed;
  outline-offset: 3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
  gap: 1rem;
}
dialog {
  max-width: min(34rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
}
@media (max-width: 380px) {
  body {
    padding: 0.75rem;
  }
  .card-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

At `320×800`, assert `document.documentElement.scrollWidth <= 320`; emulate `deviceScaleFactor`/CSS zoom scenario equivalent to 200% and verify actions remain reachable. Check accessible names and focus return for delete, clear, export, import and help.

- [ ] **Step 12: Запустить library/i18n/unit suites**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs tests/i18n.test.cjs`

Expected: PASS.

Run: `node tests/library-smoke.cjs`

Expected: `PASS: lesson library, vocabulary, backup, deletion, help, languages and reflow`.

Run: `npx --yes prettier@3.6.2 --check library.html library.js library.css manifest.json i18n.js tests/library-smoke.cjs tests/i18n.test.cjs`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 13: Commit**

```powershell
git add library.html library.js library.css manifest.json i18n.js tests/library-smoke.cjs tests/i18n.test.cjs tests/data.test.cjs
git commit -m "feat: add local lesson library"
```

### Task 6: Интеграция adaptive/frequency и безопасная смена источника

**Files:**

- Modify: `content.js:14-42,97-290,314-625`
- Modify: `styles.css:1-626`
- Modify: `i18n.js`
- Modify: `tests/browser-smoke.cjs:1-732`

**Interfaces:**

- Consumes: Task 1 `createTasks`, `hasUserWork`, extended preferences/session; Task 3 lesson `wordProfile/storageEpoch`; Task 5 options page.
- Produces: `saveNow(): Promise`, `setSourceBusy(value)`, `confirmSourceChange(returnFocus): Promise<boolean>`, async `commit(cues,label,selection,rounded,returnFocus): Promise<boolean>`, settings controls for adaptive/frequency and button `openLibrary()`.

- [ ] **Step 1: Обновить temporary extension fixture и написать failing learning controls test**

```js
for (const name of [
  'manifest.json',
  'background.js',
  'youtube.js',
  'exercise.js',
  'data.js',
  'content.js',
  'styles.css',
  'i18n.js',
  'library.html',
  'library.js',
  'library.css',
])
  copyRuntime(name);

if (process.argv.includes('--learning')) {
  await activate();
  await page.getByRole('button', { name: 'Настройки' }).click();
  assert.deepEqual(await page.getByLabel('Сложность').locator('option').allTextContents(), [
    'Лёгкая',
    'Обычная',
    'Сложная',
    'Адаптивная',
  ]);
  assert.deepEqual(await page.getByLabel('Частота пропусков').locator('option').allTextContents(), [
    'Часто',
    'Обычно',
    'Редко',
  ]);
}
```

- [ ] **Step 2: Запустить scenario и подтвердить отсутствие controls/data.js**

Run: `node tests/browser-smoke.cjs --learning`

Expected: FAIL on missing `data.js` in the copied runtime or absent Adaptive/Frequency controls.

- [ ] **Step 3: Принять profile/epoch при boot и передавать их в каждое save**

```js
let wordProfile = { schema: 1, words: {} },
  storageEpoch = 0;
async function boot() {
  const saved = await storage('get');
  storageVersion = saved.version ?? 0;
  storageEpoch = saved.storageEpoch ?? 0;
  wordProfile = exercise.restoreWordProfile(saved.wordProfile);
  prefs = exercise.preferences(saved.preferences);
  // Restore exact session tasks and its gapFrequency; otherwise load auto.
}
function saveNow() {
  // Existing guards return Promise.resolve() instead of undefined.
  return storage('save', {
    session: session ? { ...session, gapFrequency: prefs.gapFrequency } : null,
    preferences: preferenceChanges,
    version: storageVersion,
    writerId,
    storageEpoch,
  }).then((result) => {
    storageVersion = result.version;
    storageEpoch = result.storageEpoch;
  });
}
```

When restoring a session, copy both `session.difficulty` and `session.gapFrequency` into `prefs` before `applyPreferences()`. Make `storage()` attach `result.code` to the thrown error. On `EPOCH_CONFLICT`, stop further saves and announce that the user must close and reopen practice. Never silently adopt the new epoch over an in-memory old lesson.

- [ ] **Step 4: Добавить adaptive/frequency controls and rebuild only untouched tasks**

```js
const difficulty = choice('Сложность', [
  ['easy', 'Лёгкая'],
  ['balanced', 'Обычная'],
  ['hard', 'Сложная'],
  ['adaptive', 'Адаптивная'],
]);
const gapFrequency = choice('Частота пропусков', [
  ['dense', 'Часто'],
  ['normal', 'Обычно'],
  ['sparse', 'Редко'],
]);
function rebuildUntouchedTasks() {
  tasks = exercise.createTasks(tasks, {
    random: Math.random,
    difficulty: prefs.difficulty,
    gapFrequency: prefs.gapFrequency,
    wordProfile,
    previousTasks: tasks,
  });
  if (ready) draw();
}
```

Both change handlers normalize through `exercise.preferences`, write only their changed preference key, call `rebuildUntouchedTasks()`, then `saveNow()`. `commit()` uses `createTasks(cues,{difficulty,gapFrequency,wordProfile})`; restored sessions never rebuild automatically.

When `settle()` creates a new finished transition, update the in-memory selection profile from a snapshot of that single task before/after:

```js
const previousTask = { ...tasks[index] };
// Apply the existing answer/status mutation.
wordProfile = exercise.updateWordProfile(wordProfile, [previousTask], [tasks[index]], Date.now());
```

This local copy only influences later gap selection in the open page. `background.js` independently applies the same transition to authoritative storage after revision/epoch checks, so a rejected save never persists the optimistic copy.

- [ ] **Step 5: Добавить кнопку библиотеки с save barrier**

```js
async function openLibrary() {
  await saveNow();
  settingsDialog.close();
  await chrome.runtime.openOptionsPage();
}
settingsDialog.append(button('Мои занятия', 'secondary', openLibrary));
```

Add a browser assertion that a typed draft is present in `LINGO_LIBRARY/list` when the options page opens.

- [ ] **Step 6: Написать failing source-change cases before implementation**

```js
await answers.first().fill('draft');
await importInput.setInputFiles(validVtt);
const dialog = page.getByRole('dialog', { name: 'Сменить источник субтитров?' });
await dialog.getByRole('button', { name: 'Отмена' }).click();
assert.equal(await answers.first().inputValue(), 'draft');
assert.equal(await page.getByLabel('Источник субтитров').inputValue(), 'auto');

await importInput.setInputFiles(brokenVtt);
assert.equal(await dialog.count(), 0);
assert.equal(await answers.first().inputValue(), 'draft');
```

Repeat the valid-candidate cancel assertion for mistake, hint, skipped and correct work; whitespace-only input is also work. Escape equals Cancel and focus returns to the select/import button.

- [ ] **Step 7: Создать один доступный confirmation dialog и busy helper**

```js
function setSourceBusy(value) {
  busy = value;
  select.disabled = value || Boolean(review);
  importButton.disabled = value || Boolean(review);
}
function confirmSourceChange(returnFocus) {
  return new Promise((resolve) => {
    sourceDialog.returnValue = 'cancel';
    sourceDialog.addEventListener(
      'close',
      () => {
        returnFocus?.focus();
        resolve(sourceDialog.returnValue === 'confirm');
      },
      { once: true, signal },
    );
    sourceDialog.showModal();
  });
}
```

The dialog has `<h2 id="source-change-title">`, `aria-labelledby`, the exact approved warning and buttons Cancel/Change subtitles. Teardown closes it as Cancel so no promise remains pending.

- [ ] **Step 8: Сделать commit async и mutate only after approval**

```js
async function commit(cues, label, selection, rounded = false, returnFocus = select) {
  const nextTasks = exercise.createTasks(cues, {
    random: Math.random,
    difficulty: prefs.difficulty,
    gapFrequency: prefs.gapFrequency,
    wordProfile,
  });
  if (!nextTasks.some((task) => task.answer))
    throw new Error('В субтитрах не найдено слов для пропусков.');
  if (
    ready &&
    exercise.hasUserWork(review?.base ?? tasks) &&
    !(await confirmSourceChange(returnFocus))
  ) {
    select.value = sourceSelection;
    setNotice('source');
    return false;
  }
  if (review) leaveReview();
  tasks = nextTasks;
  sourceLabel = label;
  sourceSelection = selection;
  approximate = rounded;
  offset = 0;
  ready = true;
  draw();
  setNotice('source');
  saveNow();
  return true;
}
```

`load()` and `importFile()` `await commit(...)`. A failed fetch/parse never reaches it; Cancel is a normal `false` result, not an error. Existing `--upgrade` successful-import steps explicitly click Change subtitles after this task.

- [ ] **Step 9: Закрепить initiated-task preservation in browser**

```js
const before = await rows.evaluateAll((nodes) => nodes.map((n) => n.textContent));
await page.getByLabel('Частота пропусков').selectOption('sparse');
await page.getByLabel('Сложность').selectOption('adaptive');
const after = await rows.evaluateAll((nodes) => nodes.map((n) => n.textContent));
assert.equal(after[startedIndex], before[startedIndex]);
assert.ok((await answers.count()) < denseAnswerCount);
```

- [ ] **Step 10: Добавить RU/EN translations and dialog/reflow styling**

```css
dialog.modal {
  width: min(34rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
}
.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
}
@media (max-width: 380px) {
  .dialog-actions > button {
    flex: 1 1 100%;
  }
}
```

Extend named-parameter parity tests for conflict messages and source-change copy. Preserve `:focus-visible` and the existing reduced-motion block.

- [ ] **Step 11: Запустить focused + regression suites**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs tests/i18n.test.cjs`

Expected: PASS.

Run: `node tests/browser-smoke.cjs --learning`

Expected: `PASS: adaptive learning, gap frequency, source protection and library handoff`.

Run: `node tests/browser-smoke.cjs --upgrade`

Expected: existing import/settings/hints/review scenario passes with explicit source confirmation.

- [ ] **Step 12: Format and commit**

Run: `npx --yes prettier@3.6.2 --check content.js styles.css i18n.js tests/browser-smoke.cjs`

Expected: `All matched files use Prettier code style!`

```powershell
git add content.js styles.css i18n.js tests/browser-smoke.cjs
git commit -m "feat: connect adaptive lessons and protect answers"
```

### Task 7: Автопродолжение, onboarding и доступность урока

**Files:**

- Modify: `content.js:14-44,88-173,627-1094`
- Modify: `styles.css`
- Modify: `i18n.js`
- Modify: `tests/browser-smoke.cjs`
- Modify: `tests/keyboard-smoke.cjs:81-130`

**Interfaces:**

- Consumes: Task 6 state/save/dialog conventions.
- Produces: `pauseGate`, `clearPauseGate()`, `resumeAfterAnswer()`, `showOnboarding()`, `maybeShowOnboarding()`, `markOnboardingSeen()`, `announce()` and accessible answer context.

- [ ] **Step 1: Написать failing auto-resume matrix**

```js
testCases = [
  ['clean correct', answerCorrect, true],
  ['assisted correct', answerAfterOneHint, true],
  ['wrong', answerWrong, false],
  ['skip', clickSkip, false],
  ['reveal', clickThirdHint, false],
];
for (const [name, act, shouldPlay] of testCases) {
  await forceExtensionAnswerPause();
  await act();
  assert.equal(await page.locator('video').evaluate((video) => !video.paused), shouldPlay, name);
}
```

Additional assertions: manual pause, seek/play before answer, ad state, ended video and review queue never trigger ordinary resume.

- [ ] **Step 2: Запустить learning scenario и увидеть отсутствие resume**

Run: `node tests/browser-smoke.cjs --learning`

Expected: FAIL at `clean correct` because current `pausedAt` does not encode the pause owner or call `video.play()`.

- [ ] **Step 3: Заменить `pausedAt` на явную причину паузы**

```js
let pauseGate = null;
const clearPauseGate = (reason = null) => {
  if (!reason || pauseGate?.reason === reason) pauseGate = null;
};
async function resumeAfterAnswer(index) {
  if (
    pauseGate?.reason !== 'answer' ||
    pauseGate.index !== index ||
    !prefs.autoPause ||
    isAd() ||
    video.ended
  )
    return;
  pauseGate = null;
  try {
    await video.play();
  } catch {
    setNotice('error', 'Не удалось продолжить воспроизведение. Нажмите кнопку «Продолжить».');
  }
}
```

`tick()` sets `{reason:'answer',index:current}` immediately before its own `video.pause()` and `{reason:'review',index:review.index}` in review. `settle()` calls `resumeAfterAnswer(index)` only for final `correct` or `assisted`; `skipped`, `revealed` and wrong attempts do not.

- [ ] **Step 4: Очистить gate на каждом external transition**

```js
on('seeked', () => {
  clearPauseGate();
  previousTime = captionTime();
  tick();
  saveNow();
});
on('play', () => {
  clearPauseGate();
  setText(play, 'Пауза');
});
on('ended', () => {
  clearPauseGate();
  updateStats();
  saveNow();
});
// Also call clearPauseGate() in repeatCue, commit, player replacement, video change,
// autoPause false change, ad transition and close.
```

The pause event caused by the extension does not clear a freshly created answer gate; a subsequent Play event does. Review keeps `advanceReview()` behavior.

- [ ] **Step 5: Написать failing first-run/help tests**

```js
await worker.evaluate(() => chrome.storage.local.clear());
await activate();
const onboarding = page.getByRole('dialog', { name: 'Как заниматься' });
await onboarding.waitFor();
await onboarding.press('Escape');
assert.equal((await readPreferences()).onboardingSeen, true);
await closeAndActivateAgain();
assert.equal(await onboarding.count(), 0);
await page.getByRole('button', { name: 'Как заниматься' }).click();
await onboarding.waitFor();
```

- [ ] **Step 6: Реализовать onboarding only after a real lesson draw**

```js
function markOnboardingSeen() {
  if (prefs.onboardingSeen) return;
  prefs.onboardingSeen = true;
  preferenceChanges.onboardingSeen = true;
  saveNow();
}
function showOnboarding(returnFocus = null) {
  helpDialog.returnValue = 'closed';
  helpDialog.addEventListener(
    'close',
    () => {
      markOnboardingSeen();
      (returnFocus ?? firstUnfinishedInput() ?? select).focus();
    },
    { once: true, signal },
  );
  helpDialog.showModal();
}
function maybeShowOnboarding() {
  if (ready && !prefs.onboardingSeen && !helpDialog.open) showOnboarding();
}
```

Call `maybeShowOnboarding()` after the first successful `draw()` for both restored and newly loaded lessons. Closing the whole mode marks an open onboarding as seen before the final save. The dialog contains exactly the three approved steps; header gets a permanent Help button.

- [ ] **Step 7: Написать failing semantics/live-region assertions**

```js
assert.equal(await page.locator('.save-status').getAttribute('aria-live'), null);
assert.equal(await page.locator('.notice').getAttribute('aria-live'), null);
for (const dialog of await page.getByRole('dialog').all())
  assert.ok(await dialog.getAttribute('aria-labelledby'));
const label = await answers.first().getAttribute('aria-label');
assert.match(label, /пропуск/i);
assert.doesNotMatch(label, new RegExp(expectedAnswer, 'i'));
await page.setViewportSize({ width: 320, height: 800 });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 320), true);
```

- [ ] **Step 8: Добавить один deduplicated announcer и реальный ad status**

```js
const announcer = el('div', 'sr-only');
announcer.setAttribute('aria-live', 'polite');
announcer.setAttribute('aria-atomic', 'true');
let lastAnnouncement = '';
function announce(key, parameters = {}) {
  const message = t(key, parameters);
  if (message === lastAnnouncement) return;
  lastAnnouncement = message;
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}
const adStatus = el('div', 'ad-status');
adStatus.hidden = true;
```

Remove `role=status` from both `saveStatus` and the frequently changing visible `notice`; ordinary Loading/Source/Saving/Saved text remains visual. Storage conflict/error uses `announce`. On ad state transition, set real `adStatus.hidden/textContent` and announce once; remove CSS pseudo-element content. `reviewLabel` is polite/atomic.

- [ ] **Step 9: Назвать поля и диалоги без раскрытия ответа**

```js
const context = `${task.before.slice(-80)} ${t('пропуск')} ${task.after.slice(0, 80)}`
  .replace(/\s+/g, ' ')
  .trim();
setAttr(input, 'aria-label', 'Пропущенное слово, строка {number}. Контекст: {context}', {
  number: index + 1,
  context,
});
```

Each dialog has a real unique `h2` and `aria-labelledby`; all timestamp buttons use `Повторить с {time}`. Native `<dialog>` supplies modal focus containment, Escape handling and focus restoration is explicitly tested.

- [ ] **Step 10: Обновить CSS reflow/focus/reduced motion**

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid #a6edbd;
  outline-offset: 3px;
}
@media (max-width: 380px) {
  .brand > :not(.brand-mark) {
    display: none;
  }
  .header {
    gap: 0.5rem;
  }
  .controls {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 11: Обновить keyboard fixture and checks**

```js
preferences: { onboardingSeen: true },

// Temporary extension copy filter:
(name) => /\.(js|css|html)$/.test(name) || ['manifest.json', '_locales', 'icons'].includes(name),
```

Add keyboard assertions for Escape/return focus in help/source/settings dialogs and retain every existing NumPad/NumLock assertion.

- [ ] **Step 12: Запустить UX, default, keyboard and i18n checks**

Run: `node tests/browser-smoke.cjs --learning`

Expected: PASS for the full auto-resume matrix and onboarding.

Run: `node tests/browser-smoke.cjs`

Expected: existing basic lesson, seek, ad, navigation and failure regression passes.

Run: `node tests/browser-smoke.cjs --i18n`

Expected: all new controls/dialogs switch RU/EN without mixed-language strings.

Run: `node tests/keyboard-smoke.cjs`

Expected: `PASS: keyboard and NumPad regression checks`.

- [ ] **Step 13: Format and commit**

Run: `npx --yes prettier@3.6.2 --check content.js styles.css i18n.js tests/browser-smoke.cjs tests/keyboard-smoke.cjs`

Expected: `All matched files use Prettier code style!`

```powershell
git add content.js styles.css i18n.js tests/browser-smoke.cjs tests/keyboard-smoke.cjs
git commit -m "feat: resume answer pauses and improve accessibility"
```

### Task 8: Структурированная диагностика и устойчивый YouTube cascade

**Files:**

- Modify: `youtube.js:1-185`
- Create: `tests/youtube.test.cjs`
- Modify: `background.js:103-127`
- Modify: `content.js:31-42,146-151,334-414,584-625`
- Modify: `styles.css`
- Modify: `i18n.js`
- Modify: `tests/browser-smoke.cjs:152-187,677-724`

**Interfaces:**

- Consumes: existing `LINGO_YOUTUBE` MAIN-world execution, Task 7 `announce()`/modal conventions.
- Produces: `{error:{code,messageKey,stage,retryable}, diagnostic}` failure contract, bounded transcript traversal, `buildDiagnosticReport(failure)`, `copyDiagnostics()`, manual readonly fallback.

- [ ] **Step 1: Создать VM fixture и failing error-classification tests**

```js
const source = fs.readFileSync(path.join(__dirname, '../youtube.js'), 'utf8');
async function run(options = {}) {
  const context = vm.createContext(makePageContext(options));
  vm.runInContext(source, context);
  return context.lingoYouTube(options.action ?? 'load', {
    videoId: 'safe01',
    trackIndex: options.trackIndex,
  });
}

test('timedtext outcomes distinguish HTTP, empty, invalid JSON and timeout', async () => {
  assert.equal(
    (await run({ fetch: response(503, 'blocked') })).diagnostic.timedText.outcome,
    'http-error',
  );
  assert.equal((await run({ fetch: response(200, '') })).diagnostic.timedText.outcome, 'empty');
  assert.equal(
    (await run({ fetch: response(200, '{') })).diagnostic.timedText.outcome,
    'invalid-json',
  );
  assert.equal(
    (await run({ fetchError: namedError('TimeoutError') })).diagnostic.timedText.outcome,
    'timeout',
  );
});
```

`makePageContext` supplies only the DOM/player/fetch surface used by `lingoYouTube`; it includes cyclic panel data for the traversal-limit case.

- [ ] **Step 2: Запустить YouTube tests и подтвердить строковый старый контракт**

Run: `node --test tests/youtube.test.cjs`

Expected: FAIL because existing failures are strings and timedtext exceptions are swallowed.

- [ ] **Step 3: Ввести selectors, diagnostic skeleton и stable failures**

```js
const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer';
const ROW_SELECTOR = 'ytd-transcript-segment-renderer';
const MODEL_SELECTOR = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
const OPENER_SELECTOR = 'ytd-video-description-transcript-section-renderer button';
const CLOSE_SELECTOR = '#visibility-button button';
const diagnostic = {
  schema: 1,
  requestedSource:
    action === 'transcript'
      ? 'transcript'
      : Number.isInteger(options.trackIndex)
        ? 'track'
        : 'auto',
  page: {
    watchPage: location.pathname === '/watch',
    playerFound: false,
    videoFound: false,
    responseFound: false,
    videoMatches: currentId() === options.videoId,
  },
  tracks: { count: 0, selectedLanguage: null, selectedAutomatic: null },
  timedText: { outcome: 'not-attempted', httpStatus: null },
  transcript: { model: 'none', openerFound: false, attempts: 0, cueCount: 0 },
};
const failure = (code, messageKey, stage, retryable) => ({
  error: { code, messageKey, stage, retryable },
  diagnostic,
});
```

Minimum stable codes: `VIDEO_CHANGED`, `PLAYER_NOT_READY`, `PLAYER_RESPONSE_STALE`, `TRACK_FETCH_FAILED`, `TRANSCRIPT_ENTRY_MISSING`, `TRANSCRIPT_TIMEOUT`, `TRANSCRIPT_UNKNOWN_MODEL`, `LOAD_CANCELLED`, `CAPTION_READ_FAILED`, `MAIN_WORLD_NO_RESULT`, `PAGE_CONTEXT_CHANGED`.

- [ ] **Step 4: Classify timedtext without leaking the URL or exception**

```js
try {
  const response = await fetch(url.href, {
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
  });
  diagnostic.timedText.httpStatus = response.status;
  const text = await response.text();
  if (!response.ok) diagnostic.timedText.outcome = 'http-error';
  else if (!text.trim()) diagnostic.timedText.outcome = 'empty';
  else {
    try {
      const json = JSON.parse(text);
      if (hasSpeech(json)) {
        diagnostic.timedText.outcome = 'success';
        return success(json);
      }
      diagnostic.timedText.outcome = 'empty';
    } catch {
      diagnostic.timedText.outcome = 'invalid-json';
    }
  }
} catch (error) {
  diagnostic.timedText.outcome = error?.name === 'TimeoutError' ? 'timeout' : 'network-error';
}
```

Unsupported scheme/host/path sets `unsupported-url`; do not place `url`, query parameters, raw text or raw exception in either object.

- [ ] **Step 5: Bound transcript model traversal and report its observed variant**

```js
const MAX_VISITED = 50_000,
  MAX_CUES = 5_000;
let visited = 0,
  model = 'none';
const walk = (value, seen = new WeakSet()) => {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value) ||
    visited++ >= MAX_VISITED ||
    raw.length >= MAX_CUES
  )
    return;
  seen.add(value);
  if (value.transcriptSegmentRenderer) {
    model = model === 'view-model' ? 'mixed' : 'renderer';
    pushRenderer(value);
    return;
  }
  if (value.transcriptSegmentViewModel) {
    model = model === 'renderer' ? 'mixed' : 'view-model';
    pushViewModel(value);
    return;
  }
  for (const child of Object.values(value)) walk(child, seen);
};
```

Set `diagnostic.transcript.model`, `openerFound`, bounded `attempts` and final `cueCount`. Preserve cascade: timedtext → already open model → DOM rows → click structural opener → wait at most 24×250ms. Search by localized button text is forbidden.

- [ ] **Step 6: Cover renderer/view-model/unknown/cycle/video-change cases**

```js
test('transcript walk is bounded and classifies known and unknown models', async () => {
  assert.equal((await run({ panel: legacyRenderer })).diagnostic.transcript.model, 'renderer');
  assert.equal((await run({ panel: modernViewModel })).diagnostic.transcript.model, 'view-model');
  const unknown = await run({ panel: cyclicUnknownModel, opener: true });
  assert.equal(unknown.error.code, 'TRANSCRIPT_UNKNOWN_MODEL');
  assert.ok(unknown.diagnostic.transcript.attempts <= 24);
});
test('video change during wait returns LOAD_CANCELLED without stale cues', async () => {
  const result = await run({ changeVideoAtAttempt: 2 });
  assert.equal(result.error.code, 'LOAD_CANCELLED');
  assert.equal('cues' in result, false);
});
```

- [ ] **Step 7: Preserve structured failures through background executeScript**

```js
const mainFailure = (code, messageKey) => ({
  error: { code, messageKey, stage: 'main-world', retryable: true },
  diagnostic: emptyDiagnostic(message.action),
});
// results[0]?.result ?? mainFailure('MAIN_WORLD_NO_RESULT', 'Проигрыватель не ответил. Повторите загрузку.')
// catch -> mainFailure('PAGE_CONTEXT_CHANGED', 'Страница изменилась. Закройте режим и включите его снова.')
```

Do not stringify the object in `background.js`; `content.js` needs `code`, `stage`, `retryable` and the whitelist fields.

- [ ] **Step 8: Написать failing copy/privacy browser test**

```js
await triggerCaptionFailureWithSentinels({
  pageUrl: 'SECRET_URL',
  videoId: 'SECRET_VIDEO',
  title: 'SECRET_TITLE',
  caption: 'SECRET_CAPTION',
  answer: 'SECRET_ANSWER',
  captionUrl: 'SECRET_QUERY',
});
await page.getByRole('button', { name: 'Скопировать диагностику' }).click();
const report = JSON.parse(await readClipboard(page));
assert.deepEqual(
  Object.keys(report).sort(),
  ['diagnostic', 'error', 'extensionVersion', 'schema', 'uiLanguage'].sort(),
);
for (const secret of [
  'SECRET_URL',
  'SECRET_VIDEO',
  'SECRET_TITLE',
  'SECRET_CAPTION',
  'SECRET_ANSWER',
  'SECRET_QUERY',
])
  assert.equal(JSON.stringify(report).includes(secret), false);
const keys = (value) =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
    : [];
for (const forbidden of [
  'url',
  'videoId',
  'title',
  'caption',
  'answer',
  'filename',
  'userAgent',
  'stack',
  'cookies',
])
  assert.equal(keys(report).includes(forbidden), false);
```

- [ ] **Step 9: Retain failure details in content without displaying raw data**

```js
async function request(action, trackIndex) {
  const result = await chrome.runtime.sendMessage({
    type: 'LINGO_YOUTUBE',
    action,
    videoId,
    trackIndex,
  });
  if (!result)
    throw Object.assign(new Error(t('Расширение не ответило. Обновите страницу YouTube.')), {
      failure: { code: 'NO_RESPONSE', stage: 'extension', retryable: true },
    });
  if (result.error) {
    const failure =
      typeof result.error === 'string'
        ? { code: 'LEGACY_ERROR', messageKey: result.error, stage: 'unknown', retryable: true }
        : result.error;
    throw Object.assign(new Error(t(failure.messageKey)), {
      failure,
      diagnostic: result.diagnostic,
    });
  }
  return result;
}
```

On catch in `load`, retain `{failure,diagnostic}` only for structured YouTube errors, show localized `messageKey`, and show the diagnostics button. SRT/VTT parse errors never set this state; a successful load clears it.

- [ ] **Step 10: Build the report by explicit whitelist only**

```js
function buildDiagnosticReport({ failure, diagnostic }) {
  return JSON.stringify(
    {
      schema: 1,
      extensionVersion: chrome.runtime.getManifest().version,
      uiLanguage: language(),
      error: { code: failure.code, stage: failure.stage, retryable: failure.retryable === true },
      diagnostic: {
        schema: 1,
        requestedSource: diagnostic.requestedSource,
        page: {
          watchPage: diagnostic.page.watchPage,
          playerFound: diagnostic.page.playerFound,
          videoFound: diagnostic.page.videoFound,
          responseFound: diagnostic.page.responseFound,
          videoMatches: diagnostic.page.videoMatches,
        },
        tracks: {
          count: diagnostic.tracks.count,
          selectedLanguage: diagnostic.tracks.selectedLanguage,
          selectedAutomatic: diagnostic.tracks.selectedAutomatic,
        },
        timedText: {
          outcome: diagnostic.timedText.outcome,
          httpStatus: diagnostic.timedText.httpStatus,
        },
        transcript: {
          model: diagnostic.transcript.model,
          openerFound: diagnostic.transcript.openerFound,
          attempts: diagnostic.transcript.attempts,
          cueCount: diagnostic.transcript.cueCount,
        },
      },
    },
    null,
    2,
  );
}
```

No object spread is allowed in this function; future MAIN-world fields must not become public by accident.

- [ ] **Step 11: Implement clipboard click and readonly fallback**

```js
async function copyDiagnostics() {
  const report = buildDiagnosticReport(lastCaptionFailure);
  try {
    await navigator.clipboard.writeText(report);
    announce('Диагностика скопирована.');
  } catch {
    diagnosticTextarea.value = report;
    diagnosticDialog.showModal();
    diagnosticTextarea.focus();
    diagnosticTextarea.select();
  }
}
```

The button is the only clipboard trigger. The fallback dialog has `h2`, `aria-labelledby`, readonly textarea, close button, Escape and focus return. Clipboard success does not remove or replace the original error.

- [ ] **Step 12: Add Playwright resilience matrix**

`--resilience` covers empty, HTTP 503, invalid JSON, timeout, missing opener, unknown model, legacy renderer, modern view-model, video change and player replacement. For every failure it asserts the stable code/outcome, no invented captions, the old lesson remains, and report JSON lacks the sentinel values.

Run: `node --test tests/youtube.test.cjs`

Expected: PASS for all bounded MAIN-world fixtures.

Run: `node tests/browser-smoke.cjs --resilience`

Expected: `PASS: classified caption failures, safe diagnostics and transcript fallbacks`.

- [ ] **Step 13: Run all touched regression suites**

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs tests/youtube.test.cjs tests/i18n.test.cjs`

Expected: PASS.

Run: `node tests/browser-smoke.cjs`

Expected: default caption/load/navigation regression passes.

- [ ] **Step 14: Format and commit**

Run: `npx --yes prettier@3.6.2 --check youtube.js background.js content.js styles.css i18n.js tests/youtube.test.cjs tests/browser-smoke.cjs`

Expected: `All matched files use Prettier code style!`

```powershell
git add youtube.js background.js content.js styles.css i18n.js tests/youtube.test.cjs tests/browser-smoke.cjs
git commit -m "feat: add private caption diagnostics"
```

### Task 9: Сквозная browser-приёмка и cross-feature races

**Files:**

- Modify: `tests/browser-smoke.cjs`
- Modify: `tests/library-smoke.cjs`
- Modify: `tests/keyboard-smoke.cjs`

**Interfaces:**

- Consumes: весь runtime Tasks 1–8.
- Produces: deterministic `--roundtrip` и `--accessibility` scenarios, full RU/EN library run and release-grade regression commands.

- [ ] **Step 1: Добавить failing export-clear-import roundtrip scenario**

```js
if (process.argv.includes('--roundtrip')) {
  await seedAnsweredLessonAndProfile();
  const stalePage = await openLesson('roundtrip01');
  const library = await openLibrary();
  const backup = await exportThroughUi(library);
  await clearThroughUi(library);
  await stalePage.locator('input[data-cue]').first().fill('resurrect');
  await stalePage.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.deepEqual((await callLibrary(worker, 'list')).lessons, []);
  await importThroughUi(library, backup, true);
  assert.equal((await readStorage())['lesson:roundtrip01'].tasks[0].status, 'correct');
  assert.equal((await readStorage()).preferences.gapFrequency, 'sparse');
}
```

This scenario must fail if a stale content script can restore cleared data, import loses answers/settings/profile, or preview/apply diverges silently.

- [ ] **Step 2: Run roundtrip and fix only test-fixture assumptions**

Run: `node tests/browser-smoke.cjs --roundtrip`

Expected after Tasks 1–8: `PASS: export, epoch-safe clear and idempotent import roundtrip`. If product behavior fails, return to the owning task rather than weakening assertions.

- [ ] **Step 3: Add combined accessibility scenario at 320 px and 200%**

```js
if (process.argv.includes('--accessibility')) {
  await page.setViewportSize({ width: 320, height: 800 });
  await activateWithOnboarding();
  await assertNoHorizontalOverflow(page);
  await assertDialogKeyboardLoop(page, 'Как заниматься');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await assertNoHorizontalOverflow(page);
  assert.equal(await page.getByRole('button', { name: 'Закрыть справку' }).isVisible(), true);
  await assertPoliteMessagesAreDeduplicated(page, ['Реклама', 'Диагностика скопирована']);
}
```

Also check: all dialog headings back `aria-labelledby`; source Cancel returns focus; answer accessible name contains “gap/пропуск” but not answer; success/error/hint include text, not only class/color; `saveStatus` is not live.

- [ ] **Step 4: Run accessibility in both languages**

Run: `node tests/browser-smoke.cjs --accessibility`

Expected: PASS in `ru-RU`.

Run: `node tests/browser-smoke.cjs --accessibility --i18n`

Expected: PASS in `en-US` with no Russian visible/accessible control strings.

- [ ] **Step 5: Run library smoke in both languages and verify no direct storage calls**

```js
for (const locale of ['ru-RU', 'en-US']) {
  const result = await runLibraryScenario(locale);
  assert.deepEqual(result.pageErrors, []);
  assert.equal(result.horizontalOverflow, false);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, 'library.js'), 'utf8'), /chrome\.storage/);
```

Run: `node tests/library-smoke.cjs`

Expected: RU pass.

Run: `node tests/library-smoke.cjs --i18n`

Expected: EN pass.

- [ ] **Step 6: Run every automated regression once, without redundant repeats**

```powershell
node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs tests/youtube.test.cjs tests/i18n.test.cjs
node tests/browser-smoke.cjs
node tests/browser-smoke.cjs --upgrade
node tests/browser-smoke.cjs --storage
node tests/browser-smoke.cjs --i18n
node tests/browser-smoke.cjs --learning
node tests/browser-smoke.cjs --resilience
node tests/browser-smoke.cjs --roundtrip
node tests/browser-smoke.cjs --accessibility
node tests/browser-smoke.cjs --accessibility --i18n
node tests/library-smoke.cjs
node tests/library-smoke.cjs --i18n
node tests/keyboard-smoke.cjs
```

Expected: every process exits 0 and reports no page errors, console errors or assertion failures.

- [ ] **Step 7: Commit acceptance coverage**

```powershell
git add tests/browser-smoke.cjs tests/library-smoke.cjs tests/keyboard-smoke.cjs
git commit -m "test: cover Lingo Practice 0.4 flows"
```

### Task 10: Версия, документация, assets, store ZIP и ветка для просмотра

**Files:**

- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `README.ru.md`
- Modify: `PRIVACY.md`
- Modify: `OPERA-SUBMISSION.md`
- Modify: `scripts/package.ps1`
- Modify: `scripts/render-assets.cjs`
- Add: `icons/icon64.png`
- Add: `store-assets/promo300x188.png`

**Interfaces:**

- Consumes: complete tested runtime and the two existing user-requested untracked PNG assets.
- Produces: version `0.4.0`, reproducible image set, verified source/store ZIP, exact user documentation, published `feature/0.4-learning` for owner review; no main merge/tag/release.

- [ ] **Step 1: Write failing package/manifest assertions**

```js
test('0.4 manifest and package allowlists contain every runtime file', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.4.0');
  assert.equal(manifest.icons['64'], 'icons/icon64.png');
  const packageScript = fs.readFileSync(path.join(root, 'scripts/package.ps1'), 'utf8');
  for (const name of ['data.js', 'library.html', 'library.js', 'library.css', 'icons/icon64.png'])
    assert.match(packageScript, new RegExp(name.replace('.', '\\.')));
});
```

Add this to `tests/data.test.cjs`.

- [ ] **Step 2: Run assertion and confirm version/package failure**

Run: `node --test tests/data.test.cjs --test-name-pattern="0.4 manifest"`

Expected: FAIL on version `0.3.1`, icon 64 and missing allowlist entries.

- [ ] **Step 3: Bump manifest and add reproducible asset targets**

```json
"version": "0.4.0",
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "64": "icons/icon64.png",
  "128": "icons/icon128.png"
}
```

In `scripts/render-assets.cjs`:

```js
const icon = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
const promo = fs.readFileSync(path.join(root, 'store-assets/promo.svg'), 'utf8');
for (const size of [16, 32, 48, 64, 128]) {
  await render(
    size === 128 ? icon : icon.replace('viewBox="0 0 128 128"', 'viewBox="16 16 96 96"'),
    `icons/icon${size}.png`,
    size,
    size,
  );
}
for (const [width, height] of [
  [300, 188],
  [440, 280],
])
  await render(promo, `store-assets/promo${width}x${height}.png`, width, height);
```

Use the existing SVG crop rule: all toolbar sizes including 64 use the tight `viewBox="16 16 96 96"`; 128 retains its transparent margin.

- [ ] **Step 4: Render assets and verify exact dimensions**

Run: `node scripts/render-assets.cjs`

Expected output includes `icons/icon64.png: 64×64` and `store-assets/promo300x188.png: 300×188`.

Run:

```powershell
node -e "const fs=require('node:fs');for(const [f,w,h] of [['icons/icon64.png',64,64],['store-assets/promo300x188.png',300,188]]){const b=fs.readFileSync(f);if(b.readUInt32BE(16)!==w||b.readUInt32BE(20)!==h)throw Error(f)}"
```

Expected: exit 0 with no output.

- [ ] **Step 5: Update package allowlists**

```powershell
$runtimeFiles = @('manifest.json','background.js','youtube.js','exercise.js','data.js','content.js','styles.css','i18n.js',
  'library.html','library.js','library.css','LICENSE',
  '_locales/en/messages.json','_locales/ru/messages.json',
  'icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon64.png','icons/icon128.png')
```

`$sourceFiles` additionally includes `tests/data.test.cjs`, `tests/youtube.test.cjs`, `tests/library-smoke.cjs` and `store-assets/promo300x188.png`; preserve all previous source files. The script still copies only, builds no code, downloads nothing and verifies SHA-256 for each archive entry.

- [ ] **Step 6: Update README/Russian README with exact 0.4 behavior**

Document:

```text
- “Мои занятия”: list/continue/delete, global difficult words, CSV, backup, clear and help.
- Balanced remains default; Adaptive uses all saved lessons; Dense/Normal/Sparse are 1/1, 1/2, 1/3.
- Source replacement asks only after a valid candidate loads and user work exists.
- Correct/assisted answers resume only a pause created by the extension.
- Diagnostics are copied locally and omit video/user content by whitelist.
- Continue opens YouTube at the saved timestamp; the user clicks the extension icon because activeTab is retained.
```

Update all development commands to include `data.test.cjs`, `youtube.test.cjs`, `library-smoke.cjs` and new browser flags. Keep limitations and no-cloud wording explicit.

- [ ] **Step 7: Update privacy and Opera submission docs**

`PRIVACY.md` in both languages must state:

```text
- wordProfile aggregates counters without video/title/context;
- the library can delete one lesson or all extension data;
- exported JSON contains plaintext captions, correct and entered answers;
- import is local and merge-based;
- diagnostic JSON stays local until the user copies/pastes it and excludes the approved private fields;
- local downloaded backup/CSV files are managed by the user after download.
```

`OPERA-SUBMISSION.md` lists new runtime files, explains no new permissions or remote code, and shows the complete optional test command set.

- [ ] **Step 8: Run formatter and all unit tests after docs/package changes**

Run: `npx --yes prettier@3.6.2 --check "**/*.{js,cjs,json,css,html,md}"`

Expected: `All matched files use Prettier code style!`

Run: `node --test tests/exercise.test.cjs tests/data.test.cjs tests/storage.test.cjs tests/youtube.test.cjs tests/i18n.test.cjs`

Expected: PASS.

- [ ] **Step 9: Run Chromium acceptance matrix**

```powershell
node tests/browser-smoke.cjs
node tests/browser-smoke.cjs --upgrade
node tests/browser-smoke.cjs --storage
node tests/browser-smoke.cjs --i18n
node tests/browser-smoke.cjs --learning
node tests/browser-smoke.cjs --resilience
node tests/browser-smoke.cjs --roundtrip
node tests/browser-smoke.cjs --accessibility
node tests/browser-smoke.cjs --accessibility --i18n
node tests/library-smoke.cjs
node tests/library-smoke.cjs --i18n
node tests/keyboard-smoke.cjs
```

Expected: all exit 0.

- [ ] **Step 10: Run Opera GX keyboard/library checks**

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Users\admin\AppData\Local\Programs\Opera GX\opera.exe'
node tests/keyboard-smoke.cjs
node tests/library-smoke.cjs
Remove-Item Env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
```

Expected: both pass against the installed Opera GX executable.

- [ ] **Step 11: Run live YouTube and manual 200% checks**

Run: `node tests/browser-smoke.cjs '--live=https://www.youtube.com/watch?v=jNQXAC9IVRw'`

Expected: live captions load, a gap renders, typing remains isolated and screenshot `output/playwright/live-youtube.png` is created. If YouTube has removed captions from that video, record the external fixture failure and rerun with one public regular watch video that visibly offers a transcript; do not weaken the cascade tests.

Manual browser checks: lesson and every dialog at 320 CSS px/200% zoom; keyboard-only source confirmation/help/library import; clipboard fallback with clipboard permission blocked; actual ad state when available.

- [ ] **Step 12: Build and inspect verified archives**

Run: `powershell -NoProfile -File scripts/package.ps1`

Expected:

```text
Verified <runtime-count> files: ...\lingo-practice-0.4.0-store.zip
Verified <source-count> files: ...\lingo-practice-0.4.0.zip
```

Then test an extracted store archive:

```powershell
$artifactCheck = Join-Path ([IO.Path]::GetTempPath()) ('lingo-practice-0.4.0-' + [guid]::NewGuid())
Expand-Archive -LiteralPath '..\lingo-practice-0.4.0-store.zip' -DestinationPath $artifactCheck
$env:LINGO_EXTENSION_ROOT = $artifactCheck
node tests/browser-smoke.cjs --learning
node tests/library-smoke.cjs
Remove-Item Env:LINGO_EXTENSION_ROOT
```

Expected: both scenarios pass from the exact store ZIP contents. `scripts/package.ps1` already verifies every included file hash against the working source.

- [ ] **Step 13: Commit release-ready branch content**

```powershell
git add manifest.json README.md README.ru.md PRIVACY.md OPERA-SUBMISSION.md scripts/package.ps1 scripts/render-assets.cjs icons/icon64.png store-assets/promo300x188.png tests/data.test.cjs
git commit -m "release: prepare Lingo Practice 0.4.0"
```

- [ ] **Step 14: Run final branch integrity and fresh whole-branch review**

Run:

```powershell
git status --short
git diff --check main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: clean working tree; no whitespace errors; only the design, plan and reviewed 0.4 commits appear above `main`.

Dispatch a fresh reviewer with the spec, this plan and `git diff main...HEAD`. Resolve every correctness/security/data-loss finding and rerun only the checks affected by fixes plus the unit suite; rerun the full browser matrix if a shared runtime file changes.

- [ ] **Step 15: Publish only the feature branch and hand off artifacts**

```powershell
git push -u origin feature/0.4-learning
```

Provide the branch/commit link, `lingo-practice-0.4.0-store.zip`, `lingo-practice-0.4.0.zip`, exact automated/manual results and any external live-YouTube limitation. Stop for owner review; do not merge `main`, create `v0.4.0`, or publish a release/store submission.
