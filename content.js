(function () {
  'use strict';
  const videoId = new URL(location.href).searchParams.get('v');
  if (globalThis.LingoMediaBridge) {
    if (location.pathname === '/watch' && globalThis.LingoMediaBridge.videoId === videoId) return {videoId};
    globalThis.LingoMediaBridge.close();
  }
  // An unpacked update may leave the earlier lesson's isolated world alive until reload.
  globalThis.LingoLesson?.close();
  if (location.pathname !== '/watch' || !/^[\w-]{1,64}$/.test(videoId ?? '')) return;
  const abort = new AbortController();
  let player, video, mediaAbort, disposed = false, previousTime = 0, gate = null, slowReplay = null;
  const validTime = value => Number.isFinite(value) && value >= 0 && value <= 604860;
  const marker = document.createElement('div');
  marker.id = 'lingo-practice-root';
  marker.setAttribute('aria-hidden', 'true');
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `
    html.lp-active { --lp-width:min(1100px,calc(100vw - 40px),113.778vh); --lp-height:min(618.75px,calc((100vw - 40px)*9/16),64vh); }
    /* A navigation snapshot otherwise intercepts the live player's controls. */
    html.lp-active::view-transition { display:none!important; }
    html.lp-active body { overflow:hidden!important; }
    html.lp-active body > :not(#lingo-practice-root) { visibility:hidden!important; }
    html.lp-active body > ytd-app { position:relative!important; z-index:2147483001!important; pointer-events:none!important; }
    html.lp-active #lingo-practice-root { visibility:visible!important; position:fixed!important; inset:0!important; z-index:2147483000!important; background:#11141a!important; pointer-events:none!important; }
    html.lp-active .lp-player { visibility:visible!important; pointer-events:auto!important; position:fixed!important; top:50%!important; left:50%!important; transform:translate(-50%,-50%)!important; width:var(--lp-width)!important; height:var(--lp-height)!important; min-height:0!important; margin:0!important; z-index:2147483001!important; border-radius:14px!important; overflow:hidden!important; box-shadow:0 12px 60px #0007!important; }
    html.lp-active .lp-player .html5-video-container { width:100%!important; height:100%!important; }
    html.lp-active .lp-player video { width:100%!important; height:100%!important; left:0!important; top:0!important; object-fit:contain!important; }
    html.lp-active .lp-player .caption-window-container, html.lp-active .lp-player .ytp-caption-window-container { display:none!important; }
    html.lp-active .lp-player .ytp-fullscreen-button, html.lp-active .lp-player .ytp-size-button, html.lp-active .lp-player .ytp-miniplayer-button { display:none!important; }
  `;
  const layoutStyle = document.createElement('style');
  document.head.append(pageStyle, layoutStyle);
  document.body.append(marker);
  document.documentElement.classList.add('lp-active');
  function connected() {
    return !disposed && location.pathname === '/watch' && new URL(location.href).searchParams.get('v') === videoId;
  }
  const isAd = () => player?.classList.contains('ad-showing') === true || player?.classList.contains('ad-interrupting') === true;
  function restoreRate() {
    const previous = slowReplay;
    slowReplay = null;
    if (previous && previous.video.playbackRate === 0.75) previous.video.playbackRate = previous.rate;
  }
  function state() {
    tick();
    const active = connected() && video?.isConnected === true && player?.contains(video);
    const seconds = value => validTime(value) ? value : 0;
    return {connected:active === true, currentTime:active ? seconds(video.currentTime) : 0,
      duration:active ? seconds(video.duration) : 0, paused:!active || video.paused !== false,
      ended:active && video.ended === true, seeking:active && video.seeking === true,
      readyState:active && Number.isInteger(video.readyState) && video.readyState >= 0 && video.readyState <= 4 ? video.readyState : 0,
      playbackRate:active && Number.isFinite(video.playbackRate) && video.playbackRate >= 0.0625 && video.playbackRate <= 16 ? video.playbackRate : 1,
      adPlaying:active && isAd()};
  }
  function close() {
    if (disposed) return;
    disposed = true;
    gate = null;
    restoreRate();
    abort.abort();
    mediaAbort?.abort();
    clearInterval(interval);
    chrome.runtime.onMessage.removeListener(receive);
    player?.classList.remove('lp-player');
    document.documentElement.classList.remove('lp-active');
    marker.remove(); pageStyle.remove(); layoutStyle.remove();
    delete globalThis.LingoMediaBridge;
    window.dispatchEvent(new Event('resize'));
  }
  function bindMedia() {
    mediaAbort?.abort();
    mediaAbort = new AbortController();
    for (const type of ['timeupdate','loadedmetadata','seeked','ended'])
      video.addEventListener(type,tick,{signal:mediaAbort.signal});
    video.addEventListener('pause',restoreRate,{signal:mediaAbort.signal});
    video.addEventListener('seeking',() => { previousTime = video.currentTime; },{signal:mediaAbort.signal});
  }
  function tick() {
    if (!connected()) { close(); return; }
    if (!video?.isConnected || !player?.isConnected || !player.contains(video)) {
      const replacement = document.querySelector('#movie_player'), media = replacement?.querySelector('video');
      if (!media) return;
      restoreRate(); player?.classList.remove('lp-player');
      player = replacement; video = media;
      player.classList.add('lp-player'); previousTime = video.currentTime;
      bindMedia();
    }
    const time = video.currentTime;
    if (isAd()) { restoreRate(); previousTime = time; return; }
    if (slowReplay && (time >= slowReplay.end || time < slowReplay.start - 0.25 || video.ended)) restoreRate();
    // The source enforces numeric end gates even while the practice window is throttled.
    if (gate && !video.seeking && !video.paused && (video.ended || time >= gate.end) &&
        (gate.force || (previousTime < gate.end && time - previousTime < 1.5))) video.pause();
    previousTime = time;
  }
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (['state','play','pause','restoreRate','close'].includes(value.action)) return {action:value.action};
    if (value.action === 'seek' && validTime(value.time)) return {action:'seek',time:value.time};
    if (value.action === 'replay' && validTime(value.start) && validTime(value.end) && value.end > value.start &&
        typeof value.slow === 'boolean' && typeof value.pauseAtEnd === 'boolean')
      return {action:'replay',start:value.start,end:value.end,slow:value.slow,pauseAtEnd:value.pauseAtEnd};
    if (value.action === 'configure' && ['small','medium','large'].includes(value.videoSize)) {
      const valueGate = value.gate;
      if (valueGate === null) return {action:'configure',videoSize:value.videoSize,gate:null};
      if (valueGate && validTime(valueGate.start) && validTime(valueGate.end) && valueGate.end > valueGate.start && typeof valueGate.force === 'boolean')
        return {action:'configure',videoSize:value.videoSize,gate:{start:valueGate.start,end:valueGate.end,force:valueGate.force}};
    }
    return null;
  }
  async function apply(command) {
    if (command.action === 'close') { close(); return state(); }
    tick();
    if (!connected() || !video?.isConnected) return state();
    if (command.action === 'configure') {
      const height = {small:48,medium:64,large:80}[command.videoSize];
      layoutStyle.textContent = `html.lp-active { --lp-width:min(1100px,calc(100vw - 40px),${height*16/9}vh); --lp-height:min(618.75px,calc((100vw - 40px)*9/16),${height}vh); }`;
      gate = command.gate;
      window.dispatchEvent(new Event('resize'));
    } else if (command.action === 'restoreRate') restoreRate();
    else if (command.action !== 'state' && !isAd()) {
      if (command.action === 'play') await video.play();
      if (command.action === 'pause') {video.pause(); restoreRate();}
      if (command.action === 'seek') {
        restoreRate(); gate = null;
        video.currentTime = Number.isFinite(video.duration) ? Math.min(command.time,Math.max(0,video.duration-0.05)) : command.time;
        previousTime = video.currentTime;
      }
      if (command.action === 'replay') {
        restoreRate();
        gate = command.pauseAtEnd ? {start:command.start,end:command.end,force:true} : null;
        if (command.slow) {
          slowReplay = {video,rate:video.playbackRate,start:command.start,end:command.end};
          video.playbackRate = 0.75;
        }
        video.currentTime = Math.min(command.start,Number.isFinite(video.duration) ? Math.max(0,video.duration-0.05) : command.start);
        previousTime = video.currentTime;
        await video.play();
      }
    }
    return state();
  }
  function receive(message,sender,sendResponse) {
    // Content senders have a tab; only our worker may command this bridge.
    if (disposed || sender?.id !== chrome.runtime.id || sender.tab ||
        (sender.url !== undefined && sender.url !== chrome.runtime.getURL('background.js')) ||
        message?.type !== 'LINGO_MEDIA' || message.videoId !== videoId) return;
    const command = validate(message.command);
    if (!command) return;
    apply(command).then(sendResponse).catch(() => {restoreRate(); sendResponse(state());});
    return true;
  }
  chrome.runtime.onMessage.addListener(receive);
  const guardKeys = event => {
    if (!disposed && (event.code.startsWith('Numpad') || event.location === 3)) {
      event.stopImmediatePropagation(); event.preventDefault();
    }
  };
  for (const type of ['keydown','keyup','keypress'])
    window.addEventListener(type,guardKeys,{capture:true,signal:abort.signal});
  document.addEventListener('yt-navigate-finish',tick,{signal:abort.signal});
  window.addEventListener('pagehide',close,{signal:abort.signal});
  const interval = setInterval(tick,100);
  globalThis.LingoMediaBridge = {close,videoId};
  tick();
  window.dispatchEvent(new Event('resize'));
  return {videoId};
})();
