/* Executed in the page's MAIN world, through chrome.scripting. No page-to-extension message bridge. */
async function lingoYouTube(action, options) {
  const currentId = () => new URL(location.href).searchParams.get('v');
  if (location.pathname !== '/watch' || currentId() !== options.videoId)
    return { error: 'Открыто другое видео.' };
  const player = document.querySelector('#movie_player');
  const video = player?.querySelector('video');
  if (!player || !video) return { error: 'Проигрыватель ещё не загрузился. Повторите попытку.' };
  const response = player.getPlayerResponse?.();
  const initial = window.ytInitialPlayerResponse;
  const data = response?.captions
    ? response
    : initial?.videoDetails?.videoId === options.videoId
      ? initial
      : response;
  if (data?.videoDetails?.videoId && data.videoDetails.videoId !== options.videoId)
    return { error: 'Дождитесь загрузки нового видео.' };
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const plain = (value) =>
    value?.simpleText ?? value?.runs?.map((r) => r.text ?? '').join('') ?? '';
  const label = (track) =>
    (plain(track.name) || track.languageCode) + (track.kind === 'asr' ? ' · автоматические' : '');
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
    };
  try {
    if (action !== 'transcript') {
      const selected = Number.isInteger(options.trackIndex)
        ? options.trackIndex
        : Math.max(
            0,
            tracks.findIndex((t) => t.languageCode === 'en' && t.kind !== 'asr') >= 0
              ? tracks.findIndex((t) => t.languageCode === 'en' && t.kind !== 'asr')
              : tracks.findIndex((t) => t.languageCode === 'en'),
          );
      const track = tracks[selected];
      if (track) {
        try {
          const url = new URL(track.baseUrl);
          if (
            url.protocol !== 'https:' ||
            !['www.youtube.com', 'youtube.com'].includes(url.hostname) ||
            url.pathname !== '/api/timedtext'
          ) {
            throw new Error('Unsupported caption URL');
          }
          url.searchParams.set('fmt', 'json3');
          const result = await fetch(url.href, {
            credentials: 'include',
            signal: AbortSignal.timeout(8000),
          });
          const text = await result.text();
          if (result.ok && text.trim()) {
            const json = JSON.parse(text);
            if (json.events?.some((e) => e.segs?.some((s) => s.utf8?.trim())))
              return { json, source: label(track), approximate: false };
          }
        } catch {
          /* A native transcript can still be available when timedtext is empty or blocked. */
        }
      }
      if (Number.isInteger(options.trackIndex))
        return {
          error:
            'YouTube не отдал эту дорожку. Выберите «Расшифровка YouTube» или «Автоматически».',
        };
    }

    const readTranscript = () => {
      const raw = [];
      let approximate = false;
      const walk = (value, seen = new WeakSet()) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (value.transcriptSegmentRenderer) {
          const cue = value.transcriptSegmentRenderer;
          raw.push({
            start: Number(cue.startMs) / 1000,
            end: Number(cue.endMs) / 1000,
            text: plain(cue.snippet),
          });
          return;
        }
        if (value.transcriptSegmentViewModel) {
          const cue = value.transcriptSegmentViewModel;
          const timestamp = cue.timestamp;
          if (/^\d+(?::\d{2}){1,2}$/.test(timestamp ?? '')) {
            raw.push({
              start: timestamp.split(':').reduce((n, part) => n * 60 + Number(part), 0),
              text: cue.simpleText ?? plain(cue.text),
            });
            approximate = true;
          }
          return;
        }
        for (const child of Object.values(value)) walk(child, seen);
      };
      // Read the complete panel model, rather than only the rows currently rendered in its viewport.
      for (const panel of document.querySelectorAll('ytd-engagement-panel-section-list-renderer')) {
        if (panel.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer'))
          walk(panel.data);
      }
      if (!raw.length) {
        for (const row of document.querySelectorAll('ytd-transcript-segment-renderer')) {
          const cue = row.data;
          if (cue)
            raw.push({
              start: Number(cue.startMs) / 1000,
              end: Number(cue.endMs) / 1000,
              text: plain(cue.snippet),
            });
        }
      }
      const unique = [...new Map(raw.map((c) => [c.start + '\n' + c.text, c])).values()].sort(
        (a, b) => a.start - b.start,
      );
      return {
        cues: unique.map((cue, i) => ({
          ...cue,
          end: Number.isFinite(cue.end)
            ? cue.end
            : (unique[i + 1]?.start ??
              (Number.isFinite(video.duration) && video.duration > cue.start
                ? video.duration
                : cue.start + 4)),
        })),
        approximate,
      };
    };
    let result = readTranscript();
    if (result.cues.length) return { ...result, source: 'Расшифровка YouTube · текущий язык' };
    const button = document.querySelector(
      'ytd-video-description-transcript-section-renderer button',
    );
    if (!button)
      return {
        error:
          'Субтитры недоступны. Откройте «Показать текст видео» в описании YouTube и повторите загрузку.',
      };
    const expanded = new Set([
      ...document.querySelectorAll(
        'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
      ),
    ]);
    button.click();
    try {
      for (let attempt = 0; attempt < 24; attempt++) {
        if (currentId() !== options.videoId || !document.getElementById('lingo-practice-root'))
          return { error: 'Загрузка отменена.' };
        result = readTranscript();
        if (result.cues.length) return { ...result, source: 'Расшифровка YouTube · текущий язык' };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      if (currentId() === options.videoId) {
        for (const panel of document.querySelectorAll(
          'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
        )) {
          if (
            !expanded.has(panel) &&
            panel.querySelector('transcript-segment-view-model, ytd-transcript-renderer')
          ) {
            panel.querySelector('#visibility-button button')?.click();
          }
        }
      }
    }
    return {
      error:
        'YouTube не загрузил текст субтитров. Попробуйте открыть расшифровку вручную или выбрать другое видео.',
    };
  } catch {
    return { error: 'Не удалось прочитать субтитры. Обновите страницу и повторите попытку.' };
  }
}
