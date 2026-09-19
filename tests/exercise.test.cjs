const { test } = require('node:test');
const assert = require('node:assert/strict');
const exercise = require('../exercise.js');

const cue = (text, id = 0) => ({ id, start: id * 3, end: id * 3 + 2, text });
const task = (overrides = {}) => ({
  ...exercise.create(cue('Hello friend')),
  ...overrides,
});
const session = (videoId, updatedAt, tasks) => ({
  schema: 2,
  videoId,
  title: '',
  sourceLabel: '',
  sourceSelection: 'auto',
  approximate: false,
  offset: 0,
  position: 0,
  tasks,
  updatedAt,
});

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

test('word profiles tolerate corrupt working data, reject malformed backups, and retain 2,000 newest entries', () => {
  assert.deepEqual(exercise.restoreWordProfile(null), { schema: 1, words: {} });
  assert.equal(exercise.restoreWordProfile({ schema: 1, words: [] }, true), null);
  assert.equal(
    exercise.restoreWordProfile(
      {
        schema: 1,
        words: {
          invalid: { attempts: -1, clean: 0, mistakes: 0, hints: 0, misses: 0, lastSeenAt: 0 },
        },
      },
      true,
    ),
    null,
  );
  const entries = Object.fromEntries(
    Array.from({ length: 2001 }, (_, index) => [
      `word${String(index).padStart(4, '0')}`,
      { attempts: 0, clean: 0, mistakes: 0, hints: 0, misses: 0, lastSeenAt: index },
    ]),
  );
  const restored = exercise.restoreWordProfile({ schema: 1, words: entries });
  assert.equal(Object.keys(restored.words).length, 2000);
  assert.equal(restored.words.word0000, undefined);
  assert.ok(restored.words.word2000);
});

test('word profile builds lessons in update order', () => {
  const finishedTask = (answer) => task({ answer, value: answer, status: 'correct' });
  const profile = exercise.buildWordProfile([
    { videoId: 'z', updatedAt: 20, tasks: [finishedTask('Second')] },
    { videoId: 'a', updatedAt: 10, tasks: [finishedTask('First')] },
  ]);
  assert.equal(profile.words.first.lastSeenAt, 10);
  assert.equal(profile.words.second.lastSeenAt, 20);
});
