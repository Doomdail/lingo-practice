const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../youtube.js'), 'utf8');

function page({ openerAfter = 2, changeAfter = Infinity } = {}) {
  let href = 'https://www.youtube.com/watch?v=video01';
  let waits = 0;
  let opened = false;
  const video = { duration: 10 };
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
    URL, AbortSignal, window: {},
    location: { get href() { return href; }, pathname: '/watch' },
    document: {
      querySelector(selector) {
        if (selector === '#movie_player') return player;
        if (selector === 'ytd-video-description-transcript-section-renderer button' && waits >= openerAfter)
          return { click() { opened = true; } };
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'ytd-transcript-segment-renderer' && opened)
          return [{ data: { startMs: '1000', endMs: '2500', snippet: { simpleText: 'Hello world' } } }];
        return [];
      },
      getElementById: () => ({}),
    },
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    setTimeout(resolve) {
      waits++;
      if (waits === changeAfter) href = 'https://www.youtube.com/watch?v=other';
      resolve();
    },
  });
  vm.runInContext(source, context);
  return { load: (trackIndex) => context.lingoYouTube('load', { videoId: 'video01', trackIndex }), waits: () => waits };
}

test('automatic captions wait for a late YouTube transcript opener', async () => {
  const tab = page();
  const result = await tab.load();
  assert.equal(result.error, undefined);
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0].text, 'Hello world');
  assert.ok(tab.waits() >= 2);
});

test('waiting for the transcript opener stops when the video changes', async () => {
  const result = await page({ openerAfter: 3, changeAfter: 1 }).load();
  assert.equal(result.error.code, 'LOAD_CANCELLED');
  assert.equal(result.cues, undefined);
});

test('missing transcript opener returns after a bounded wait', async () => {
  const tab = page({ openerAfter: Infinity });
  const result = await tab.load();
  assert.equal(result.error.code, 'TRANSCRIPT_ENTRY_MISSING');
  assert.ok(tab.waits() > 0 && tab.waits() <= 24);
});

test('a chosen caption track fails without waiting for transcript fallback', async () => {
  const tab = page({ openerAfter: Infinity });
  assert.equal((await tab.load(0)).error.code, 'TRACK_FETCH_FAILED');
  assert.equal(tab.waits(), 0);
});
