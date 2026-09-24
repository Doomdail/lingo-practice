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
    const cancellation = (stage) => {
      diagnostic.page.videoMatches = currentId() === options.videoId;
      return !diagnostic.page.videoMatches ||
        document.querySelector('#movie_player') !== player ||
        player.querySelector('video') !== video ||
        !document.getElementById('lingo-practice-root')
        ? failure('LOAD_CANCELLED', 'Загрузка отменена.', stage, false)
        : null;
    };
    let cancelled = cancellation('load');
    if (cancelled) return cancelled;

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

    const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const tracks = Array.isArray(captionTracks) ? captionTracks : [];
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
        const language = track.languageCode;
        diagnostic.tracks.selectedLanguage =
          typeof language === 'string' &&
          language.length <= 64 &&
          /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)
            ? language
            : null;
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
            cancelled = cancellation('timedtext');
            if (cancelled) return cancelled;
            diagnostic.timedText.httpStatus =
              Number.isInteger(timedText.status) &&
              timedText.status >= 100 &&
              timedText.status <= 599
                ? timedText.status
                : null;
            const text = await timedText.text();
            cancelled = cancellation('timedtext');
            if (cancelled) return cancelled;
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
                  cancelled = cancellation('timedtext');
                  if (cancelled) return cancelled;
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
      cancelled = cancellation('timedtext');
      if (cancelled) return cancelled;
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
        enumerated = 0,
        model = 'none';
      const seen = new WeakSet();
      const exhausted = () =>
        visited >= MAX_VISITED || enumerated >= MAX_VISITED || raw.length >= MAX_CUES;
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
      const children = function* (value) {
        for (const key in value) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
          if (enumerated >= MAX_VISITED) return;
          enumerated++;
          yield value[key];
        }
      };
      const walk = (root) => {
        const stack = [{ value: root }];
        while (stack.length && !exhausted()) {
          const frame = stack.pop();
          if (frame.iterator) {
            const child = frame.iterator.next();
            if (!child.done) stack.push(frame, { value: child.value });
            continue;
          }
          const value = frame.value;
          if (!value || typeof value !== 'object' || seen.has(value)) continue;
          seen.add(value);
          visited++;
          if (value.transcriptSegmentRenderer) {
            observe('renderer');
            pushRenderer(value);
            continue;
          }
          if (value.transcriptSegmentViewModel) {
            observe('view-model');
            pushViewModel(value);
            continue;
          }
          stack.push({ iterator: children(value) });
        }
      };

      const newlyExpanded = includeNewPanels
        ? new Set([
            ...document.querySelectorAll(
              `${PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`,
            ),
          ])
        : new Set();
      for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
        if (exhausted()) break;
        const knownModel = Boolean(panel.querySelector(MODEL_SELECTOR));
        const unknownNewPanel =
          includeNewPanels && newlyExpanded.has(panel) && !expanded.has(panel) && !knownModel;
        if (!knownModel && !unknownNewPanel) continue;
        if (unknownNewPanel) unknownModelObserved = true;
        walk(panel.data);
      }
      if (!raw.length && !exhausted()) {
        for (const row of document.querySelectorAll(ROW_SELECTOR)) {
          if (exhausted()) break;
          visited++;
          if (!row.data) continue;
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

    cancelled = cancellation('transcript');
    if (cancelled) return cancelled;
    let result = readTranscript();
    cancelled = cancellation('transcript');
    if (cancelled) return cancelled;
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
    cancelled = cancellation('transcript-entry');
    if (cancelled) return cancelled;
    button.click();
    try {
      for (let attempt = 0; attempt < 24; attempt++) {
        diagnostic.transcript.attempts = attempt + 1;
        cancelled = cancellation('transcript-wait');
        if (cancelled) return cancelled;
        result = readTranscript(true);
        cancelled = cancellation('transcript-wait');
        if (cancelled) return cancelled;
        if (result.cues.length)
          return {
            ...result,
            source: 'Расшифровка YouTube · текущий язык',
            diagnostic,
          };
        await new Promise((resolve) => setTimeout(resolve, 250));
        cancelled = cancellation('transcript-wait');
        if (cancelled) return cancelled;
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
