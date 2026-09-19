const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exercise = require('../exercise.js');
const backupData = require('../data.js');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const lessonSender = {
  id: 'lingo-test',
  tab: { id: 1 },
  frameId: 0,
  url: 'https://www.youtube.com/watch?v=video01',
};
const librarySender = {
  id: 'lingo-test',
  frameId: 0,
  url: 'chrome-extension://lingo-test/library.html',
};

const session = (value) => ({
  schema: 2,
  videoId: 'video01',
  tasks: [
    {
      id: 0,
      start: 0,
      end: 4,
      text: 'Hello',
      before: '',
      answer: 'Hello',
      after: '',
      value,
      status: value === 'Hello' ? 'correct' : 'pending',
      mistakes: 0,
      hints: 0,
    },
  ],
});
const save = (value, version = 0, writerId = 'writer-a', preferences, storageEpoch) => ({
  action: 'save',
  session: session(value),
  version,
  writerId,
  ...(preferences !== undefined ? { preferences } : {}),
  ...(storageEpoch !== undefined ? { storageEpoch } : {}),
});

// Run the real message handler; only the browser-owned storage and event APIs are replaced.
function worker(initial = {}, hooks = {}) {
  const data = structuredClone(initial);
  let receive,
    reads = 0;
  if (typeof hooks === 'function') hooks = { beforeSet: hooks };
  vm.runInNewContext(source, {
    console,
    importScripts() {},
    LingoExercise: exercise,
    LingoData: backupData,
    crypto: webcrypto,
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: {
        id: 'lingo-test',
        getURL: (file) => `chrome-extension://lingo-test/${file}`,
        onMessage: {
          addListener(listener) {
            receive = listener;
          },
        },
      },
      storage: {
        local: {
          async get(keys) {
            reads++;
            await hooks.beforeGet?.(keys);
            if (keys === null) return structuredClone(data);
            const list = typeof keys === 'string' ? [keys] : keys;
            return Object.fromEntries(list.map((key) => [key, structuredClone(data[key])]));
          },
          async set(values) {
            await hooks.beforeSet?.(values);
            Object.assign(data, structuredClone(values));
          },
          async remove(keys) {
            await hooks.beforeRemove?.(keys);
            for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
          },
        },
      },
    },
  });
  const send = (message, sender) =>
    new Promise((resolve) => {
      const pending = receive(structuredClone(message), structuredClone(sender), (response) =>
        resolve(structuredClone(response)),
      );
      if (pending !== true) resolve(undefined);
    });
  const sendLesson = (message, sender = lessonSender) =>
    send({ type: 'LINGO_STORE', videoId: 'video01', ...message }, sender);
  return {
    send: (message, tabId = 1) => sendLesson(message, { ...lessonSender, tab: { id: tabId } }),
    sendLesson,
    sendLibrary: (message, sender = librarySender) =>
      send({ type: 'LINGO_LIBRARY', ...message }, sender),
    sendRaw: send,
    snapshot: () => structuredClone(data),
    reads: () => reads,
  };
}

test('only the extension main frame on a YouTube watch page reaches lesson storage', async () => {
  const app = worker({ wordProfile: { schema: 1, words: {} } });
  assert.equal((await app.sendLesson({ action: 'get' })).version, 0);
  for (const patch of [
    { id: 'foreign-extension' },
    { id: undefined },
    { frameId: 1 },
    { frameId: undefined },
    { tab: undefined },
    { url: 'http://www.youtube.com/watch?v=video01' },
    { url: 'https://www.youtube.com/shorts/video01' },
    { url: 'https://www.youtube.com.evil.test/watch?v=video01' },
    { url: 'https://www.youtube.com/watch/extra' },
  ]) {
    assert.equal(await app.sendLesson({ action: 'get' }, { ...lessonSender, ...patch }), undefined);
  }
  for (const videoId of [
    '',
    '../video01',
    'a'.repeat(65),
    'video01\n',
    'video01\r',
    123,
    ['video01'],
    null,
  ])
    assert.equal(await app.sendLesson({ action: 'get', videoId }), undefined);
  assert.equal(await app.sendLesson({ action: 'delete' }), undefined);
  assert.equal(app.reads(), 1);
});

const libraryLesson = (videoId, updatedAt, revision = 1) => ({
  ...exercise.restoreSession(session('Hello'), 'video01'),
  videoId,
  updatedAt,
  revision,
  title: 'Lesson ' + videoId,
  sourceLabel: 'English',
  writerId: 'private-writer',
  tasks: [{ ...session('Hello').tasks[0], mistakes: 1 }],
});

test('list is sorted, compact and reports invalid local records without leaking them', async () => {
  const app = worker({
    'lesson:older01': libraryLesson('older01', 10),
    'lesson:newer01': libraryLesson('newer01', 20, 3),
    'lesson:a_tied': libraryLesson('a_tied', 20),
    'lesson:broken': { tasks: ['secret answer'], videoId: 'broken' },
    'lesson:bad/id': libraryLesson('bad/id', 30),
    'lesson:deleted': { deleted: true, revision: 9 },
    preferences: null,
  });
  const result = await app.sendLibrary({ action: 'list' });
  assert.ok(result, 'trusted library action must return a response');
  assert.deepEqual(
    result.lessons.map((item) => item.videoId),
    ['a_tied', 'newer01', 'older01'],
  );
  assert.equal(result.invalidCount, 2);
  assert.deepEqual(result.lessons[1], {
    videoId: 'newer01',
    title: 'Lesson newer01',
    sourceLabel: 'English',
    updatedAt: 20,
    position: 0,
    completed: 1,
    total: 1,
    revision: 3,
  });
  assert.equal(result.storageEpoch, 0);
  assert.equal(result.preferences.fontSize, 18);
  assert.doesNotMatch(JSON.stringify(result), /tasks|secret answer|private-writer|Hello/);
});

test('vocabulary returns compact difficult words with one allowed context', async () => {
  const app = worker({ 'lesson:video01': libraryLesson('video01', 20, 3) });
  const result = await app.sendLibrary({ action: 'vocabulary' });
  assert.ok(result, 'trusted vocabulary action must return a response');
  assert.deepEqual(result, {
    words: [
      {
        word: 'hello',
        attempts: 1,
        clean: 0,
        mistakes: 1,
        hints: 0,
        misses: 0,
        lastSeenAt: 20,
        score: 1,
        context: {
          text: 'Hello',
          time: 0,
          videoTitle: 'Lesson video01',
          videoId: 'video01',
          source: 'English',
        },
      },
    ],
    invalidCount: 0,
    storageEpoch: 0,
  });
  assert.doesNotMatch(JSON.stringify(result), /tasks|answer|value|writerId|revision/);
});

test('delete requires current revision and epoch and stale tabs cannot resurrect the lesson', async () => {
  const app = worker({ 'lesson:video01': libraryLesson('video01', 20, 2) });
  const remove = { action: 'delete', videoId: 'video01', expectedRevision: 2, expectedEpoch: 0 };
  assert.equal(
    (await app.sendLibrary({ ...remove, expectedRevision: 1 }))?.code,
    'REVISION_CONFLICT',
  );
  assert.equal((await app.sendLibrary({ ...remove, expectedEpoch: 1 })).code, 'EPOCH_CONFLICT');
  assert.deepEqual(await app.sendLibrary(remove), { deleted: true, revision: 3, storageEpoch: 0 });
  assert.deepEqual(app.snapshot()['lesson:video01'], { deleted: true, revision: 3 });
  assert.equal(
    (await app.sendLesson(save('Hello', 2, 'private-writer', undefined, 0))).code,
    'REVISION_CONFLICT',
  );
  assert.equal((await app.sendLibrary({ ...remove, expectedRevision: 3 })).code, 'NOT_FOUND');
  assert.equal(
    (await app.sendLibrary({ ...remove, videoId: 'missing', expectedRevision: 0 })).code,
    'NOT_FOUND',
  );
});

test('vocabulary keeps anonymous legacy stats after lesson deletion but removes its context', async () => {
  const app = worker({ 'lesson:video01': libraryLesson('video01', 20, 3) });
  const before = await app.sendLibrary({ action: 'vocabulary' });
  assert.equal(before.words[0].context.text, 'Hello');
  assert.equal(
    (
      await app.sendLibrary({
        action: 'delete',
        videoId: 'video01',
        expectedRevision: 3,
        expectedEpoch: 0,
      })
    )?.deleted,
    true,
  );
  const after = await app.sendLibrary({ action: 'vocabulary' });
  assert.equal(after.words[0].attempts, before.words[0].attempts);
  assert.equal(after.words[0].context, null);
  assert.doesNotMatch(JSON.stringify(app.snapshot()), /Hello|private-writer|tasks/);
});

test('delete rejects malformed counters and overflow without modifying state', async () => {
  const app = worker({ 'lesson:video01': libraryLesson('video01', 20, 2) });
  const before = app.snapshot();
  for (const patch of [
    { videoId: '../video01' },
    { videoId: 'video01\n' },
    ...[null, undefined, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
      { expectedEpoch: value },
      { expectedRevision: value },
    ]),
  ]) {
    assert.equal(
      (
        await app.sendLibrary({
          action: 'delete',
          videoId: 'video01',
          expectedRevision: 2,
          expectedEpoch: 0,
          ...patch,
        })
      )?.code,
      'INVALID_MESSAGE',
    );
    assert.deepEqual(app.snapshot(), before);
  }
  const overflow = worker({
    'lesson:video01': libraryLesson('video01', 20, Number.MAX_SAFE_INTEGER),
  });
  assert.equal(
    (
      await overflow.sendLibrary({
        action: 'delete',
        videoId: 'video01',
        expectedRevision: Number.MAX_SAFE_INTEGER,
        expectedEpoch: 0,
      })
    ).code,
    'INVALID_MESSAGE',
  );
  assert.equal(overflow.snapshot()['lesson:video01'].revision, Number.MAX_SAFE_INTEGER);
});

const clearSeed = () => ({
  'lesson:video01': { ...libraryLesson('video01', 20, 2), title: 'private caption' },
  wordProfile: {
    schema: 1,
    words: { hello: { attempts: 1, clean: 0, mistakes: 1, hints: 0, misses: 0, lastSeenAt: 20 } },
  },
  preferences: { fontSize: 22 },
  oldCache: 'private caption',
});

test('clear commits empty values with a new epoch before best-effort cleanup', async () => {
  const writes = [];
  const app = worker(clearSeed(), {
    beforeSet: (values) => writes.push(structuredClone(values)),
    beforeRemove: () => {
      throw new Error('remove failed');
    },
  });
  const result = await app.sendLibrary({ action: 'clear', expectedEpoch: 0 });
  assert.deepEqual(result, { cleared: true, storageEpoch: 1, cleanupPending: true });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]['lesson:video01'], { deleted: true, revision: 3 });
  assert.equal(writes[0].storageEpoch, 1);
  assert.deepEqual((await app.sendLibrary({ action: 'list' })).lessons, []);
  assert.deepEqual((await app.sendLibrary({ action: 'vocabulary' })).words, []);
  assert.equal((await app.sendLibrary({ action: 'list' })).preferences.fontSize, 18);
  assert.doesNotMatch(JSON.stringify(app.snapshot()), /private caption|hello/);
  assert.equal((await app.sendLesson(save('Hello', 2))).code, 'EPOCH_CONFLICT');
  assert.deepEqual(await app.sendLibrary({ action: 'clear', expectedEpoch: 1 }), {
    cleared: true,
    storageEpoch: 2,
    cleanupPending: true,
  });
});

test('failed primary clear set preserves the old epoch and all user values then permits retry', async () => {
  let fail = true;
  const app = worker(clearSeed(), {
    beforeSet: () => {
      if (fail) throw new Error('set failed');
    },
  });
  const before = app.snapshot();
  assert.equal(
    (await app.sendLibrary({ action: 'clear', expectedEpoch: 0 }))?.code,
    'STORAGE_ERROR',
  );
  assert.deepEqual(app.snapshot(), before);
  fail = false;
  assert.deepEqual(await app.sendLibrary({ action: 'clear', expectedEpoch: 0 }), {
    cleared: true,
    storageEpoch: 1,
  });
  assert.equal(app.snapshot().storageEpoch, 1);
  assert.doesNotMatch(JSON.stringify(app.snapshot()), /private caption|hello/);
  assert.equal((await app.sendLesson(save('Hello', 0))).code, 'EPOCH_CONFLICT');
  assert.equal((await app.sendLesson(save('Hello', 0, 'fresh', undefined, 1))).saved, true);
});

test('clear rejects stale or invalid epochs and counter overflow before any writes', async () => {
  for (const [seed, expectedEpoch, code] of [
    [clearSeed(), 1, 'EPOCH_CONFLICT'],
    ...[undefined, null, -1, 1.5, '0'].map((value) => [clearSeed(), value, 'INVALID_MESSAGE']),
    [
      { ...clearSeed(), storageEpoch: Number.MAX_SAFE_INTEGER },
      Number.MAX_SAFE_INTEGER,
      'INVALID_MESSAGE',
    ],
    [
      { 'lesson:video01': libraryLesson('video01', 20, Number.MAX_SAFE_INTEGER) },
      0,
      'INVALID_MESSAGE',
    ],
  ]) {
    const app = worker(seed);
    assert.equal((await app.sendLibrary({ action: 'clear', expectedEpoch }))?.code, code);
    assert.deepEqual(app.snapshot(), seed);
  }
});

const importSeed = () => ({
  'lesson:video01': libraryLesson('video01', 10, 2),
  'lesson:equal01': libraryLesson('equal01', 20, 4),
  preferences: { fontSize: 22 },
  wordProfile: {
    schema: 1,
    words: { hello: { attempts: 2, clean: 0, mistakes: 2, hints: 0, misses: 0, lastSeenAt: 10 } },
  },
});
const importBackup = () => ({
  format: 'lingo-practice-backup',
  version: 1,
  exportedAt: '2026-09-19T12:00:00.000Z',
  lessons: [
    libraryLesson('video01', 30),
    libraryLesson('equal01', 20),
    libraryLesson('added01', 40),
  ],
  preferences: { ...exercise.preferences(), fontSize: 26 },
  wordProfile: {
    schema: 1,
    words: { hello: { attempts: 3, clean: 1, mistakes: 2, hints: 0, misses: 0, lastSeenAt: 30 } },
  },
});

test('export includes only normalized public data and preview never writes', async () => {
  const app = worker({
    ...importSeed(),
    'lesson:broken': { schema: 9 },
    'lesson:gone': { deleted: true, revision: 6 },
    cache: 'secret',
  });
  const exported = await app.sendLibrary({ action: 'export' });
  assert.ok(exported, 'export must return a backup');
  assert.equal(exported.backup.lessons.length, 2);
  assert.equal(exported.invalidCount, 1);
  assert.equal(exported.storageEpoch, 0);
  assert.equal(backupData.parseBackup(exported.backup).ok, true);
  assert.doesNotMatch(
    JSON.stringify(exported.backup),
    /revision|writerId|storageEpoch|deleted|secret/,
  );
  const before = app.snapshot();
  assert.deepEqual(
    await app.sendLibrary({
      action: 'previewImport',
      backup: importBackup(),
      importPreferences: false,
    }),
    {
      summary: { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 },
      invalidLocalCount: 1,
      storageEpoch: 0,
    },
  );
  assert.deepEqual(app.snapshot(), before);
});

test('future duplicate and one-broken-session backups fail strict preview validation without writes', async () => {
  const future = { ...importBackup(), version: 2 };
  const duplicate = importBackup();
  duplicate.lessons.push(duplicate.lessons[0]);
  const broken = importBackup();
  broken.lessons.at(-1).tasks[0].end = -1;
  const profile = { ...importBackup(), wordProfile: { schema: 1, words: true } };
  for (const backup of [future, duplicate, broken, profile, null]) {
    const app = worker(importSeed());
    const before = app.snapshot();
    assert.equal(
      (await app.sendLibrary({ action: 'previewImport', backup, importPreferences: true }))?.code,
      'INVALID_BACKUP',
    );
    assert.deepEqual(app.snapshot(), before);
  }
});

test('list export and vocabulary omit invalid local timestamps and count damaged records', async () => {
  for (const updatedAt of [-1, Infinity]) {
    const damaged = libraryLesson('damaged01', updatedAt);
    damaged.tasks[0] = { ...damaged.tasks[0], text: 'Broken', answer: 'Broken', value: 'Broken' };
    const app = worker({
      'lesson:video01': libraryLesson('video01', 20),
      'lesson:damaged01': damaged,
    });
    const before = app.snapshot();
    const listed = await app.sendLibrary({ action: 'list' });
    assert.deepEqual(
      listed.lessons.map((lesson) => lesson.videoId),
      ['video01'],
    );
    assert.equal(listed.invalidCount, 1);
    const exported = await app.sendLibrary({ action: 'export' });
    assert.equal(exported.error, undefined);
    assert.deepEqual(
      exported.backup.lessons.map((lesson) => lesson.videoId),
      ['video01'],
    );
    assert.equal(exported.invalidCount, 1);
    assert.equal(backupData.parseBackup(exported.backup).ok, true);
    const vocabulary = await app.sendLibrary({ action: 'vocabulary' });
    assert.deepEqual(
      vocabulary.words.map((entry) => entry.word),
      ['hello'],
    );
    assert.equal(vocabulary.invalidCount, 1);
    assert.deepEqual(app.snapshot(), before);
  }
});

test('preview can derive legacy profile without writing it', async () => {
  const legacy = worker({ 'lesson:video01': libraryLesson('video01', 10) });
  const before = legacy.snapshot();
  assert.equal(
    (await legacy.sendLibrary({ action: 'previewImport', backup: importBackup() })).summary
      .wordsUpdated,
    1,
  );
  assert.deepEqual(legacy.snapshot(), before);
});

test('preview and import reject unusable backup video IDs without writes', async () => {
  for (const videoId of ['bad/id', 'a'.repeat(65)]) {
    const backup = importBackup();
    backup.lessons.at(-1).videoId = videoId;
    const app = worker(importSeed());
    const before = app.snapshot();
    for (const action of ['previewImport', 'import']) {
      const result = await app.sendLibrary({
        action,
        backup,
        importPreferences: true,
        expectedEpoch: 0,
        expectedSummary: { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 },
      });
      assert.equal(result.code, 'INVALID_BACKUP');
      assert.deepEqual(app.snapshot(), before);
    }
  }
});

test('import re-reads state and rejects a changed preview before assigning new revisions', async () => {
  const app = worker(importSeed());
  const backup = importBackup();
  const preview = await app.sendLibrary({
    action: 'previewImport',
    backup,
    importPreferences: true,
  });
  await app.sendLesson({
    ...save('Hello', 2, 'local-writer'),
    session: { ...session('Hello'), updatedAt: 50 },
  });
  const before = app.snapshot();
  const request = {
    action: 'import',
    backup,
    importPreferences: true,
    expectedEpoch: preview.storageEpoch,
    expectedSummary: preview.summary,
  };
  assert.equal((await app.sendLibrary(request))?.code, 'IMPORT_CHANGED');
  assert.deepEqual(app.snapshot(), before);
  const next = await app.sendLibrary({ action: 'previewImport', backup, importPreferences: true });
  assert.deepEqual(await app.sendLibrary({ ...request, expectedSummary: next.summary }), {
    imported: true,
    summary: { added: 1, updated: 0, skipped: 2, wordsUpdated: 1 },
    storageEpoch: 0,
  });
  assert.equal(app.snapshot()['lesson:video01'].updatedAt, 50);
  assert.equal(app.snapshot()['lesson:added01'].revision, 1);
  assert.equal(app.snapshot().preferences.fontSize, 26);
});

test('import uses one atomic set, advances tombstone revisions and never sums or replays history', async () => {
  const writes = [];
  const seed = { ...importSeed(), 'lesson:added01': { deleted: true, revision: 8 } };
  const app = worker(seed, { beforeSet: (changes) => writes.push(structuredClone(changes)) });
  const backup = importBackup();
  const preview = await app.sendLibrary({
    action: 'previewImport',
    backup,
    importPreferences: false,
  });
  const result = await app.sendLibrary({
    action: 'import',
    backup,
    importPreferences: false,
    expectedEpoch: 0,
    expectedSummary: preview.summary,
  });
  assert.deepEqual(result, {
    imported: true,
    summary: { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 },
    storageEpoch: 0,
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), [
    'lesson:added01',
    'lesson:video01',
    'storageEpoch',
    'wordProfile',
  ]);
  const stored = app.snapshot();
  assert.equal(stored['lesson:added01'].revision, 9);
  assert.equal(stored['lesson:added01'].updatedAt, 40);
  assert.equal(stored['lesson:video01'].revision, 3);
  assert.match(stored['lesson:video01'].writerId, /^import:/);
  assert.equal(stored['lesson:video01'].writerId, stored['lesson:added01'].writerId);
  assert.deepEqual(stored['lesson:equal01'], seed['lesson:equal01']);
  assert.equal(stored.preferences.fontSize, 22);
  assert.equal(stored.wordProfile.words.hello.attempts, 3);
  assert.doesNotMatch(JSON.stringify(result), /tasks|sessions|writerId|Hello/);
  const replay = await app.sendLibrary({ action: 'previewImport', backup });
  assert.deepEqual(replay.summary, { added: 0, updated: 0, skipped: 3, wordsUpdated: 0 });
  assert.equal(
    (
      await app.sendLibrary({
        action: 'import',
        backup,
        expectedEpoch: 0,
        expectedSummary: replay.summary,
      })
    ).imported,
    true,
  );
  assert.deepEqual(app.snapshot(), stored);
});

test('import rejects malformed messages, epoch conflicts, invalid backups and revision overflow without writes', async () => {
  const valid = {
    action: 'import',
    backup: importBackup(),
    importPreferences: true,
    expectedEpoch: 0,
    expectedSummary: { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 },
  };
  for (const [patch, code] of [
    [{ expectedEpoch: 1 }, 'EPOCH_CONFLICT'],
    [{ expectedEpoch: null }, 'INVALID_MESSAGE'],
    [{ expectedEpoch: undefined }, 'INVALID_MESSAGE'],
    [{ expectedSummary: undefined }, 'INVALID_MESSAGE'],
    [{ expectedSummary: { ...valid.expectedSummary, added: '1' } }, 'INVALID_MESSAGE'],
    [{ expectedSummary: { ...valid.expectedSummary, added: 2 } }, 'IMPORT_CHANGED'],
    [{ backup: { ...importBackup(), version: 2 } }, 'INVALID_BACKUP'],
  ]) {
    const app = worker(importSeed());
    const before = app.snapshot();
    assert.equal((await app.sendLibrary({ ...valid, ...patch }))?.code, code);
    assert.deepEqual(app.snapshot(), before);
  }
  const seed = {
    ...importSeed(),
    'lesson:added01': { deleted: true, revision: Number.MAX_SAFE_INTEGER },
  };
  const app = worker(seed);
  assert.equal((await app.sendLibrary(valid)).code, 'INVALID_MESSAGE');
  assert.deepEqual(app.snapshot(), seed);
});

test('failed import set leaves lessons preferences profile and epoch untouched and permits retry', async () => {
  let fail = true;
  const writes = [];
  const app = worker(importSeed(), {
    beforeSet: (values) => {
      if (fail) throw new Error('quota');
      writes.push(structuredClone(values));
    },
  });
  const request = {
    action: 'import',
    backup: importBackup(),
    importPreferences: true,
    expectedEpoch: 0,
    expectedSummary: { added: 1, updated: 1, skipped: 1, wordsUpdated: 1 },
  };
  const before = app.snapshot();
  assert.equal((await app.sendLibrary(request))?.code, 'STORAGE_ERROR');
  assert.deepEqual(app.snapshot(), before);
  fail = false;
  assert.equal((await app.sendLibrary(request)).imported, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), [
    'lesson:added01',
    'lesson:video01',
    'preferences',
    'storageEpoch',
    'wordProfile',
  ]);
  assert.equal(app.snapshot().preferences.fontSize, 26);
});

test('only the exact extension library main-frame URL can perform allowed admin actions', async () => {
  const app = worker(importSeed());
  assert.equal((await app.sendLibrary({ action: 'list' })).lessons.length, 2);
  const before = app.snapshot();
  const reads = app.reads();
  for (const patch of [
    { url: librarySender.url + '?q=1' },
    { url: librarySender.url + '#section' },
    { url: librarySender.url + '/' },
    { url: 'chrome-extension://foreign/library.html' },
    { url: 'https://example.test/library.html' },
    { url: 'chrome-extension://lingo-test/popup.html' },
    { frameId: 1 },
    { frameId: undefined },
    { id: 'foreign' },
    { id: undefined },
  ]) {
    for (const action of [
      'list',
      'vocabulary',
      'delete',
      'clear',
      'export',
      'previewImport',
      'import',
    ])
      assert.equal(
        await app.sendLibrary({ action, expectedEpoch: 0 }, { ...librarySender, ...patch }),
        undefined,
      );
  }
  for (const action of ['get', 'save', 'unknown', undefined])
    assert.equal(await app.sendLibrary({ action }), undefined);
  for (const action of [
    'list',
    'vocabulary',
    'delete',
    'clear',
    'export',
    'previewImport',
    'import',
  ]) {
    assert.equal(await app.sendLesson({ action }), undefined);
    assert.equal(
      await app.sendRaw({ type: 'LINGO_STORE', action, videoId: 'video01' }, librarySender),
      undefined,
    );
  }
  assert.equal(app.reads(), reads);
  assert.deepEqual(app.snapshot(), before);
});

test('library reads and delete wait for a pending lesson save and check its committed revision', async () => {
  let release, started;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const writing = new Promise((resolve) => {
    started = resolve;
  });
  let first = true;
  const app = worker(
    {},
    {
      beforeSet: async () => {
        if (first) {
          first = false;
          started();
          await blocked;
        }
      },
    },
  );
  const saved = app.sendLesson(save('Hello'));
  await writing;
  let listed = false;
  const list = app.sendLibrary({ action: 'list' }).then((value) => {
    listed = true;
    return value;
  });
  const deleted = app.sendLibrary({
    action: 'delete',
    videoId: 'video01',
    expectedRevision: 0,
    expectedEpoch: 0,
  });
  await new Promise(setImmediate);
  assert.equal(listed, false);
  release();
  assert.equal((await saved).version, 1);
  assert.equal((await list).lessons[0].revision, 1);
  assert.equal((await deleted).code, 'REVISION_CONFLICT');
  assert.equal(app.snapshot()['lesson:video01'].revision, 1);
});

test('clear cleanup stays in the shared queue before a fresh-epoch lesson save', async () => {
  let release, started;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const removing = new Promise((resolve) => {
    started = resolve;
  });
  const app = worker(clearSeed(), {
    beforeRemove: async () => {
      started();
      await blocked;
    },
  });
  const clear = app.sendLibrary({ action: 'clear', expectedEpoch: 0 });
  await removing;
  const fresh = app.sendLesson(save('Hello', 0, 'fresh', undefined, 1));
  await new Promise(setImmediate);
  assert.deepEqual(app.snapshot()['lesson:video01'], { deleted: true, revision: 3 });
  release();
  assert.equal((await clear).storageEpoch, 1);
  assert.equal((await fresh).saved, true);
  assert.equal(app.snapshot()['lesson:video01'].revision, 1);
  assert.equal(app.snapshot()['lesson:video01'].tasks[0].status, 'correct');
});

test('import revalidates the supplied backup and current epoch after preview', async () => {
  const app = worker(importSeed());
  const backup = importBackup();
  const preview = await app.sendLibrary({ action: 'previewImport', backup });
  const before = app.snapshot();
  const broken = structuredClone(backup);
  broken.lessons.at(-1).tasks[0].end = -1;
  const request = {
    action: 'import',
    expectedEpoch: preview.storageEpoch,
    expectedSummary: preview.summary,
  };
  assert.equal((await app.sendLibrary({ ...request, backup: broken })).code, 'INVALID_BACKUP');
  assert.deepEqual(app.snapshot(), before);
  await app.sendLibrary({ action: 'clear', expectedEpoch: 0 });
  const cleared = app.snapshot();
  assert.equal((await app.sendLibrary({ ...request, backup })).code, 'EPOCH_CONFLICT');
  assert.deepEqual(app.snapshot(), cleared);
});

test('delete failure preserves profile and library storage errors do not poison the shared queue', async () => {
  let failRead = true,
    failWrite = true;
  const app = worker(importSeed(), {
    beforeGet: () => {
      if (failRead) {
        failRead = false;
        throw new Error('read');
      }
    },
    beforeSet: () => {
      if (failWrite) {
        failWrite = false;
        throw new Error('set');
      }
    },
  });
  const before = app.snapshot();
  assert.equal((await app.sendLibrary({ action: 'list' })).code, 'STORAGE_ERROR');
  const request = { action: 'delete', videoId: 'video01', expectedRevision: 2, expectedEpoch: 0 };
  assert.equal((await app.sendLibrary(request)).code, 'STORAGE_ERROR');
  assert.deepEqual(app.snapshot(), before);
  assert.equal((await app.sendLibrary(request)).deleted, true);
  assert.deepEqual(app.snapshot().wordProfile, before.wordProfile);
  assert.equal((await app.sendLesson(save('Hello', 3, 'fresh'))).saved, true);
});

test('equal timestamp import keeps local word counters even when backup counters are larger', async () => {
  const backup = importBackup();
  backup.wordProfile.words.hello = {
    attempts: 99,
    clean: 0,
    mistakes: 99,
    hints: 0,
    misses: 0,
    lastSeenAt: 10,
  };
  const app = worker(importSeed());
  const preview = await app.sendLibrary({ action: 'previewImport', backup });
  assert.equal(preview.summary.wordsUpdated, 0);
  assert.equal(
    (
      await app.sendLibrary({
        action: 'import',
        backup,
        expectedEpoch: 0,
        expectedSummary: preview.summary,
      })
    ).imported,
    true,
  );
  assert.equal(app.snapshot().wordProfile.words.hello.attempts, 2);
});

test('lesson and library message namespaces cannot impersonate each other', async () => {
  const app = worker();
  assert.equal(await app.sendLibrary({ action: 'list' }, lessonSender), undefined);
  assert.equal(await app.sendLesson({ action: 'get' }, librarySender), undefined);
  assert.equal(app.reads(), 0);
});

test('queued saves from one writer preserve immediate drafts and a following read waits for them', async () => {
  let release,
    started,
    first = true;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const writing = new Promise((resolve) => {
    started = resolve;
  });
  const app = worker({}, async () => {
    if (first) {
      first = false;
      started();
      await blocked;
    }
  });
  const firstSave = app.send(save('H'));
  await writing;
  const secondSave = app.send(save('Hello')); // Sent before the first response updates the client's version.
  const read = app.send({ action: 'get' });
  release();
  assert.deepEqual(await firstSave, { saved: true, version: 1, storageEpoch: 0 });
  assert.deepEqual(await secondSave, { saved: true, version: 2, storageEpoch: 0 });
  const loaded = await read;
  assert.equal(loaded.version, 2);
  assert.equal(loaded.session.tasks[0].status, 'correct');
  assert.equal(loaded.session.tasks[0].value, 'Hello');
});

test('stale tabs cannot overwrite answers or preferences and a fresh read permits takeover', async () => {
  const app = worker();
  const a = await app.send({ action: 'get' }, 1);
  const b = await app.send({ action: 'get' }, 2);
  assert.equal(a.version, 0);
  assert.equal(b.version, 0);
  const [accepted, conflict] = await Promise.all([
    app.send(save('Hello', a.version, 'writer-a', { fontSize: 22 }), 1),
    app.send(save('', b.version, 'writer-b', { fontSize: 14 }), 2),
  ]);
  assert.deepEqual(accepted, { saved: true, version: 1, storageEpoch: 0 });
  assert.match(conflict.error, /другой вкладке/);
  const fresh = await app.send({ action: 'get' }, 2);
  assert.equal(fresh.version, 1);
  assert.equal(fresh.session.tasks[0].status, 'correct');
  assert.equal(fresh.preferences.fontSize, 22);
  assert.deepEqual(await app.send(save('Hello', fresh.version, 'writer-b'), 2), {
    saved: true,
    version: 2,
    storageEpoch: 0,
  });
  assert.match((await app.send(save('H', 1, 'writer-a'), 1)).error, /другой вкладке/);
  assert.equal((await app.send({ action: 'get' })).session.tasks[0].value, 'Hello');
});

test('preference patches merge and autosaving progress does not reset another setting', async () => {
  const app = worker();
  await app.send(
    { action: 'save', preferences: { fontSize: 22, videoSize: 'large', language: 'ru' } },
    1,
  );
  await app.send({ action: 'save', preferences: { visibleRows: 6 } }, 2);
  await app.send(save('H'));
  let loaded = await app.send({ action: 'get' });
  assert.deepEqual(loaded.preferences, {
    difficulty: 'balanced',
    gapFrequency: 'dense',
    videoSize: 'large',
    fontSize: 22,
    visibleRows: 6,
    autoPause: false,
    language: 'ru',
    onboardingSeen: false,
  });
  assert.equal(loaded.version, 1);
  await app.send({ action: 'save', preferences: { fontSize: 99 } }, 2);
  loaded = await app.send({ action: 'get' });
  assert.equal(loaded.preferences.fontSize, 26);
  assert.equal(loaded.preferences.videoSize, 'large');
  assert.equal(loaded.preferences.language, 'ru');
  assert.equal(loaded.version, 1, 'preferences-only saves do not claim the lesson');
});

test('a storage write failure leaves the revision unchanged and does not poison the queue', async () => {
  let fail = true;
  const app = worker({}, async () => {
    if (fail) {
      fail = false;
      throw new Error('Storage unavailable');
    }
  });
  assert.ok((await app.send(save('H'))).error);
  const missing = await app.send({ action: 'get' });
  assert.equal(missing.session, null);
  assert.equal(missing.version, 0);
  assert.deepEqual(await app.send(save('Hello')), { saved: true, version: 1, storageEpoch: 0 });
  assert.equal((await app.send({ action: 'get' })).session.tasks[0].value, 'Hello');
});

test('legacy sessions begin at version zero and require a valid writer to save', async () => {
  const app = worker({ 'lesson:video01': session('H') });
  const legacy = await app.send({ action: 'get' });
  assert.equal(legacy.version, 0);
  assert.equal(legacy.session.tasks[0].value, 'H');
  for (const writerId of ['', null, 'a'.repeat(65)])
    assert.ok((await app.send(save('Hello', 0, writerId))).error);
  assert.equal((await app.send({ action: 'get' })).version, 0);
  assert.deepEqual(await app.send(save('Hello')), { saved: true, version: 1, storageEpoch: 0 });
});

test('legacy epoch zero saves but a cleared epoch rejects lesson and preference patches first', async () => {
  const legacy = worker();
  assert.equal((await legacy.sendLesson({ action: 'get' })).storageEpoch, 0);
  assert.equal((await legacy.sendLesson(save('Hello'))).saved, true);
  const app = worker({ storageEpoch: 1 });
  for (const storageEpoch of [undefined, 0, null, '1', -1]) {
    const before = app.snapshot();
    const stale = await app.sendLesson({
      ...save('Hello', -1, '', { fontSize: 22 }),
      storageEpoch,
    });
    assert.equal(stale.code, 'EPOCH_CONFLICT');
    assert.equal(stale.storageEpoch, 1);
    assert.deepEqual(app.snapshot(), before);
    assert.equal(
      (await app.sendLesson({ action: 'save', preferences: { fontSize: 22 }, storageEpoch })).code,
      'EPOCH_CONFLICT',
    );
  }
  assert.equal((await app.sendLesson({ action: 'get' })).preferences.fontSize, 18);
  assert.equal((await app.sendLesson(save('Hello', 0, 'writer-a', undefined, 1))).saved, true);
  assert.equal(
    (await legacy.sendLesson({ ...save('Hello', 1), storageEpoch: null })).code,
    'EPOCH_CONFLICT',
  );
});

test('a fresh get can recreate a tombstoned lesson at the next revision', async () => {
  const app = worker({
    'lesson:video01': { ...session('Hello'), deleted: true, revision: 8, writerId: 'writer-old' },
    storageEpoch: 2,
  });
  const loaded = await app.sendLesson({ action: 'get' });
  assert.equal(loaded.session, null);
  assert.equal(loaded.version, 8);
  assert.equal(
    (await app.sendLesson(save('Hello', 0, 'writer-old', undefined, 2))).code,
    'REVISION_CONFLICT',
  );
  assert.deepEqual(await app.sendLesson(save('Hello', 8, 'writer-new', undefined, 2)), {
    saved: true,
    version: 9,
    storageEpoch: 2,
  });
  assert.equal(app.snapshot()['lesson:video01'].deleted, undefined);
});

test('same writer may queue drafts but another writer and malformed counters cannot bypass checks', async () => {
  const app = worker();
  const first = app.sendLesson(save('H'));
  const second = app.sendLesson(save('Hello'));
  assert.equal((await first).version, 1);
  assert.equal((await second).version, 2);
  assert.equal((await app.sendLesson(save('', 0, 'writer-b'))).code, 'REVISION_CONFLICT');
  assert.equal((await app.sendLesson(save('', 3, 'writer-a'))).code, 'REVISION_CONFLICT');
  for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER, NaN, Infinity, '2', undefined]) {
    const before = app.snapshot();
    assert.equal((await app.sendLesson({ ...save('Hello'), version })).code, 'INVALID_MESSAGE');
    assert.deepEqual(app.snapshot(), before);
  }
});

test('invalid persisted epochs fail closed and revision overflow cannot write', async () => {
  for (const storageEpoch of [null, -1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
    const app = worker({ storageEpoch });
    assert.equal((await app.sendLesson({ action: 'get' })).code, 'STORAGE_ERROR');
    assert.equal((await app.sendLesson(save('Hello'))).code, 'STORAGE_ERROR');
    assert.deepEqual(app.snapshot(), { storageEpoch });
  }
  const app = worker({
    'lesson:video01': { ...session('H'), revision: Number.MAX_SAFE_INTEGER, writerId: 'writer-a' },
  });
  const before = app.snapshot();
  assert.equal((await app.sendLesson(save('Hello'))).code, 'INVALID_MESSAGE');
  assert.deepEqual(app.snapshot(), before);
  for (const revision of [-1, 1.5, '4']) {
    assert.equal(
      (
        await worker({ 'lesson:video01': { ...session('H'), revision } }).sendLesson({
          action: 'get',
        })
      ).version,
      0,
    );
  }
});

const completedLesson = (videoId, word, updatedAt) => ({
  ...session('Hello'),
  videoId,
  updatedAt,
  tasks: [{ ...session('Hello').tasks[0], text: word, answer: word, value: word }],
});

test('first read migrates valid legacy lessons once and saves count only a new completion', async () => {
  let scans = 0,
    writes = 0;
  const app = worker(
    {
      'lesson:old01': completedLesson('old01', 'friend', 10),
      'lesson:old02': completedLesson('old02', 'friend', 20),
      'lesson:deleted': { ...completedLesson('deleted', 'gone', 30), deleted: true, revision: 5 },
      'lesson:broken': { schema: 2, videoId: 'broken', tasks: [] },
      'lesson:mismatch': completedLesson('other', 'wrong', 40),
      'lesson:bad/id': completedLesson('bad/id', 'wrong', 50),
      unrelated: completedLesson('unrelated', 'wrong', 60),
    },
    {
      beforeGet: (keys) => {
        if (keys === null) scans++;
      },
      beforeSet: () => {
        writes++;
      },
    },
  );
  const first = await app.sendLesson({ action: 'get' });
  assert.deepEqual(first.wordProfile, {
    schema: 1,
    words: {
      friend: { attempts: 2, clean: 2, mistakes: 0, hints: 0, misses: 0, lastSeenAt: 20 },
    },
  });
  const migrated = app.snapshot().wordProfile;
  await app.sendLesson({ action: 'get' });
  assert.deepEqual(app.snapshot().wordProfile, migrated);
  assert.equal(scans, 1);
  assert.equal(writes, 1);
  await app.sendLesson(save('H'));
  await app.sendLesson({ ...save('Hello'), session: { ...session('Hello'), updatedAt: 30 } });
  await app.sendLesson({ ...save('Hello'), session: { ...session('Hello'), updatedAt: 40 } });
  const loaded = await app.sendLesson({ action: 'get' });
  assert.deepEqual(loaded.wordProfile.words.hello, {
    attempts: 1,
    clean: 1,
    mistakes: 0,
    hints: 0,
    misses: 0,
    lastSeenAt: 30,
  });
  assert.equal(loaded.wordProfile.words.friend.attempts, 2);
  assert.equal(scans, 1);
});

test('corrupt profile is rebuilt and the first save combines migration with lesson and preferences', async () => {
  const writes = [];
  const app = worker(
    {
      wordProfile: { schema: 1, words: { broken: {} } },
      'lesson:old01': completedLesson('old01', 'friend', 10),
    },
    { beforeSet: (changes) => writes.push(structuredClone(changes)) },
  );
  assert.equal((await app.sendLesson(save('Hello', 0, 'writer-a', { fontSize: 22 }))).saved, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['lesson:video01', 'preferences', 'wordProfile']);
  const stored = app.snapshot();
  assert.equal(stored.wordProfile.schema, 1);
  assert.equal(stored.wordProfile.words.friend.attempts, 1);
  assert.equal(stored.wordProfile.words.hello.attempts, 1);
  assert.equal(stored['lesson:video01'].schema, 2);
  assert.equal(stored.preferences.fontSize, 22);
});

test('null stored preferences return defaults while legacy profile migration runs once', async () => {
  let scans = 0;
  const writes = [];
  const app = worker(
    { preferences: null, 'lesson:old01': completedLesson('old01', 'friend', 10) },
    {
      beforeGet: (keys) => {
        if (keys === null) scans++;
      },
      beforeSet: (changes) => writes.push(structuredClone(changes)),
    },
  );
  for (let read = 0; read < 2; read++) {
    const loaded = await app.sendLesson({ action: 'get' });
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.preferences, {
      difficulty: 'balanced',
      gapFrequency: 'dense',
      language: 'auto',
      videoSize: 'medium',
      fontSize: 18,
      visibleRows: 5,
      autoPause: false,
      onboardingSeen: false,
    });
    assert.equal(loaded.wordProfile.words.friend.attempts, 1);
  }
  assert.equal(scans, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ['wordProfile']);
  assert.equal(app.snapshot().preferences, null);
});

for (const words of [42, true]) {
  test(`primitive profile words ${words} rebuilds completed history once`, async () => {
    let scans = 0,
      writes = 0;
    const app = worker(
      {
        wordProfile: { schema: 1, words },
        'lesson:old01': completedLesson('old01', 'friend', 10),
      },
      {
        beforeGet: (keys) => {
          if (keys === null) scans++;
        },
        beforeSet: () => {
          writes++;
        },
      },
    );
    for (let read = 0; read < 2; read++) {
      const loaded = await app.sendLesson({ action: 'get' });
      assert.deepEqual(loaded.wordProfile, {
        schema: 1,
        words: {
          friend: { attempts: 1, clean: 1, mistakes: 0, hints: 0, misses: 0, lastSeenAt: 10 },
        },
      });
    }
    assert.equal(scans, 1);
    assert.equal(writes, 1);
    assert.equal((await app.sendLesson(save('Hello'))).saved, true);
    assert.equal(app.snapshot().wordProfile.words.friend.attempts, 1);
    assert.equal(app.snapshot().wordProfile.words.hello.attempts, 1);
  });
}

test('valid empty profile does not remigrate existing lesson history', async () => {
  let scans = 0,
    writes = 0;
  const app = worker(
    {
      wordProfile: { schema: 1, words: {} },
      'lesson:old01': completedLesson('old01', 'friend', 10),
    },
    {
      beforeGet: (keys) => {
        if (keys === null) scans++;
      },
      beforeSet: () => {
        writes++;
      },
    },
  );
  for (let read = 0; read < 2; read++)
    assert.deepEqual((await app.sendLesson({ action: 'get' })).wordProfile, {
      schema: 1,
      words: {},
    });
  assert.equal(scans, 0);
  assert.equal(writes, 0);
});

test('conflicts invalid payloads and set failure never mutate profile or other stored state', async () => {
  let fail = false;
  const app = worker(
    {},
    {
      beforeSet: () => {
        if (fail) throw new Error('quota exceeded');
      },
    },
  );
  await app.sendLesson(save('H', 0, 'writer-a', { fontSize: 18 }));
  const before = app.snapshot();
  const invalid = [
    [save('Hello', 0, 'writer-b', { fontSize: 22 }), 'REVISION_CONFLICT'],
    [save('Hello', 1, 'writer-a', { fontSize: 22 }, 1), 'EPOCH_CONFLICT'],
    [{ ...save('Hello', 1), session: { schema: 7 } }, 'INVALID_MESSAGE'],
    [{ ...save('Hello', 1), session: false }, 'INVALID_MESSAGE'],
    [save('Hello', 1, 'writer-a', []), 'INVALID_MESSAGE'],
    [save('Hello', 1, ''), 'INVALID_MESSAGE'],
  ];
  for (const [message, code] of invalid) {
    assert.equal((await app.sendLesson(message)).code, code);
    assert.deepEqual(app.snapshot(), before);
  }
  fail = true;
  assert.equal(
    (await app.sendLesson(save('Hello', 1, 'writer-a', { fontSize: 22 }))).code,
    'STORAGE_ERROR',
  );
  assert.deepEqual(app.snapshot(), before);
  fail = false;
  assert.equal((await app.sendLesson(save('Hello', 1, 'writer-a', { fontSize: 22 }))).version, 2);
  const stored = app.snapshot();
  assert.equal(stored.wordProfile.words.hello.attempts, 1);
  assert.equal(stored.preferences.fontSize, 22);
});

test('a failed read or migration write does not poison the queue', async () => {
  let failRead = true,
    failWrite = true;
  const app = worker(
    { 'lesson:old01': completedLesson('old01', 'friend', 10) },
    {
      beforeGet: () => {
        if (failRead) {
          failRead = false;
          throw new Error('read failed');
        }
      },
      beforeSet: () => {
        if (failWrite) {
          failWrite = false;
          throw new Error('write failed');
        }
      },
    },
  );
  const before = app.snapshot();
  assert.equal((await app.sendLesson({ action: 'get' })).code, 'STORAGE_ERROR');
  assert.equal((await app.sendLesson({ action: 'get' })).code, 'STORAGE_ERROR');
  assert.deepEqual(app.snapshot(), before);
  assert.equal((await app.sendLesson({ action: 'get' })).wordProfile.words.friend.attempts, 1);
});
