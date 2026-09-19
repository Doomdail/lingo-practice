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

function makePageContext(options) {
  let href = 'https://www.youtube.com/watch?v=safe01';
  let waitCount = 0;
  let openerClicked = false;
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
      return id === 'lingo-practice-root' && !options.removeRoot ? {} : null;
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
      return options.fetch ?? response(200, '');
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
