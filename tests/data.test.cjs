const { test } = require('node:test');
const assert = require('node:assert/strict');
const exercise = require('../exercise.js');
const data = require('../data.js');

const cue = (text, id = 0) => ({ id, start: id * 3, end: id * 3 + 2, text });
const task = (overrides = {}) => ({ ...exercise.create(cue('Hello friend')), ...overrides });
const session = (videoId, updatedAt, tasks, overrides = {}) => ({
  schema: 2,
  videoId,
  title: '',
  sourceLabel: 'English',
  sourceSelection: 'auto',
  approximate: false,
  offset: 0,
  position: 0,
  tasks,
  updatedAt,
  ...overrides,
});

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
    friend: { attempts: 4, clean: 1, mistakes: 3, hints: 1, misses: 0, lastSeenAt: 20 },
  },
};
const olderLesson = session('older01', 10, [
  { ...difficultFriend, text: 'Old friend', before: 'Old ', after: '', start: 2, end: 4 },
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

test('vocabulary keeps profile keys authoritative and omits profile-only fields', () => {
  const entries = data.vocabulary(
    {
      schema: 1,
      words: {
        friend: { ...profile.words.friend, word: 'override', privateNote: 'do not export' },
      },
    },
    [newerLesson],
  );
  assert.equal(entries[0].word, 'friend');
  assert.equal('privateNote' in entries[0], false);
});

test('untouched pending tasks do not replace genuinely difficult vocabulary context', () => {
  const untouchedNewerLesson = session('untouched01', 30, [task()]);
  const [entry] = data.vocabulary(profile, [newerLesson, untouchedNewerLesson]);
  assert.equal(entry.context.videoId, 'newer01');
  assert.equal(entry.context.text, 'Hello, friend!');
});

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

test('backup strips internals and round-trips answers', () => {
  const preferences = exercise.preferences({ difficulty: 'adaptive', gapFrequency: 'normal' });
  const storedLesson = {
    ...newerLesson,
    revision: 4,
    writerId: 'writer-a',
    tombstone: true,
    epoch: 99,
    unknown: 'discard me',
  };
  const backup = data.createBackup(
    { preferences, wordProfile: profile, lessons: [storedLesson] },
    '2026-09-19T12:00:00.000Z',
  );
  assert.equal(backup.format, 'lingo-practice-backup');
  assert.equal(backup.version, 1);
  for (const key of ['revision', 'writerId', 'tombstone', 'epoch', 'unknown'])
    assert.equal(key in backup.lessons[0], false);
  assert.equal(backup.lessons[0].tasks[0].answer, 'friend');
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

test('backup parser refuses malformed preferences and word-profile containers', () => {
  const base = data.createBackup(
    { preferences: {}, wordProfile: profile, lessons: [newerLesson] },
    '2026-09-19T12:00:00.000Z',
  );
  const badFontSize = structuredClone(base);
  badFontSize.preferences.fontSize = {};
  const primitiveWords = structuredClone(base);
  primitiveWords.wordProfile.words = true;
  const primitiveProfile = structuredClone(base);
  primitiveProfile.wordProfile = 123;
  for (const backup of [badFontSize, primitiveWords, primitiveProfile])
    assert.equal(data.parseBackup(backup).ok, false);
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
  assert.equal(first.next.preferences.fontSize, 24);
  const second = data.planBackupImport(first.next, imported, true);
  assert.deepEqual(second.summary, { added: 0, updated: 0, skipped: 3, wordsUpdated: 0 });
});

test('merge leaves preferences local unless selected and never sums word counters', () => {
  const imported = data.createBackup(
    {
      preferences: { fontSize: 24 },
      wordProfile: {
        schema: 1,
        words: { friend: { ...profile.words.friend, attempts: 99, lastSeenAt: 20 } },
      },
      lessons: [],
    },
    '2026-09-19T12:00:00.000Z',
  );
  const result = data.planBackupImport(
    { preferences: { fontSize: 16 }, wordProfile: profile, lessons: [] },
    imported,
  );
  assert.equal(result.next.preferences.fontSize, 16);
  assert.equal(result.next.wordProfile.words.friend.attempts, 4);
  assert.equal(result.summary.wordsUpdated, 0);
});

test('merge recognizes constructor and own JSON __proto__ words', () => {
  const importedProfile = JSON.parse(
    '{"schema":1,"words":{"constructor":{"attempts":1,"clean":0,"mistakes":1,"hints":0,"misses":0,"lastSeenAt":22},"__proto__":{"attempts":1,"clean":0,"mistakes":1,"hints":0,"misses":0,"lastSeenAt":22}}}',
  );
  const imported = data.createBackup(
    { preferences: {}, wordProfile: importedProfile, lessons: [] },
    '2026-09-19T12:00:00.000Z',
  );
  const result = data.planBackupImport(
    { preferences: {}, wordProfile: { schema: 1, words: {} }, lessons: [] },
    imported,
  );
  assert.equal(result.summary.wordsUpdated, 2);
  assert.equal(result.next.wordProfile.words.constructor.attempts, 1);
  assert.equal(Object.hasOwn(result.next.wordProfile.words, '__proto__'), true);
  assert.equal(result.next.wordProfile.words.__proto__.attempts, 1);
});
