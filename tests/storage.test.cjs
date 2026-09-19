const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exercise = require('../exercise.js');
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
