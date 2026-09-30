const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const exercise = require('../exercise.js');
const data = require('../data.js');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const profile = { schema: 1, words: {} };
const session = (videoId = 'video01', updatedAt = 10, value = 'Hello') => ({
  schema: 2,
  videoId,
  title: 'Lesson',
  sourceLabel: 'English',
  sourceSelection: 'auto',
  approximate: false,
  difficulty: 'balanced',
  gapFrequency: 'dense',
  offset: 0,
  position: 0,
  updatedAt,
  tasks: [{
    id: 0, start: 0, end: 2, text: 'Hello', before: '', answer: 'Hello', after: '',
    value, status: value === 'Hello' ? 'correct' : 'pending', mistakes: 0, hints: 0,
  }],
});

// Run the real worker; replace only browser-owned storage and events.
function worker(initial = {}, beforeSet = () => {}) {
  const stored = structuredClone(initial);
  let receive;
  vm.runInNewContext(source('background.js'), {
    importScripts() {}, LingoExercise: exercise, LingoData: data, crypto: { randomUUID },
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: {
        id: 'test', getURL: (file) => `chrome-extension://test/${file}`,
        onMessage: { addListener(listener) { receive = listener; } },
      },
      storage: { local: {
        async get(keys) {
          if (keys === null) return structuredClone(stored);
          return Object.fromEntries(keys.map((key) => [key, structuredClone(stored[key])]));
        },
        async set(changes) {
          await beforeSet(changes);
          Object.assign(stored, structuredClone(changes));
        },
      } },
    },
  });
  const send = (message, sender) => new Promise((resolve) => {
    if (receive(message, sender, (result) => resolve(structuredClone(result))) !== true)
      resolve(undefined);
  });
  return {
    lesson: (message) => send({ type: 'LINGO_STORE', videoId: 'video01', ...message }, {
      id: 'test', tab: { id: 1 }, frameId: 0,
      url: 'https://www.youtube.com/watch?v=video01',
    }),
    library: (message) => send({ type: 'LINGO_LIBRARY', ...message }, {
      id: 'test', frameId: 0, url: 'chrome-extension://test/library.html',
    }),
    snapshot: () => structuredClone(stored),
  };
}

test('SRT/VTT keeps timing and text, and rejects a malformed later cue', () => {
  const srt = '\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nHello <i>world</i> &amp; friends!';
  assert.deepEqual(exercise.parseSubtitles(srt).map(({ start, end, text }) => [start, end, text]), [
    [1.25, 3.5, 'Hello world & friends!'],
  ]);
  const vtt = 'WEBVTT\n\nNOTE ignore this\n\n00:01.500 --> 00:03.750\n<v Alice>We&#39;re ready</v>';
  assert.equal(exercise.parseSubtitles(vtt)[0].text, "We're ready");
  assert.throws(() => exercise.parseSubtitles(`${srt}\n\n2\n00:90:00,000 --> 00:91:00,000\nBroken`));
});

test('YouTube timedtext reaches the JSON3 parser and reports broken responses', async () => {
  const video = {};
  const player = {
    querySelector: () => video,
    getPlayerResponse: () => ({
      videoDetails: { videoId: 'video01' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
        languageCode: 'en', name: { simpleText: 'English' },
        baseUrl: 'https://www.youtube.com/api/timedtext?v=video01',
      }] } },
    }),
  };
  const context = vm.createContext({
    URL, AbortSignal, location: { href: 'https://www.youtube.com/watch?v=video01', pathname: '/watch' },
    window: {},
    document: {
      querySelector: () => player, getElementById: () => ({}),
    },
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello there' }] }],
    }) }),
  });
  vm.runInContext(source('youtube.js'), context);
  const loaded = await context.lingoYouTube('load', { videoId: 'video01', trackIndex: 0 });
  assert.equal(loaded.diagnostic.timedText.outcome, 'success');
  assert.deepEqual(exercise.parseJson3(loaded.json).map(({ start, end, text }) => [start, end, text]), [
    [1, 3, 'Hello there'],
  ]);
  context.fetch = async () => ({ ok: true, status: 200, text: async () => '{' });
  const broken = await context.lingoYouTube('load', { videoId: 'video01', trackIndex: 0 });
  assert.equal(broken.error.code, 'TRACK_FETCH_FAILED');
  assert.equal(broken.diagnostic.timedText.outcome, 'invalid-json');
});

test('backup export/import is validated, previewed, and committed once', async () => {
  let writes = 0;
  const app = worker({
    'lesson:video01': { ...session(), revision: 2, writerId: 'private' },
    preferences: exercise.preferences({ fontSize: 18 }), wordProfile: profile,
  }, () => { writes++; });
  const exported = await app.library({ action: 'export' });
  assert.equal(data.parseBackup(exported.backup).ok, true);
  assert.equal(exported.backup.lessons[0].revision, undefined);
  assert.equal(exported.backup.lessons[0].writerId, undefined);
  const backup = data.createBackup({
    lessons: [session('video01', 20), session('added01', 30)],
    preferences: { fontSize: 22 }, wordProfile: profile,
  });
  const broken = structuredClone(backup);
  broken.lessons[1].tasks[0].end = -1;
  assert.equal((await app.library({ action: 'previewImport', backup: broken })).code, 'INVALID_BACKUP');
  assert.equal(writes, 0);
  const preview = await app.library({ action: 'previewImport', backup, importPreferences: true });
  assert.deepEqual(preview.summary, { added: 1, updated: 1, skipped: 0, wordsUpdated: 0 });
  assert.equal(writes, 0);
  assert.equal((await app.lesson({
    action: 'save', session: session('video01', 40), version: 2,
    writerId: 'private', storageEpoch: 0,
  })).version, 3);
  const request = {
    action: 'import', backup, importPreferences: true,
    expectedEpoch: preview.storageEpoch, expectedSummary: preview.summary,
  };
  assert.equal((await app.library(request)).code, 'IMPORT_CHANGED');
  assert.equal(writes, 1);
  const fresh = await app.library({ action: 'previewImport', backup, importPreferences: true });
  assert.deepEqual(fresh.summary, { added: 1, updated: 0, skipped: 1, wordsUpdated: 0 });
  const result = await app.library({ ...request, expectedSummary: fresh.summary });
  assert.equal(result.imported, true);
  assert.equal(writes, 2);
  assert.equal(app.snapshot()['lesson:video01'].updatedAt, 40);
  assert.equal(app.snapshot()['lesson:added01'].revision, 1);
  assert.equal(app.snapshot().preferences.fontSize, 22);
});

test('a stale writer cannot overwrite answers; a failed write leaves the queue usable', async () => {
  let fail = true;
  const app = worker({ wordProfile: profile }, () => {
    if (fail) { fail = false; throw new Error('Storage unavailable'); }
  });
  const save = (value, version, writerId) => ({
    action: 'save', session: session('video01', 10, value), version, writerId, storageEpoch: 0,
  });
  assert.equal((await app.lesson(save('Hello', 0, 'first'))).code, 'STORAGE_ERROR');
  assert.equal(app.snapshot()['lesson:video01'], undefined);
  assert.equal((await app.lesson(save('Hello', 0, 'first'))).version, 1);
  assert.equal((await app.lesson(save('', 0, 'stale'))).code, 'REVISION_CONFLICT');
  assert.equal(app.snapshot()['lesson:video01'].tasks[0].value, 'Hello');
  assert.equal((await app.lesson(save('Hello', 1, 'fresh'))).version, 2);
});
