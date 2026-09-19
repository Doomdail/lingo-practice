const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../youtube.js'), 'utf8');

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  async text() {
    return body;
  },
});

const namedError = (name) => Object.assign(new Error('private failure detail'), { name });

const legacyRenderer = {
  transcriptSegmentRenderer: {
    startMs: '1000',
    endMs: '2500',
    snippet: { runs: [{ text: 'Legacy cue' }] },
  },
};

const modernViewModel = {
  transcriptSegmentViewModel: {
    timestamp: '0:03',
    simpleText: 'Modern cue',
  },
};

const cyclicUnknownModel = { content: { kind: 'future-transcript-model' } };
cyclicUnknownModel.content.parent = cyclicUnknownModel;

function deepRendererModel(objectCount, withCue) {
  const root = {};
  let current = root;
  for (let index = 1; index < objectCount; index++) {
    current.child = {};
    current = current.child;
  }
  if (withCue)
    current.transcriptSegmentRenderer = {
      startMs: '1000',
      endMs: '2000',
      snippet: { simpleText: 'Boundary cue' },
    };
  return root;
}

function rendererCues(count) {
  return Array.from({ length: count }, (_, index) => ({
    transcriptSegmentRenderer: {
      startMs: String(index * 1000),
      endMs: String(index * 1000 + 500),
      snippet: { simpleText: `Cue ${index}` },
    },
  }));
}

function makePageContext(options) {
  let href = 'https://www.youtube.com/watch?v=safe01';
  let waitCount = 0;
  let openerClicked = false;
  let rootPresent = !options.removeRoot;
  const video = { duration: 20 };
  const captionTracks =
    options.tracks === undefined
      ? [
          {
            languageCode: 'en',
            name: { simpleText: 'English' },
            baseUrl: options.baseUrl ?? 'https://www.youtube.com/api/timedtext?v=safe01',
          },
        ]
      : options.tracks;
  const playerResponse = options.noResponse
    ? undefined
    : {
        videoDetails: { videoId: options.responseVideoId ?? 'safe01', title: 'Private title' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks } },
      };
  const closeButton = { click() {} };
  const panel = options.panel
    ? {
        data: options.panel,
        querySelector(selector) {
          if (selector === '#visibility-button button') return closeButton;
          if (selector.includes('transcript-segment'))
            return options.panelModelSelector === false ? null : {};
          return null;
        },
      }
    : null;
  const opener = options.opener
    ? {
        click() {
          openerClicked = true;
        },
      }
    : null;
  const player = options.noPlayer
    ? null
    : {
        querySelector(selector) {
          return selector === 'video' && !options.noVideo ? video : null;
        },
        getPlayerResponse() {
          return playerResponse;
        },
        getVideoData() {
          return { title: 'Private title' };
        },
      };
  const document = {
    title: 'Private title - YouTube',
    querySelector(selector) {
      if (selector === '#movie_player') return player;
      if (selector === 'ytd-video-description-transcript-section-renderer button') return opener;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'ytd-engagement-panel-section-list-renderer')
        return panel && (!options.panelAfterOpen || openerClicked) ? [panel] : [];
      if (selector === 'ytd-transcript-segment-renderer') return options.rows ?? [];
      if (
        selector ===
        'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]'
      )
        return panel && openerClicked ? [panel] : [];
      return [];
    },
    getElementById(id) {
      return id === 'lingo-practice-root' && rootPresent ? {} : null;
    },
  };
  const location = {
    get href() {
      return href;
    },
    get pathname() {
      return new URL(href).pathname;
    },
  };
  return {
    URL,
    AbortSignal,
    document,
    location,
    window: { ytInitialPlayerResponse: options.initialResponse },
    async fetch() {
      if (options.fetchError) throw options.fetchError;
      const fetched = options.fetch ?? response(200, '');
      if (options.changeVideoAfterFetch) href = 'https://www.youtube.com/watch?v=private-other-id';
      if (options.removeRootAfterFetch) rootPresent = false;
      return {
        status: fetched.status,
        ok: fetched.ok,
        async text() {
          const body = await fetched.text();
          if (options.changeVideoAfterBody)
            href = 'https://www.youtube.com/watch?v=private-other-id';
          if (options.removeRootAfterBody) rootPresent = false;
          return body;
        },
      };
    },
    setTimeout(resolve) {
      waitCount += 1;
      if (waitCount === options.changeVideoAtAttempt)
        href = 'https://www.youtube.com/watch?v=private-other-id';
      resolve();
    },
  };
}

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

test('selected track failures use a stable privacy-safe contract', async () => {
  const result = await run({
    trackIndex: 0,
    fetchError: namedError('NetworkError'),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.error)), {
    code: 'TRACK_FETCH_FAILED',
    messageKey: 'YouTube не отдал эту дорожку. Выберите «Расшифровка YouTube» или «Автоматически».',
    stage: 'timedtext',
    retryable: true,
  });
  assert.equal(result.diagnostic.schema, 1);
  assert.equal(result.diagnostic.requestedSource, 'track');
  assert.equal(result.diagnostic.timedText.outcome, 'network-error');
  assert.equal(result.diagnostic.tracks.selectedLanguage, 'en');
  assert.equal(result.diagnostic.tracks.selectedAutomatic, false);
  const serialized = JSON.stringify(result);
  for (const secret of [
    'safe01',
    'Private title',
    'private failure detail',
    '/api/timedtext',
    '?v=',
  ])
    assert.equal(serialized.includes(secret), false, `failure leaked ${secret}`);
});

test('diagnostic primitives reject page-owned objects, URLs and oversized strings', async () => {
  for (const languageCode of [
    { secret: 'PRIVATE_OBJECT_LANGUAGE' },
    'https://private.test/language?token=PRIVATE_QUERY',
    `en-${'PRIVATE_OVERSIZED'.repeat(20)}`,
  ]) {
    const result = await run({
      trackIndex: 0,
      tracks: [
        {
          languageCode,
          name: { simpleText: 'Safe label' },
          baseUrl: 'https://www.youtube.com/api/timedtext',
        },
      ],
      fetchError: namedError('NetworkError'),
    });
    assert.equal(result.diagnostic.tracks.selectedLanguage, null);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  }

  const malformedTracks = {
    length: { secret: 'PRIVATE_TRACK_COUNT' },
    findIndex() {
      return -1;
    },
  };
  const malformedResult = await run({ tracks: malformedTracks });
  assert.equal(malformedResult.diagnostic.tracks.count, 0);
  assert.equal(JSON.stringify(malformedResult).includes('PRIVATE_TRACK_COUNT'), false);

  const statusResult = await run({
    fetch: {
      status: { secret: 'PRIVATE_STATUS' },
      ok: false,
      async text() {
        return '';
      },
    },
  });
  assert.equal(statusResult.diagnostic.timedText.httpStatus, null);
  assert.equal(JSON.stringify(statusResult).includes('PRIVATE_STATUS'), false);

  const valid = await run({
    trackIndex: 0,
    tracks: [
      {
        languageCode: 'zh-Hant-TW',
        name: { simpleText: 'Safe label' },
        baseUrl: 'https://www.youtube.com/api/timedtext',
      },
    ],
    fetchError: namedError('NetworkError'),
  });
  assert.equal(valid.diagnostic.tracks.selectedLanguage, 'zh-Hant-TW');
});

test('unsupported caption URLs are classified without fetching them', async () => {
  let fetched = false;
  const context = makePageContext({
    baseUrl: 'https://example.test/api/timedtext?secret=value',
    trackIndex: 0,
  });
  context.fetch = async () => {
    fetched = true;
    return response(200, '{}');
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(source, sandbox);
  const result = await sandbox.lingoYouTube('load', { videoId: 'safe01', trackIndex: 0 });
  assert.equal(result.error.code, 'TRACK_FETCH_FAILED');
  assert.equal(result.diagnostic.timedText.outcome, 'unsupported-url');
  assert.equal(fetched, false);
  assert.equal(JSON.stringify(result).includes('example.test'), false);
});

test('early page failures return stable codes and the diagnostic skeleton', async () => {
  const changed = await run({ responseVideoId: 'stale01' });
  assert.equal(changed.error.code, 'PLAYER_RESPONSE_STALE');
  assert.equal(changed.error.stage, 'player-response');
  assert.equal(changed.diagnostic.page.responseFound, true);
  assert.equal((await run({ noPlayer: true })).error.code, 'PLAYER_NOT_READY');
  const context = vm.createContext(makePageContext({}));
  context.location = { href: 'https://www.youtube.com/watch?v=other01', pathname: '/watch' };
  vm.runInContext(source, context);
  const other = await context.lingoYouTube('load', { videoId: 'safe01' });
  assert.equal(other.error.code, 'VIDEO_CHANGED');
  assert.equal(other.diagnostic.page.videoMatches, false);
});

test('transcript walk is bounded and classifies known and unknown models', async () => {
  const legacy = await run({ action: 'transcript', panel: legacyRenderer });
  assert.equal(legacy.diagnostic.transcript.model, 'renderer');
  assert.equal(legacy.diagnostic.transcript.cueCount, 1);
  assert.equal(legacy.cues[0].text, 'Legacy cue');

  const modern = await run({ action: 'transcript', panel: modernViewModel });
  assert.equal(modern.diagnostic.transcript.model, 'view-model');
  assert.equal(modern.approximate, true);

  const unknown = await run({
    action: 'transcript',
    panel: cyclicUnknownModel,
    panelModelSelector: false,
    panelAfterOpen: true,
    opener: true,
  });
  assert.equal(unknown.error.code, 'TRANSCRIPT_UNKNOWN_MODEL');
  assert.equal(unknown.diagnostic.transcript.model, 'none');
  assert.ok(unknown.diagnostic.transcript.attempts <= 24);
  assert.equal(unknown.diagnostic.transcript.cueCount, 0);
});

test('transcript traversal handles deep models at and beyond the object limit', async () => {
  const deep = await run({ action: 'transcript', panel: deepRendererModel(12_000, true) });
  assert.equal(deep.error, undefined);
  assert.equal(deep.cues[0].text, 'Boundary cue');

  const exact = await run({ action: 'transcript', panel: deepRendererModel(50_000, true) });
  assert.equal(exact.error, undefined);
  assert.equal(exact.diagnostic.transcript.cueCount, 1);

  const over = await run({ action: 'transcript', panel: deepRendererModel(50_001, true) });
  assert.equal(over.error.code, 'TRANSCRIPT_ENTRY_MISSING');
  assert.equal(over.diagnostic.transcript.cueCount, 0);
});

test('wide traversal and cue limits stop before out-of-budget getters', async () => {
  const wide = {};
  for (let index = 0; index < 50_000; index++) wide[`child${index}`] = {};
  Object.defineProperty(wide, 'afterBudget', {
    enumerable: true,
    get() {
      throw new Error('OUT_OF_BUDGET_WIDE_GETTER');
    },
  });
  const wideResult = await run({ action: 'transcript', panel: wide });
  assert.equal(wideResult.error.code, 'TRANSCRIPT_ENTRY_MISSING');

  const exactCues = await run({ action: 'transcript', panel: rendererCues(5_000) });
  assert.equal(exactCues.cues.length, 5_000);
  assert.equal(exactCues.diagnostic.transcript.cueCount, 5_000);

  const overCues = rendererCues(5_000);
  Object.defineProperty(overCues, '5000', {
    enumerable: true,
    get() {
      throw new Error('OUT_OF_BUDGET_CUE_GETTER');
    },
  });
  const capped = await run({ action: 'transcript', panel: overCues });
  assert.equal(capped.cues.length, 5_000);
  assert.equal(capped.diagnostic.transcript.cueCount, 5_000);
});

test('DOM transcript rows remain the fallback when no panel model has cues', async () => {
  const result = await run({
    action: 'transcript',
    rows: [{ data: legacyRenderer.transcriptSegmentRenderer }],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.cues[0].text, 'Legacy cue');
  assert.equal(result.diagnostic.transcript.model, 'renderer');
});

test('video change during wait returns LOAD_CANCELLED without stale cues', async () => {
  const result = await run({
    action: 'transcript',
    opener: true,
    changeVideoAtAttempt: 2,
  });
  assert.equal(result.error.code, 'LOAD_CANCELLED');
  assert.equal(result.diagnostic.page.videoMatches, false);
  assert.equal('cues' in result, false);
});

test('load context changes cancel fetch, body, initial transcript and fallback races', async () => {
  const speech = JSON.stringify({ events: [{ segs: [{ utf8: 'Stale cue' }] }] });
  const cases = [
    { fetch: response(200, speech), changeVideoAfterFetch: true },
    { fetch: response(200, speech), changeVideoAfterBody: true },
    { fetch: response(200, speech), removeRootAfterFetch: true },
    { fetch: response(200, ''), removeRootAfterBody: true, panel: legacyRenderer },
    { action: 'transcript', removeRoot: true, panel: legacyRenderer },
  ];
  for (const options of cases) {
    const result = await run(options);
    assert.equal(result.error.code, 'LOAD_CANCELLED');
    assert.equal('json' in result, false);
    assert.equal('cues' in result, false);
  }
});
