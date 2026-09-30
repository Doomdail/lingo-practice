const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exercise = require('../exercise.js');
const data = require('../data.js');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const lesson = (updatedAt = 10) => ({
  schema: 2, videoId: 'video01', title: 'Lesson', sourceLabel: 'English',
  sourceSelection: 'auto', approximate: false, difficulty: 'balanced', gapFrequency: 'dense',
  offset: 0, position: 0, updatedAt,
  tasks: [{ id: 0, start: 0, end: 2, text: 'Hello', before: '', answer: 'Hello', after: '',
    value: 'Hello', status: 'correct', mistakes: 0, hints: 0 }],
});

test('reserved vocabulary keys cannot mutate Object.prototype or Object', () => {
  // A separate realm contains the vulnerable implementation's prototype writes.
  const context = vm.createContext({ structuredClone });
  vm.runInContext(source('exercise.js'), context);
  // Clone in the same realm as the real module, as it is in the browser.
  vm.runInContext('structuredClone = value => JSON.parse(JSON.stringify(value))', context);
  const result = vm.runInContext(`(() => {
    const words = ['__proto__', 'constructor'];
    const tasks = words.map((word, id) => ({id, start:id*2, end:id*2+1, text:word,
      answer:word, value:word, status:'correct', mistakes:0, hints:0}));
    const profile = LingoExercise.updateWordProfile({schema:1,words:{}}, [], tasks, 10);
    return {profile, polluted: Object.hasOwn(Object.prototype, 'attempts') ||
      Object.hasOwn(Object, 'attempts')};
  })()`, context);
  assert.equal(result.polluted, false);
  for (const word of ['__proto__', 'constructor']) {
    assert.equal(Object.hasOwn(result.profile.words, word), true);
    assert.equal(result.profile.words[word].attempts, 1);
  }
});

test('unclosed markup in a legal-size subtitle file has bounded parsing cost', () => {
  const context = vm.createContext({ input: '1\n00:00:00,000 --> 00:00:02,000\n' + '<'.repeat(1_000_000) + 'word' });
  vm.runInContext(source('exercise.js'), context);
  assert.equal(vm.runInContext(`(() => {
    try { LingoExercise.parseSubtitles(input); return false; }
    catch (error) { return /фрагмент/.test(error.message); }
  })()`, context, { timeout: 2000 }), true);
});

test('oversized page captions are rejected before rolling-caption normalization', () => {
  assert.throws(() => exercise.normalizeCues([
    {start:0,end:2,text:'word '.repeat(1000)},
  ]), /4000/);
  assert.throws(() => exercise.parseJson3({events:[{
    tStartMs:0, dDurationMs:1000, segs:[{utf8:'word '.repeat(1000)}],
  }]}), /4000/);
});

test('backup cannot persist a timestamp that breaks library date rendering', () => {
  const backup = data.createBackup({lessons:[lesson()], preferences:{}, wordProfile:{schema:1,words:{}}});
  backup.lessons[0].updatedAt = 1e100;
  assert.equal(data.parseBackup(backup).ok, false);
  assert.equal(exercise.restoreSession(lesson(1e100), 'video01'), null);
  assert.equal(exercise.restoreSession(lesson(), 'video01').updatedAt, 10);
});

test('CSV exports quote delimiters and neutralize spreadsheet formulas', () => {
  const csv = data.createVocabularyCsv([{word:'=1+1', context:{
    text:'\t=HYPERLINK("https://example.invalid")', videoTitle:'line1\nline2',
  }}]);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'\t=HYPERLINK(""https://example.invalid"")"'));
  assert.ok(csv.includes('"line1\r\nline2"'));
});

test('rolling captions within size limits have linear overlap matching', () => {
  const context = vm.createContext({});
  vm.runInContext(source('exercise.js'), context);
  assert.equal(vm.runInContext(`LingoExercise.normalizeCues(Array.from({length: 100}, (_, i) => ({
    start:i/100, end:i/100+1, text:(i%2 ? 'a ' : 'b ').repeat(2000)
  }))).length`, context, {timeout:2000}), 100);
  assert.deepEqual(exercise.normalizeCues([
    {start:0,end:2,text:'we can learn'}, {start:1,end:3,text:'can learn together'},
  ]).map(cue => cue.text), ['we can learn', 'together']);
});

function worker() {
  let receive;
  const calls = [];
  const context = vm.createContext({
    URL, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto,
    LingoExercise: exercise, LingoData: data, importScripts() {}, lingoYouTube() {},
    chrome: {
      action: {onClicked: {addListener() {}}},
      runtime: {id:'test', getURL: file => `chrome-extension://test/${file}`,
        onMessage: {addListener(fn) {receive=fn;}}},
      storage: {local: {
        async setAccessLevel(options) {calls.push(['access', options.accessLevel]);},
        async get() {calls.push(['get']); return {wordProfile:{schema:1,words:{}}};},
        async set() {calls.push(['set']);},
      }},
      scripting: {async executeScript() {calls.push(['script']); return [{result:{}}];}},
    },
  });
  vm.runInContext(source('background.js'), context);
  return {calls, send: (message, overrides = {}) => new Promise(resolve => {
    const sender = {id:'test', tab:{id:1}, frameId:0,
      url:'https://www.youtube.com/watch?v=video01', ...overrides};
    if (receive(message, sender, resolve) !== true) resolve(undefined);
  })};
}

test('worker denies other-video, foreign-sender and iframe requests before storage or scripting', async () => {
  for (const type of ['LINGO_STORE', 'LINGO_YOUTUBE']) {
    const message = {type, action:type === 'LINGO_STORE' ? 'get' : 'tracks', videoId:'video01'};
    for (const [change, sender] of [
      [{videoId:'privateVideo'}, {}], [{}, {id:'foreign'}], [{}, {frameId:1}],
      [{}, {url:'https://www.youtube.com.evil.invalid/watch?v=video01'}],
      [{videoId:{}}, {}],
    ]) {
      const app = worker();
      assert.equal(await app.send({...message, ...change}, sender), undefined);
      assert.equal(app.calls.some(([name]) => name !== 'access'), false);
    }
    const app = worker();
    assert.ok(await app.send(message));
  }
});

test('worker restricts direct storage access to extension contexts before serving lessons', async () => {
  const app = worker();
  await app.send({type:'LINGO_STORE', action:'get', videoId:'video01'});
  assert.deepEqual(app.calls[0], ['access', 'TRUSTED_CONTEXTS']);
});

function captions(url, fetch) {
  const video = {};
  const player = {querySelector: () => video, getPlayerResponse: () => ({
    videoDetails:{videoId:'video01'}, captions:{playerCaptionsTracklistRenderer:{captionTracks:[{
      languageCode:'en', name:{simpleText:'English'}, baseUrl:url,
    }]}},
  })};
  const context = vm.createContext({URL, AbortSignal, TextDecoder, fetch, window:{},
    location:{href:'https://www.youtube.com/watch?v=video01', pathname:'/watch'},
    document:{querySelector: () => player, getElementById: () => ({})}});
  vm.runInContext(source('youtube.js'), context);
  return context.lingoYouTube('load', {videoId:'video01', trackIndex:0});
}

test('caption requests disallow alternate origins, URL credentials and redirects', async () => {
  for (const url of [
    'https://www.youtube.com:8443/api/timedtext', 'https://user:pass@www.youtube.com/api/timedtext',
    'https://www.youtube.com.evil.invalid/api/timedtext', 'http://www.youtube.com/api/timedtext',
  ]) {
    let fetched = false;
    const result = await captions(url, async () => {fetched = true; return new Response('');});
    assert.equal(fetched, false);
    assert.equal(result.diagnostic.timedText.outcome, 'unsupported-url');
  }
  let redirect;
  await captions('https://www.youtube.com/api/timedtext', async (_url, options) => {
    redirect = options.redirect;
    return new Response('');
  });
  assert.equal(redirect, 'error');
});

test('an 8 MB caption response is accepted', async () => {
  const json = JSON.stringify({events:[{tStartMs:0, dDurationMs:1000, segs:[{utf8:'Hello world'}]}]});
  const result = await captions('https://www.youtube.com/api/timedtext', async () =>
    new Response(json.padEnd(8_000_000, ' ')));
  assert.equal(result.diagnostic.timedText.outcome, 'success');
  assert.equal(result.json.events[0].segs[0].utf8, 'Hello world');
});

test('caption response above 8 MB is cancelled before JSON parsing', async () => {
  let cancelled = false;
  const result = await captions('https://www.youtube.com/api/timedtext', async () => new Response(
    new ReadableStream({start(controller) {
      controller.enqueue(new Uint8Array(8_000_001)); controller.enqueue(new Uint8Array(1)); controller.close();
    },
      cancel() {cancelled = true;}}),
  ));
  assert.equal(cancelled, true);
  assert.equal(result.diagnostic.timedText.outcome, 'too-large');
});

test('8 MB subtitles are accepted and larger files are rejected', () => {
  const prefix = 'WEBVTT\n\nNOTE ';
  const suffix = '\n\n00:00:00.000 --> 00:00:02.000\nHello world';
  const text = prefix + 'x'.repeat(8_000_000 - prefix.length - suffix.length) + suffix;
  assert.equal(exercise.parseSubtitles(text)[0].text, 'Hello world');
  assert.throws(() => exercise.parseSubtitles(text + ' '), /8 МБ/);
});

test('normalized caption text uses the raised total limit without relaxing cue limits', () => {
  const raw = Array.from({length:2000}, (_, i) => ({start:i, end:i+1, text:'a'.repeat(4000)}));
  assert.equal(exercise.normalizeCues(raw, false).length, 2000);
  assert.throws(() => exercise.normalizeCues([...raw, {start:2000,end:2001,text:'x'}], false), /8 МБ/);
});
