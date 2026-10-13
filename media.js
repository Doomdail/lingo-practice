(function (root) {
  'use strict';
  const send = async (action, payload = {}) => {
    const result = await chrome.runtime.sendMessage({ type: 'LINGO_PANEL', action, ...payload });
    if (!result || result.error)
      throw Object.assign(new Error(result?.error || 'Не удалось связаться с видео.'), { code: result?.code });
    return result;
  };
  async function connect() {
    let initial;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { initial = await send('init'); break; }
      catch (error) {
        if (error.code !== 'PANEL_STARTING' || attempt === 29) throw error;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    }
    if (!/^[\w-]{1,64}$/.test(initial?.videoId) || !initial.media)
      throw new Error('Не удалось связаться с видео.');
    const video = new EventTarget();
    let state = {}, queue = Promise.resolve(), pending = 0, configuration = '';
    function update(value) {
      if (!value || typeof value.connected !== 'boolean') throw new Error('Некорректное состояние видео.');
      const previous = state;
      if (!value.connected) {
        state = { ...previous, connected: false, paused: true };
        if (previous.connected !== false) video.dispatchEvent(new Event('disconnect'));
        return;
      }
      const number = (key, fallback, min, max) =>
        Number.isFinite(value[key]) && value[key] >= min && value[key] <= max ? value[key] : fallback;
      state = {
        connected: value.connected,
        currentTime: number('currentTime', previous.currentTime ?? 0, 0, 604860),
        duration: number('duration', previous.duration ?? 0, 0, 604860),
        playbackRate: number('playbackRate', previous.playbackRate ?? 1, .0625, 16),
        readyState: number('readyState', 0, 0, 4),
        paused: value.paused === true, ended: value.ended === true,
        seeking: value.seeking === true, adPlaying: value.adPlaying === true,
      };
      if (previous.connected === false) video.dispatchEvent(new Event('reconnect'));
      if (previous.paused !== undefined && previous.paused !== state.paused)
        video.dispatchEvent(new Event(state.paused ? 'pause' : 'play'));
      if (!state.seeking && (previous.seeking || (previous.connected && previous.paused &&
          state.paused && previous.currentTime !== state.currentTime)))
        video.dispatchEvent(new Event('seeked'));
      if (!previous.readyState && state.readyState) video.dispatchEvent(new Event('loadedmetadata'));
      video.dispatchEvent(new Event('timeupdate'));
      if (!previous.ended && state.ended) video.dispatchEvent(new Event('ended'));
    }
    function command(value) {
      pending++;
      const operation = queue.then(() => send('media', { command: value }));
      queue = operation.catch(() => {});
      return operation.then(result => {
        pending--;
        // Suppress intermediate pause/rate snapshots during an ordered replay sequence.
        if (!pending) update(result.media);
        return result.media;
      }, error => { pending--; throw error; });
    }
    for (const key of ['currentTime', 'duration', 'playbackRate', 'readyState', 'paused', 'ended', 'seeking', 'adPlaying'])
      Object.defineProperty(video, key, { get: () => state[key],
        ...(key === 'currentTime' ? { set: time => {
          if (!Number.isFinite(time) || time < 0 || time > 604860) return;
          state.currentTime = time;
          command({ action: 'seek', time }).catch(() => {});
        }} : {}) });
    Object.defineProperty(video, 'isConnected', { get: () => state.connected });
    const playCommand = async value => {
      const result = await command(value);
      if (!result.connected || result.paused) throw new Error('Нажмите кнопку воспроизведения на видео.');
      return result;
    };
    video.play = () => playCommand({ action: 'play' });
    video.pause = () => { command({ action: 'pause' }).catch(() => {}); };
    video.restoreRate = () => command({ action: 'restoreRate' }).catch(() => {});
    video.replay = (start, end, slow = false, pauseAtEnd = false) =>
      playCommand({ action: 'replay', start, end, slow, pauseAtEnd });
    update(initial.media);
    return {
      videoId: initial.videoId, video,
      markDisconnected: () => update({ connected: false }),
      reconnect: () => {
        pending++;
        const operation = queue.then(() => send('init'));
        queue = operation.catch(() => {});
        return operation.then(result => {
          pending--;
          if (result.videoId !== initial.videoId) throw new Error('Открыто другое видео.');
          configuration = '';
          update(result.media);
        }, error => { pending--; throw error; });
      },
      poll: () => pending ? Promise.resolve() : command({ action: 'state' }),
      configure: (videoSize, gate) => {
        const next = JSON.stringify({ videoSize, gate });
        if (next === configuration) return Promise.resolve();
        configuration = next;
        return command({ action: 'configure', videoSize, gate }).catch(error => {
          configuration = ''; throw error;
        });
      },
      close: () => send('close'),
    };
  }
  root.LingoMedia = { connect };
})(globalThis);
