/* Executed in the page's MAIN world, through chrome.scripting. No page-to-extension message bridge. */
async function lingoYouTube(action, options) {
  const PANEL_SELECTOR = 'ytd-engagement-panel-section-list-renderer';
  const ROW_SELECTOR = 'ytd-transcript-segment-renderer';
  const MODEL_SELECTOR = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
  const OPENER_SELECTOR = 'ytd-video-description-transcript-section-renderer button';
  const CLOSE_SELECTOR = '#visibility-button button';
  const currentId = () => new URL(location.href).searchParams.get('v');
  const diagnostic = {
    schema: 1,
    requestedSource:
      action === 'transcript'
        ? 'transcript'
        : Number.isInteger(options.trackIndex)
          ? 'track'
          : 'auto',
    page: {
      watchPage: location.pathname === '/watch',
      playerFound: false,
      videoFound: false,
      responseFound: false,
      videoMatches: currentId() === options.videoId,
    },
    tracks: { count: 0, selectedLanguage: null, selectedAutomatic: null },
    timedText: { outcome: 'not-attempted', httpStatus: null },
    transcript: { model: 'none', openerFound: false, attempts: 0, cueCount: 0 },
  };
  const failure = (code, messageKey, stage, retryable) => ({
    error: { code, messageKey, stage, retryable },
    diagnostic,
  });
  const plain = (value) =>
    value?.simpleText ?? value?.runs?.map((run) => run.text ?? '').join('') ?? '';
  const label = (track) =>
    (plain(track.name) || track.languageCode) + (track.kind === 'asr' ? ' · автоматические' : '');

  if (!diagnostic.page.watchPage || !diagnostic.page.videoMatches)
    return failure('VIDEO_CHANGED', 'Открыто другое видео.', 'page', true);

  try {
    const player = document.querySelector('#movie_player');
    diagnostic.page.playerFound = Boolean(player);
    const video = player?.querySelector('video');
    diagnostic.page.videoFound = Boolean(video);
    if (!player || !video)
      return failure(
        'PLAYER_NOT_READY',
        'Проигрыватель ещё не загрузился. Повторите попытку.',
        'player',
        true,
      );

    const response = player.getPlayerResponse?.();
    const initial = window.ytInitialPlayerResponse;
    const data = response?.captions
      ? response
      : initial?.videoDetails?.videoId === options.videoId
        ? initial
        : response;
    diagnostic.page.responseFound = Boolean(data);
    if (data?.videoDetails?.videoId && data.videoDetails.videoId !== options.videoId)
      return failure(
        'PLAYER_RESPONSE_STALE',
        'Дождитесь загрузки нового видео.',
        'player-response',
        true,
      );

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    diagnostic.tracks.count = tracks.length;
    if (action === 'tracks')
      return {
        title:
          data?.videoDetails?.title ||
          player.getVideoData?.().title ||
          document.title.replace(/ - YouTube$/, ''),
        tracks: tracks.map((track, index) => ({
          index,
          label: label(track),
          language: track.languageCode,
          automatic: track.kind === 'asr',
        })),
        diagnostic,
      };

    if (action !== 'transcript') {
      const preferredManual = tracks.findIndex(
        (track) => track.languageCode === 'en' && track.kind !== 'asr',
      );
      const preferredEnglish = tracks.findIndex((track) => track.languageCode === 'en');
      const selected = Number.isInteger(options.trackIndex)
        ? options.trackIndex
        : Math.max(0, preferredManual >= 0 ? preferredManual : preferredEnglish);
      const track = tracks[selected];
      if (track) {
        diagnostic.tracks.selectedLanguage = track.languageCode ?? null;
        diagnostic.tracks.selectedAutomatic = track.kind === 'asr';
        let url;
        try {
          url = new URL(track.baseUrl);
        } catch {
          diagnostic.timedText.outcome = 'unsupported-url';
        }
        if (
          url &&
          (url.protocol !== 'https:' ||
            !['www.youtube.com', 'youtube.com'].includes(url.hostname) ||
            url.pathname !== '/api/timedtext')
        ) {
          diagnostic.timedText.outcome = 'unsupported-url';
          url = null;
        }
        if (url) {
          url.searchParams.set('fmt', 'json3');
          try {
            const timedText = await fetch(url.href, {
              credentials: 'include',
              signal: AbortSignal.timeout(8000),
            });
            diagnostic.timedText.httpStatus = timedText.status;
            const text = await timedText.text();
            if (!timedText.ok) diagnostic.timedText.outcome = 'http-error';
            else if (!text.trim()) diagnostic.timedText.outcome = 'empty';
            else {
              try {
                const json = JSON.parse(text);
                const hasSpeech =
                  Array.isArray(json?.events) &&
                  json.events.some(
                    (event) =>
                      Array.isArray(event?.segs) &&
                      event.segs.some((segment) => segment?.utf8?.trim()),
                  );
                if (hasSpeech) {
                  diagnostic.timedText.outcome = 'success';
                  return {
                    json,
                    source: label(track),
                    approximate: false,
                    diagnostic,
                  };
                }
                diagnostic.timedText.outcome = 'empty';
              } catch {
                diagnostic.timedText.outcome = 'invalid-json';
              }
            }
          } catch (error) {
            diagnostic.timedText.outcome =
              error?.name === 'TimeoutError' ? 'timeout' : 'network-error';
          }
        }
      }
      if (Number.isInteger(options.trackIndex))
        return failure(
          'TRACK_FETCH_FAILED',
          'YouTube не отдал эту дорожку. Выберите «Расшифровка YouTube» или «Автоматически».',
          'timedtext',
          true,
        );
    }

    let expanded = new Set(),
      unknownModelObserved = false;
    const readTranscript = (includeNewPanels = false) => {
      const MAX_VISITED = 50_000,
        MAX_CUES = 5_000;
      const raw = [];
      let approximate = false,
        visited = 0,
        model = 'none';
      const observe = (variant) => {
        if (model === 'none') model = variant;
        else if (model !== variant) model = 'mixed';
      };
      const pushRenderer = (value) => {
        const cue = value.transcriptSegmentRenderer;
        const start = Number(cue?.startMs) / 1000;
        const text = plain(cue?.snippet).trim();
        if (!Number.isFinite(start) || !text || raw.length >= MAX_CUES) return;
        raw.push({ start, end: Number(cue.endMs) / 1000, text });
      };
      const pushViewModel = (value) => {
        const cue = value.transcriptSegmentViewModel;
        const timestamp = cue?.timestamp;
        const text = (cue?.simpleText ?? plain(cue?.text)).trim();
        if (!/^\d+(?::\d{2}){1,2}$/.test(timestamp ?? '') || !text) return;
        raw.push({
          start: timestamp.split(':').reduce((total, part) => total * 60 + Number(part), 0),
          text,
        });
        approximate = true;
      };
      const walk = (value, seen = new WeakSet()) => {
        if (
          !value ||
          typeof value !== 'object' ||
          seen.has(value) ||
          visited++ >= MAX_VISITED ||
          raw.length >= MAX_CUES
        )
          return;
        seen.add(value);
        if (value.transcriptSegmentRenderer) {
          observe('renderer');
          pushRenderer(value);
          return;
        }
        if (value.transcriptSegmentViewModel) {
          observe('view-model');
          pushViewModel(value);
          return;
        }
        for (const child of Object.values(value)) walk(child, seen);
      };

      const newlyExpanded = includeNewPanels
        ? new Set([
            ...document.querySelectorAll(
              `${PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`,
            ),
          ])
        : new Set();
      for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
        const knownModel = Boolean(panel.querySelector(MODEL_SELECTOR));
        const unknownNewPanel =
          includeNewPanels && newlyExpanded.has(panel) && !expanded.has(panel) && !knownModel;
        if (!knownModel && !unknownNewPanel) continue;
        if (unknownNewPanel) unknownModelObserved = true;
        walk(panel.data);
      }
      if (!raw.length) {
        for (const row of document.querySelectorAll(ROW_SELECTOR)) {
          if (!row.data || raw.length >= MAX_CUES) continue;
          observe('renderer');
          pushRenderer({ transcriptSegmentRenderer: row.data });
        }
      }
      if (model !== 'none') {
        const observed = diagnostic.transcript.model;
        diagnostic.transcript.model =
          observed === 'none' || observed === model
            ? model
            : observed === 'mixed'
              ? observed
              : 'mixed';
      }
      const unique = [
        ...new Map(raw.map((cue) => [cue.start + '\n' + cue.text, cue])).values(),
      ].sort((a, b) => a.start - b.start);
      diagnostic.transcript.cueCount = unique.length;
      return {
        cues: unique.map((cue, index) => ({
          ...cue,
          end: Number.isFinite(cue.end)
            ? cue.end
            : (unique[index + 1]?.start ??
              (Number.isFinite(video.duration) && video.duration > cue.start
                ? video.duration
                : cue.start + 4)),
        })),
        approximate,
      };
    };

    let result = readTranscript();
    if (result.cues.length)
      return {
        ...result,
        source: 'Расшифровка YouTube · текущий язык',
        diagnostic,
      };
    const button = document.querySelector(OPENER_SELECTOR);
    diagnostic.transcript.openerFound = Boolean(button);
    if (!button)
      return failure(
        'TRANSCRIPT_ENTRY_MISSING',
        'Субтитры недоступны. Откройте «Показать текст видео» в описании YouTube и повторите загрузку.',
        'transcript-entry',
        false,
      );

    expanded = new Set([
      ...document.querySelectorAll(
        `${PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`,
      ),
    ]);
    button.click();
    const loadCancelled = () => {
      diagnostic.page.videoMatches = currentId() === options.videoId;
      return !diagnostic.page.videoMatches || !document.getElementById('lingo-practice-root');
    };
    try {
      for (let attempt = 0; attempt < 24; attempt++) {
        diagnostic.transcript.attempts = attempt + 1;
        if (loadCancelled())
          return failure('LOAD_CANCELLED', 'Загрузка отменена.', 'transcript-wait', false);
        result = readTranscript(true);
        if (result.cues.length)
          return {
            ...result,
            source: 'Расшифровка YouTube · текущий язык',
            diagnostic,
          };
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (loadCancelled())
          return failure('LOAD_CANCELLED', 'Загрузка отменена.', 'transcript-wait', false);
      }
    } finally {
      if (currentId() === options.videoId) {
        for (const panel of document.querySelectorAll(
          `${PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`,
        )) {
          if (!expanded.has(panel)) panel.querySelector(CLOSE_SELECTOR)?.click();
        }
      }
    }
    return unknownModelObserved && diagnostic.transcript.model === 'none'
      ? failure(
          'TRANSCRIPT_UNKNOWN_MODEL',
          'YouTube использует неизвестный формат расшифровки. Повторите попытку позже.',
          'transcript-model',
          true,
        )
      : failure(
          'TRANSCRIPT_TIMEOUT',
          'YouTube не загрузил текст субтитров. Попробуйте открыть расшифровку вручную или выбрать другое видео.',
          'transcript-wait',
          true,
        );
  } catch {
    return failure(
      'CAPTION_READ_FAILED',
      'Не удалось прочитать субтитры. Обновите страницу и повторите попытку.',
      'caption-read',
      true,
    );
  }
}
