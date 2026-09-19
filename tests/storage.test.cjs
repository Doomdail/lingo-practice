const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exercise = require('../exercise.js');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');

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
const save = (value, version = 0, writerId = 'writer-a', preferences) => ({
  action: 'save',
  session: session(value),
  version,
  writerId,
  ...(preferences ? { preferences } : {}),
});

// Run the real message handler; only the browser-owned storage and event APIs are replaced.
function worker(initial = {}, beforeSet = async () => {}) {
  const data = structuredClone(initial);
  let receive;
  vm.runInNewContext(source, {
    console,
    importScripts() {},
    LingoExercise: exercise,
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: {
        onMessage: {
          addListener(listener) {
            receive = listener;
          },
        },
      },
      storage: {
        local: {
          async get(keys) {
            return Object.fromEntries(keys.map((key) => [key, structuredClone(data[key])]));
          },
          async set(values) {
            await beforeSet();
            Object.assign(data, structuredClone(values));
          },
        },
      },
    },
  });
  return {
    send(message, tabId = 1) {
      return new Promise((resolve) => {
        assert.equal(
          receive(
            { type: 'LINGO_STORE', videoId: 'video01', ...structuredClone(message) },
            { tab: { id: tabId }, frameId: 0, url: 'https://www.youtube.com/watch?v=video01' },
            (response) => resolve(structuredClone(response)),
          ),
          true,
        );
      });
    },
  };
}

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
  assert.deepEqual(await firstSave, { saved: true, version: 1 });
  assert.deepEqual(await secondSave, { saved: true, version: 2 });
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
  assert.deepEqual(accepted, { saved: true, version: 1 });
  assert.match(conflict.error, /другой вкладке/);
  const fresh = await app.send({ action: 'get' }, 2);
  assert.equal(fresh.version, 1);
  assert.equal(fresh.session.tasks[0].status, 'correct');
  assert.equal(fresh.preferences.fontSize, 22);
  assert.deepEqual(await app.send(save('Hello', fresh.version, 'writer-b'), 2), {
    saved: true,
    version: 2,
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
    videoSize: 'large',
    fontSize: 22,
    visibleRows: 6,
    autoPause: false,
    language: 'ru',
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
  assert.deepEqual(await app.send(save('Hello')), { saved: true, version: 1 });
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
  assert.deepEqual(await app.send(save('Hello')), { saved: true, version: 1 });
});
