const { test } = require('node:test');
const assert = require('node:assert/strict');
const exercise = require('../exercise.js');

test('SRT and WebVTT import preserve fractional timing, decode text and ignore metadata', () => {
  assert.equal(typeof exercise.parseSubtitles, 'function');
  const srt =
    '\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nHello <i>world</i> &amp; friends!\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nWe&#39;re ready.';
  assert.deepEqual(
    exercise.parseSubtitles(srt).map((c) => [c.start, c.end, c.text]),
    [
      [1.25, 3.5, 'Hello world & friends!'],
      [5, 7, "We're ready."],
    ],
  );
  const vtt =
    'WEBVTT\n\nNOTE ignored\nmetadata\n\nSTYLE\n::cue { color: red; }\n\nfirst-cue\n00:01.500 --> 00:03.750 align:start\n<v Alice>Hello <00:02.000>there</v>\n\n00:05.000 --> 00:06.000\n[Music]';
  assert.deepEqual(
    exercise.parseSubtitles(vtt).map((c) => [c.start, c.end, c.text]),
    [[1.5, 3.75, 'Hello there']],
  );
});

test('invalid imports fail explicitly, without dropping malformed cues or accepting broken clocks', () => {
  assert.equal(typeof exercise.parseSubtitles, 'function');
  for (const input of [
    '',
    'Not subtitles',
    '00:61.000 --> 00:62.000\nHello',
    '00:02.000 --> 00:01.000\nHello',
    '00:00.000 --> 00:02.000\nHello\n\n00:90.000 --> 00:92.000\nBroken',
  ])
    assert.throws(() => exercise.parseSubtitles(input));
  assert.throws(() => exercise.parseSubtitles('a'.repeat(2_000_001)), /больш/i);
});

test('WebVTT tolerates extra blank lines, empty cues and metadata-like cue identifiers', () => {
  const vtt =
    'WEBVTT\n\n00:00.000 --> 00:01.000\n\n\nSTYLE introduction\n00:01.000 --> 00:02.000\nHello\n\n\n\nREGION introduction\n00:02.000 --> 00:03.000\nThere\n\nWEBVTT introduction\n00:03.000 --> 00:04.000\nFriend';
  assert.deepEqual(
    exercise.parseSubtitles(vtt).map((c) => c.text),
    ['Hello', 'There', 'Friend'],
  );
});

test('caption character references are decoded, and oversized merged cues fail before replacing a lesson', () => {
  assert.equal(
    exercise.parseSubtitles('WEBVTT\n\n00:00.000 --> 00:02.000\n&lrm;I&rsquo;m ready')[0].text,
    '\u200eI’m ready',
  );
  const tooLong = [1, 2, 3]
    .map((i) => i + '\n00:00:00,000 --> 00:00:02,000\n' + Array(166).fill('language').join(' '))
    .join('\n\n');
  assert.throws(() => exercise.parseSubtitles(tooLong), /длин/i);
});

test('difficulty selects suitable words while sound effects never become answers', () => {
  const cue = {
    id: 0,
    start: 0,
    end: 3,
    text: 'I discover extraordinary places [Music] (applause) aaaaaah',
  };
  assert.equal(exercise.create(cue, () => 0, 'easy').answer, 'I');
  assert.equal(exercise.create(cue, () => 0, 'hard').answer, 'extraordinary');
  for (const difficulty of ['easy', 'balanced', 'hard'])
    for (const random of [0, 0.4, 0.99]) {
      assert.ok(
        !['Music', 'applause', 'aaaaaah'].includes(
          exercise.create(cue, () => random, difficulty).answer,
        ),
      );
    }
});

test('hints and historical mistakes remain separate from independent answers in results', () => {
  assert.equal(typeof exercise.resultCounts, 'function');
  const items = [
    { answer: 'a', status: 'correct', mistakes: 1, hints: 0 },
    { answer: 'b', status: 'assisted', mistakes: 0, hints: 1 },
    { answer: 'c', status: 'revealed', mistakes: 0, hints: 3 },
    { answer: 'd', status: 'skipped', mistakes: 0, hints: 0 },
    { answer: 'e', status: 'pending', mistakes: 0, hints: 0 },
  ];
  assert.deepEqual(exercise.resultCounts(items), {
    total: 5,
    independent: 1,
    assisted: 1,
    revealed: 1,
    skipped: 1,
    remaining: 1,
  });
  assert.deepEqual(
    items.filter((t) => exercise.isDifficult(t, false)).map((t) => t.answer),
    ['a', 'b', 'c', 'd'],
  );
  assert.equal(exercise.isDifficult(items[4], true), true);
});

test('saved sessions restore exact gaps and reject corrupt or mismatched video data', () => {
  assert.equal(typeof exercise.restoreSession, 'function');
  const task = {
    ...exercise.create({ id: 0, start: 1, end: 3, text: 'Hello friend' }, () => 0),
    value: 'Hel',
    mistakes: 1,
    hints: 1,
  };
  const session = {
    schema: 2,
    videoId: 'video01',
    title: 'Lesson',
    sourceLabel: 'local.srt',
    sourceSelection: 'file',
    approximate: false,
    offset: 0.5,
    position: 2.25,
    difficulty: 'hard',
    tasks: [task],
    updatedAt: 10,
  };
  const restored = exercise.restoreSession(JSON.parse(JSON.stringify(session)), 'video01');
  assert.equal(restored.tasks[0].answer, 'Hello');
  assert.equal(restored.tasks[0].value, 'Hel');
  assert.equal(restored.tasks[0].mistakes, 1);
  assert.equal(restored.offset, 0.5);
  assert.equal(restored.position, 2.25);
  assert.equal(exercise.restoreSession(session, 'other'), null);
  assert.equal(
    exercise.restoreSession({ ...session, tasks: [{ ...task, answer: 'changed' }] }, 'video01'),
    null,
  );
  assert.equal(
    exercise.restoreSession({ ...session, tasks: [{ ...task, end: -1 }] }, 'video01'),
    null,
  );
  assert.equal(exercise.restoreSession({ ...session, schema: 999 }, 'video01'), null);
});

test('answers ignore case, outer spaces and apostrophe style, but not spelling errors', () => {
  assert.equal(typeof exercise.matches, 'function', 'answer checking is implemented');
  assert.equal(exercise.matches('  DON’T ', "don't"), true);
  assert.equal(exercise.matches('freind', 'friend'), false);
  assert.equal(exercise.matches('', 'friend'), false);
});

test('a gap replaces one whole word and preserves punctuation and contractions', () => {
  assert.equal(typeof exercise.create, 'function', 'gap generation is implemented');
  const cue = { id: 0, start: 0, end: 3, text: "Hello, don't stop!" };
  const task = exercise.create(cue, () => 0.5);
  assert.equal(task.before, 'Hello, ');
  assert.equal(task.answer, "don't");
  assert.equal(task.after, ' stop!');
  assert.equal(task.before + task.answer + task.after, cue.text);
  assert.equal(exercise.create({ ...cue, text: '[Music]' }).answer, null);
  assert.equal(exercise.create({ ...cue, text: '♪' }).answer, null);
  assert.equal(exercise.create({ ...cue, text: '(Hello there)' }, () => 0).answer, 'Hello');
});

test('JSON3 captions retain timestamps, append events and remove only overlapping rolling text', () => {
  assert.equal(typeof exercise.parseJson3, 'function', 'caption parsing is implemented');
  const cues = exercise.parseJson3({
    events: [
      { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Hello there' }] },
      { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'Hello there friend' }] },
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Again' }] },
      { tStartMs: 5200, dDurationMs: 800, aAppend: 1, segs: [{ utf8: ' today' }] },
      { tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: 'Again today' }] },
      { tStartMs: 9000, dDurationMs: 1000, segs: [{ utf8: '[Music]' }] },
    ],
  });
  assert.deepEqual(
    cues.map(({ start, end, text }) => ({ start, end, text })),
    [
      { start: 0, end: 1, text: 'Hello there' },
      { start: 1, end: 4, text: 'friend' },
      { start: 5, end: 6, text: 'Again today' },
      { start: 7, end: 8, text: 'Again today' },
    ],
  );
});

test('active cue follows seeks and does not stay active through gaps or after the end', () => {
  assert.equal(typeof exercise.activeIndex, 'function', 'cue synchronization is implemented');
  const cues = [
    { start: 1, end: 3 },
    { start: 5, end: 7 },
  ];
  assert.equal(exercise.activeIndex(cues, 0), -1);
  assert.equal(exercise.activeIndex(cues, 2), 0);
  assert.equal(exercise.activeIndex(cues, 3), -1);
  assert.equal(exercise.activeIndex(cues, 6), 1);
  assert.equal(exercise.activeIndex(cues, 1), 0);
  assert.equal(exercise.activeIndex(cues, 8), -1);
});

test('caption normalization rejects broken timing and retains separated repeated lyrics', () => {
  assert.equal(typeof exercise.normalizeCues, 'function', 'normalization is implemented');
  const cues = exercise.normalizeCues([
    { start: 4, end: 6, text: 'Stay with me' },
    { start: 0, end: 2, text: 'Stay with me' },
    { start: 3, end: 2, text: 'invalid' },
    { start: NaN, end: 3, text: 'invalid' },
    { start: 7, end: 8, text: '[Applause]' },
    { start: 8, end: 9, text: '  Hello\n world  ' },
  ]);
  assert.deepEqual(
    cues.map((c) => c.text),
    ['Stay with me', 'Stay with me', 'Hello world'],
  );
  assert.deepEqual(
    cues.map((c) => c.id),
    [0, 1, 2],
  );
});
