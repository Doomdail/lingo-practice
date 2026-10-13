'use strict';
importScripts('youtube.js', 'exercise.js', 'data.js');
const bindings = new Map(), openings = new Map(), pendingTokens = new Set();
const validVideoId = (value) => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
const videoFromUrl = (value) => {
  try {
    const url = new URL(value);
    const id = url.searchParams.get('v');
    return url.origin === 'https://www.youtube.com' && url.pathname === '/watch' && validVideoId(id) ? id : null;
  } catch { return null; }
};
const validId = (value) => Number.isInteger(value) && value >= 0;
const panelUrl = (token) => chrome.runtime.getURL('practice.html') + '#' + token;
// Without "tabs", Chrome omits extension-page URLs from tabs.get (but not MessageSender).
const panelTabMatches = (tab,binding) => tab?.id === binding.panelTabId && tab.windowId === binding.windowId &&
  (tab.url === undefined || tab.url === panelUrl(binding.token));
const validBinding = (value) => value && validId(value.tabId) && validId(value.panelTabId) &&
  validId(value.windowId) && validVideoId(value.videoId) && typeof value.documentId === 'string' &&
  value.documentId.length > 0 && typeof value.token === 'string' && /^[\w-]{36}$/.test(value.token);
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]).then(async () => {
  const stored = await chrome.storage.session.get('practiceBindings');
  for (const binding of Array.isArray(stored.practiceBindings) ? stored.practiceBindings : []) {
    if (!validBinding(binding)) continue;
    try {
      const panel = await chrome.tabs.get(binding.panelTabId);
      await chrome.windows.get(binding.windowId);
      if (!panelTabMatches(panel,binding)) throw new Error('Panel changed');
      binding.panelInactive = true;
      bindings.set(binding.tabId, binding);
    } catch { await bridgeMessage(binding,{action:'close'}); }
  }
  await persistBindings();
});
// Every private operation awaits this promise and fails closed on storage rejection.
storageReady.catch(() => {});
let storageQueue = Promise.resolve(), bindingQueue = Promise.resolve();
const persistBindings = () => {
  const snapshot = [...bindings.values()].map(({ mediaQueue, port, ...binding }) => binding);
  const operation = bindingQueue.then(() => chrome.storage.session.set({ practiceBindings: snapshot }));
  bindingQueue = operation.catch(() => {});
  return operation;
};
const disconnectedMedia = () => ({ connected:false, currentTime:0, duration:0, paused:true,
  ended:false, seeking:false, readyState:0, playbackRate:1, adPlaying:false });
function sanitizeMedia(value) {
  if (value?.connected !== true) return disconnectedMedia();
  const seconds = (number) => Number.isFinite(number) && number >= 0 && number <= 604860 ? number : 0;
  return { connected:true, currentTime:seconds(value.currentTime), duration:seconds(value.duration),
    paused:value.paused !== false, ended:value.ended === true, seeking:value.seeking === true,
    readyState:Number.isInteger(value.readyState) && value.readyState >= 0 && value.readyState <= 4 ? value.readyState : 0,
    playbackRate:Number.isFinite(value.playbackRate) && value.playbackRate >= 0.0625 && value.playbackRate <= 16 ? value.playbackRate : 1,
    adPlaying:value.adPlaying === true };
}
const validTime = (value) => Number.isFinite(value) && value >= 0 && value <= 604860;
function mediaCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (['state','play','pause','restoreRate'].includes(value.action)) return { action:value.action };
  if (value.action === 'seek' && validTime(value.time)) return { action:'seek', time:value.time };
  if (value.action === 'replay' && validTime(value.start) && validTime(value.end) && value.end > value.start &&
      typeof value.slow === 'boolean' && typeof value.pauseAtEnd === 'boolean')
    return { action:'replay', start:value.start, end:value.end, slow:value.slow, pauseAtEnd:value.pauseAtEnd };
  if (value.action === 'configure' && ['small','medium','large'].includes(value.videoSize)) {
    if (value.gate === null) return { action:'configure', videoSize:value.videoSize, gate:null };
    const gate = value.gate;
    if (gate && validTime(gate.start) && validTime(gate.end) && gate.end > gate.start && typeof gate.force === 'boolean')
      return { action:'configure', videoSize:value.videoSize, gate:{start:gate.start,end:gate.end,force:gate.force} };
  }
  return null;
}
async function withinDeadline(promise, milliseconds = 3000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Media timeout')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function sourceMatches(binding) {
  try { return videoFromUrl((await chrome.tabs.get(binding.tabId)).url) === binding.videoId; }
  catch { return false; }
}
function bridgeMessage(binding, command) {
  const operation = (binding.mediaQueue ?? Promise.resolve()).then(async () => {
    if (command.action !== 'close' && !await sourceMatches(binding)) return disconnectedMedia();
    try {
      return sanitizeMedia(await withinDeadline(chrome.tabs.sendMessage(binding.tabId,
        { type:'LINGO_MEDIA', videoId:binding.videoId, command }, { documentId:binding.documentId })));
    } catch { return disconnectedMedia(); }
  });
  binding.mediaQueue = operation.catch(() => {});
  return operation;
}
function reattachBridge(binding) {
  const operation = (binding.mediaQueue ?? Promise.resolve()).then(async () => {
    if (!await sourceMatches(binding)) return disconnectedMedia();
    try {
      const [result] = await withinDeadline(chrome.scripting.executeScript({
        target:{tabId:binding.tabId,documentIds:[binding.documentId]},files:['content.js'],
      }));
      if (result?.result?.videoId !== binding.videoId) {
        if (validVideoId(result?.result?.videoId)) await withinDeadline(chrome.tabs.sendMessage(binding.tabId,
          {type:'LINGO_MEDIA',videoId:result.result.videoId,command:{action:'close'}},{documentId:binding.documentId}));
        return disconnectedMedia();
      }
      return sanitizeMedia(await withinDeadline(chrome.tabs.sendMessage(binding.tabId,
        {type:'LINGO_MEDIA',videoId:binding.videoId,command:{action:'state'}},{documentId:binding.documentId})));
    } catch { return disconnectedMedia(); }
  });
  binding.mediaQueue = operation.catch(() => {});
  return operation;
}
async function registeredPanel(sender, allowInit = false) {
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !validId(sender.tab?.id) ||
      typeof sender.documentId !== 'string' || !sender.documentId.length) return null;
  const binding = [...bindings.values()].find(value => value.panelTabId === sender.tab.id && sender.url === panelUrl(value.token));
  if (!binding) return null;
  try {
    const tab = await chrome.tabs.get(binding.panelTabId);
    if (!panelTabMatches(tab,binding)) return null;
  } catch { return null; }
  if (allowInit) {
    if (binding.panelDocumentId !== sender.documentId) {
      const previousDocument = binding.panelDocumentId, previousPort = binding.port;
      binding.panelDocumentId = sender.documentId;
      delete binding.port;
      previousPort?.disconnect();
      if (previousDocument) await bridgeMessage(binding,{action:'close'});
      binding.panelInactive = false;
      await persistBindings();
    }
  } else if (binding.panelDocumentId !== sender.documentId) return null;
  return bindings.get(binding.tabId) === binding ? binding : null;
}
async function disposeBinding(binding, removeWindow = false) {
  if (bindings.get(binding.tabId) !== binding) return;
  bindings.delete(binding.tabId);
  try { await persistBindings(); }
  finally {
    await bridgeMessage(binding, {action:'close'});
    if (removeWindow) try { await chrome.windows.remove(binding.windowId); } catch {}
  }
}
async function openPractice(tab) {
  await storageReady;
  const videoId = videoFromUrl(tab.url);
  const previous = bindings.get(tab.id);
  if (previous) {
    if (previous.videoId === videoId && !previous.panelInactive) {
      try {
        const panel = await chrome.tabs.get(previous.panelTabId);
        const [source] = await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:() => true });
        if (panelTabMatches(panel,previous) && source?.documentId === previous.documentId) {
          await chrome.windows.update(previous.windowId, {focused:true});
          return;
        }
      } catch {}
    }
    await disposeBinding(previous, true);
  }
  const results = await chrome.scripting.executeScript({ target:{tabId:tab.id}, files:['content.js'] });
  const source = results.find(value => value.frameId === 0);
  const documentId = source?.documentId, actualVideoId = source?.result?.videoId;
  if (typeof documentId !== 'string' || !documentId.length) throw new Error('No source document');
  if (actualVideoId !== videoId || !await sourceMatches({tabId:tab.id,videoId})) {
    if (validVideoId(actualVideoId)) await bridgeMessage({tabId:tab.id,videoId:actualVideoId,documentId},{action:'close'});
    throw new Error('Source changed during activation');
  }
  const binding = { tabId:tab.id,videoId,documentId,token:crypto.randomUUID(),panelInactive:false };
  pendingTokens.add(binding.token);
  let win;
  try {
    win = await chrome.windows.create({url:panelUrl(binding.token),type:'popup',width:680,height:900});
    const panel = win?.tabs?.find(value => validId(value.id));
    if (!validId(win?.id) || !panel) throw new Error('No practice window');
    Object.assign(binding,{windowId:win.id,panelTabId:panel.id});
    bindings.set(tab.id,binding);
    await persistBindings();
  } catch (error) {
    bindings.delete(tab.id);
    await bridgeMessage(binding,{action:'close'});
    if (win?.id) try {await chrome.windows.remove(win.id);} catch {}
    throw error;
  } finally { pendingTokens.delete(binding.token); }
}
async function toggleTab(tab) {
  if (!validId(tab?.id)) return;
  if (!videoFromUrl(tab.url)) {
    await chrome.action.setBadgeText({tabId:tab.id,text:'YT'});
    await chrome.action.setTitle({tabId:tab.id,title:chrome.i18n.getMessage('openYouTubeTitle')});
    return;
  }
  const operation = (openings.get(tab.id) ?? Promise.resolve()).then(() => openPractice(tab));
  openings.set(tab.id, operation);
  operation.catch(() => {});
  try {
    await operation;
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
    await chrome.action.setTitle({tabId:tab.id,title:chrome.i18n.getMessage('actionTitle')});
  } catch {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:chrome.i18n.getMessage('activationFailureTitle')});
  } finally { if (openings.get(tab.id) === operation) openings.delete(tab.id); }
}
chrome.action.onClicked.addListener(toggleTab);
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== 'LINGO_PANEL_LIFETIME') return;
  let binding, disconnected = false;
  const documentId = port.sender?.documentId;
  port.onDisconnect.addListener(async () => {
    disconnected = true;
    if (!binding || bindings.get(binding.tabId) !== binding || binding.port !== port ||
        binding.panelDocumentId !== documentId) return;
    delete binding.port;
    binding.panelInactive = true;
    const cleanup = bridgeMessage(binding,{action:'close'});
    try { await persistBindings(); }
    catch {}
    await cleanup;
  });
  try {
    await storageReady;
    binding = await registeredPanel(port.sender);
    if (!binding || disconnected) {port.disconnect(); return;}
    const previousPort = binding.port;
    binding.port = port;
    previousPort?.disconnect();
    await reattachBridge(binding);
    if (disconnected || bindings.get(binding.tabId) !== binding || binding.port !== port ||
        binding.panelDocumentId !== documentId) return;
    binding.panelInactive = false;
    await persistBindings();
    port.postMessage({ready:true});
  } catch {port.disconnect();}
});
chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    await storageReady;
    const binding = [...bindings.values()].find(value => value.windowId === windowId);
    if (binding) await disposeBinding(binding);
  } catch {}
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await storageReady;
    const binding = [...bindings.values()].find(value => value.panelTabId === tabId);
    if (binding) await disposeBinding(binding);
  } catch {}
});
const LESSON_ACTIONS = new Set(['get', 'save']);
const LIBRARY_ACTIONS = new Set(['list','vocabulary','delete','clear','export','previewImport','import']);
const isLibrarySender = (message, sender) => message?.type === 'LINGO_LIBRARY' &&
  LIBRARY_ACTIONS.has(message.action) && sender?.id === chrome.runtime.id &&
  sender.frameId === 0 && sender.url === chrome.runtime.getURL('library.html');
const emptyCaptionDiagnostic = (message) => ({
  schema: 1,
  requestedSource:
    message.action === 'transcript'
      ? 'transcript'
      : Number.isInteger(message.trackIndex)
        ? 'track'
        : 'auto',
  page: {
    watchPage: true,
    playerFound: false,
    videoFound: false,
    responseFound: false,
    videoMatches: false,
  },
  tracks: { count: 0, selectedLanguage: null, selectedAutomatic: null },
  timedText: { outcome: 'not-attempted', httpStatus: null },
  transcript: { model: 'none', openerFound: false, attempts: 0, cueCount: 0 },
});
const captionFailure = (message, code, messageKey) => ({
  error: { code, messageKey, stage: 'main-world', retryable: true },
  diagnostic: emptyCaptionDiagnostic(message),
});

function enqueue(operation, sendResponse) {
  const result = storageQueue.then(async () => {
    await storageReady;
    return operation();
  });
  storageQueue = result.catch(() => {});
  result.then(sendResponse).catch(() =>
    sendResponse({
      error:
        'Не удалось сохранить или прочитать прогресс. Проверьте разрешение «storage» и свободное место в хранилище расширения.',
      code: 'STORAGE_ERROR',
    }),
  );
  return true;
}

const readEpoch = (value) =>
  value === undefined ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : null;
const readRevision = (record) =>
  Number.isSafeInteger(record?.revision) && record.revision >= 0 ? record.revision : 0;
const isTombstone = (record) => record?.deleted === true;
const validCounter = (value) => Number.isSafeInteger(value) && value >= 0;
const invalidMessage = () => ({ error: 'Некорректные данные запроса.', code: 'INVALID_MESSAGE' });
const epochConflict = (storageEpoch) => ({
  error: 'Хранилище изменено. Обновите библиотеку.',
  code: 'EPOCH_CONFLICT',
  storageEpoch,
});

async function ensureWordProfile(snapshot) {
  const words = snapshot.wordProfile?.words;
  const restored =
    words && typeof words === 'object' && !Array.isArray(words)
      ? LingoExercise.restoreWordProfile(snapshot.wordProfile, true)
      : null;
  if (restored) return { profile: restored, migrated: false };
  const all = await chrome.storage.local.get(null);
  const lessons = Object.entries(all)
    .filter(([key, record]) => /^lesson:[\w-]{1,64}$/.test(key) && !isTombstone(record))
    .map(([key, record]) => LingoExercise.restoreSession(record, key.slice(7)))
    .filter(Boolean);
  return { profile: LingoExercise.buildWordProfile(lessons), migrated: true };
}

async function handleLessonMessage(message) {
  const key = 'lesson:' + message.videoId;
  const snapshot = await chrome.storage.local.get([
    key,
    'preferences',
    'wordProfile',
    'storageEpoch',
  ]);
  const storageEpoch = readEpoch(snapshot.storageEpoch);
  if (storageEpoch === null) throw new Error('Invalid storage epoch');
  const record = snapshot[key];
  const version = readRevision(record);
  const previousSession = isTombstone(record)
    ? null
    : LingoExercise.restoreSession(record, message.videoId);
  if (message.action === 'get') {
    const preferences = LingoExercise.preferences(snapshot.preferences ?? {});
    const { profile, migrated } = await ensureWordProfile(snapshot);
    if (migrated) await chrome.storage.local.set({ wordProfile: profile });
    return {
      session: previousSession,
      preferences,
      wordProfile: profile,
      version,
      storageEpoch,
    };
  }
  // Only an omitted legacy epoch means zero; null and other malformed values cannot bypass it.
  if ((message.storageEpoch === undefined ? 0 : message.storageEpoch) !== storageEpoch)
    return {
      error:
        'Хранилище изменено. Закройте режим и откройте снова, чтобы загрузить свежий прогресс.',
      code: 'EPOCH_CONFLICT',
      storageEpoch,
    };
  const invalid = { error: 'Некорректные данные прогресса.', code: 'INVALID_MESSAGE' };
  const session =
    message.session === undefined
      ? null
      : LingoExercise.restoreSession(message.session, message.videoId);
  if (message.session !== undefined && !session) return invalid;
  if (session) {
    if (
      typeof message.writerId !== 'string' ||
      !message.writerId.length ||
      message.writerId.length > 64 ||
      !Number.isSafeInteger(message.version) ||
      message.version < 0 ||
      message.version >= Number.MAX_SAFE_INTEGER ||
      version >= Number.MAX_SAFE_INTEGER
    )
      return invalid;
    // One instance can queue older drafts; a different writer must read the current revision.
    if (
      message.version > version ||
      (message.version !== version &&
        (isTombstone(record) || record?.writerId !== message.writerId))
    )
      return {
        error:
          'Тренировка изменена в другой вкладке. Закройте режим и откройте снова, чтобы загрузить свежий прогресс.',
        code: 'REVISION_CONFLICT',
      };
  }
  if (
    message.preferences !== undefined &&
    (!message.preferences ||
      typeof message.preferences !== 'object' ||
      Array.isArray(message.preferences))
  )
    return invalid;

  // Migration is computed after validation and committed together with an accepted save.
  const { profile, migrated } = await ensureWordProfile(snapshot);
  const changes = session
    ? {
        [key]: { ...session, revision: version + 1, writerId: message.writerId },
        wordProfile: LingoExercise.updateWordProfile(
          profile,
          previousSession?.tasks ?? [],
          session.tasks,
          session.updatedAt,
        ),
      }
    : migrated
      ? { wordProfile: profile }
      : {};
  if (message.preferences !== undefined)
    changes.preferences = LingoExercise.preferences({
      ...snapshot.preferences,
      ...message.preferences,
    });
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  return { saved: true, version: session ? version + 1 : version, storageEpoch };
}

function collectLessons(snapshot) {
  const sessions = [];
  let invalidCount = 0;
  for (const [key, record] of Object.entries(snapshot)) {
    if (!key.startsWith('lesson:') || isTombstone(record)) continue;
    const videoId = key.slice(7);
    const validTimestamp =
      !Object.hasOwn(record ?? {}, 'updatedAt') ||
      (Number.isFinite(record.updatedAt) && record.updatedAt >= 0);
    const session =
      validVideoId(videoId) && validTimestamp && LingoExercise.restoreSession(record, videoId);
    if (session) sessions.push(session);
    else invalidCount++;
  }
  return { sessions, invalidCount };
}

function currentState(snapshot, sessions) {
  const words = snapshot.wordProfile?.words;
  const profile =
    words && typeof words === 'object' && !Array.isArray(words)
      ? LingoExercise.restoreWordProfile(snapshot.wordProfile, true)
      : null;
  return {
    lessons: sessions,
    preferences: LingoExercise.preferences(snapshot.preferences ?? {}),
    wordProfile: profile ?? LingoExercise.buildWordProfile(sessions),
  };
}

async function handleLibraryMessage(message) {
  if (message.action === 'clear' && !validCounter(message.expectedEpoch)) return invalidMessage();
  const summaryKeys = ['added', 'updated', 'skipped', 'wordsUpdated'];
  if (
    message.action === 'import' &&
    (!validCounter(message.expectedEpoch) ||
      !message.expectedSummary ||
      typeof message.expectedSummary !== 'object' ||
      Array.isArray(message.expectedSummary) ||
      !summaryKeys.every((key) => validCounter(message.expectedSummary[key])))
  )
    return invalidMessage();
  if (
    message.action === 'delete' &&
    (!validVideoId(message.videoId) ||
      !validCounter(message.expectedRevision) ||
      !validCounter(message.expectedEpoch))
  )
    return invalidMessage();
  const snapshot = await chrome.storage.local.get(null);
  const storageEpoch = readEpoch(snapshot.storageEpoch);
  if (storageEpoch === null) throw new Error('Invalid storage epoch');
  if (message.action === 'clear') {
    if (message.expectedEpoch !== storageEpoch) return epochConflict(storageEpoch);
    if (storageEpoch === Number.MAX_SAFE_INTEGER) return invalidMessage();
    const cleared = {
      storageEpoch: storageEpoch + 1,
      preferences: LingoExercise.preferences(),
      wordProfile: { schema: 1, words: {} },
    };
    for (const [key, record] of Object.entries(snapshot)) {
      if (key.startsWith('lesson:')) {
        const revision = readRevision(record);
        if (revision === Number.MAX_SAFE_INTEGER) return invalidMessage();
        cleared[key] = { deleted: true, revision: revision + 1 };
      } else if (!Object.hasOwn(cleared, key))
        Object.defineProperty(cleared, key, { value: null, enumerable: true });
    }
    // This commit removes user content and invalidates every old tab before optional cleanup.
    await chrome.storage.local.set(cleared);
    let cleanupPending = false;
    try {
      await chrome.storage.local.remove(
        Object.keys(snapshot).filter((key) => key !== 'storageEpoch'),
      );
    } catch {
      cleanupPending = true;
    }
    return {
      cleared: true,
      storageEpoch: storageEpoch + 1,
      ...(cleanupPending ? { cleanupPending: true } : {}),
    };
  }
  const { sessions, invalidCount } = collectLessons(snapshot);
  const state = currentState(snapshot, sessions);
  if (message.action === 'delete') {
    if (message.expectedEpoch !== storageEpoch) return epochConflict(storageEpoch);
    const key = 'lesson:' + message.videoId;
    const record = snapshot[key];
    const revision = readRevision(record);
    if (message.expectedRevision !== revision)
      return {
        error: 'Занятие изменено. Обновите библиотеку.',
        code: 'REVISION_CONFLICT',
        revision,
      };
    if (record === undefined || isTombstone(record))
      return { error: 'Занятие не найдено.', code: 'NOT_FOUND' };
    if (revision === Number.MAX_SAFE_INTEGER) return invalidMessage();
    // Preserve anonymous legacy history in the same commit that removes its last context.
    await chrome.storage.local.set({
      [key]: { deleted: true, revision: revision + 1 },
      wordProfile: state.wordProfile,
    });
    return { deleted: true, revision: revision + 1, storageEpoch };
  }
  if (message.action === 'list') {
    const lessons = sessions
      .sort(
        (a, b) =>
          b.updatedAt - a.updatedAt || (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0),
      )
      .map((session) => {
        const counts = LingoExercise.resultCounts(session.tasks);
        return {
          videoId: session.videoId,
          title: session.title,
          sourceLabel: session.sourceLabel,
          updatedAt: session.updatedAt,
          position: session.position,
          completed: counts.total - counts.remaining,
          total: counts.total,
          revision: readRevision(snapshot['lesson:' + session.videoId]),
        };
      });
    return { lessons, invalidCount, preferences: state.preferences, storageEpoch };
  }
  if (message.action === 'vocabulary')
    return { words: LingoData.vocabulary(state.wordProfile, sessions), invalidCount, storageEpoch };
  if (message.action === 'export') {
    const parsed = LingoData.parseBackup(LingoData.createBackup(state));
    if (!parsed.ok) return { error: parsed.message, code: 'INVALID_BACKUP' };
    return { backup: parsed.backup, invalidCount, storageEpoch };
  }
  if (message.action === 'previewImport' || message.action === 'import') {
    if (message.action === 'import' && message.expectedEpoch !== storageEpoch)
      return epochConflict(storageEpoch);
    const parsed = LingoData.parseBackup(message.backup);
    if (!parsed.ok) return { error: parsed.message, code: 'INVALID_BACKUP' };
    if (!parsed.backup.lessons.every((lesson) => validVideoId(lesson.videoId)))
      return { error: 'Резервная копия содержит неверный ID видео.', code: 'INVALID_BACKUP' };
    const plan = LingoData.planBackupImport(
      state,
      parsed.backup,
      message.importPreferences === true,
    );
    if (message.action === 'previewImport')
      return { summary: plan.summary, invalidLocalCount: invalidCount, storageEpoch };
    if (!summaryKeys.every((key) => plan.summary[key] === message.expectedSummary[key]))
      return {
        error: 'Данные изменились. Повторите предпросмотр импорта.',
        code: 'IMPORT_CHANGED',
      };
    const changes = { wordProfile: plan.next.wordProfile, storageEpoch };
    const writerId = `import:${crypto.randomUUID()}`;
    for (const lesson of plan.changedLessons) {
      const key = 'lesson:' + lesson.videoId;
      const revision = readRevision(snapshot[key]);
      if (revision === Number.MAX_SAFE_INTEGER) return invalidMessage();
      changes[key] = { ...lesson, revision: revision + 1, writerId };
    }
    if (message.importPreferences === true) changes.preferences = plan.next.preferences;
    await chrome.storage.local.set(changes);
    return { imported: true, summary: plan.summary, storageEpoch };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isLibrarySender(message, sender)) return enqueue(() => handleLibraryMessage(message), sendResponse);
  if (!['LINGO_PANEL','LINGO_STORE','LINGO_YOUTUBE','LINGO_OPEN_LIBRARY'].includes(message?.type)) return;
  Promise.resolve().then(async () => {
    await storageReady;
    const isInit = message.type === 'LINGO_PANEL' && message.action === 'init';
    const binding = await registeredPanel(sender, isInit);
    if (!binding) {
      if (isInit && sender?.id === chrome.runtime.id && sender.frameId === 0 &&
          typeof sender.documentId === 'string' && [...pendingTokens].some(token => sender.url === panelUrl(token)))
        return {code:'PANEL_STARTING',error:'Practice window is starting.'};
      if (isInit && sender?.id === chrome.runtime.id && sender.frameId === 0 &&
          sender.url?.startsWith(chrome.runtime.getURL('practice.html')+'#'))
        return {code:'PANEL_UNAVAILABLE',error:'Practice window is unavailable.'};
      return;
    }
    if (message.type === 'LINGO_PANEL') {
      if (isInit) return {videoId:binding.videoId,media:await reattachBridge(binding)};
      if (message.action === 'close') { await disposeBinding(binding,true); return {closed:true}; }
      if (message.action !== 'media') return invalidMessage();
      const command = mediaCommand(message.command);
      if (!command) return invalidMessage();
      return {media:await bridgeMessage(binding,command)};
    }
    if (message.type === 'LINGO_OPEN_LIBRARY') {
      try { await chrome.runtime.openOptionsPage(); return {opened:true}; }
      catch { return {error:'Не удалось открыть «Мои занятия». Повторите попытку.',code:'OPEN_LIBRARY_FAILED'}; }
    }
    if (!validVideoId(message.videoId) || message.videoId !== binding.videoId) return;
    if (message.type === 'LINGO_STORE') {
      if (!LESSON_ACTIONS.has(message.action)) return;
      return new Promise(resolve => enqueue(() => handleLessonMessage(message),resolve));
    }
    if (!['tracks','load','transcript'].includes(message.action) || (message.trackIndex != null &&
        (!Number.isInteger(message.trackIndex) || message.trackIndex < 0 || message.trackIndex > 1000))) return;
    if (!await sourceMatches(binding))
      return captionFailure(message,'PAGE_CONTEXT_CHANGED','Страница изменилась. Закройте режим и включите его снова.');
    try {
      const results = await withinDeadline(chrome.scripting.executeScript({
        target:{tabId:binding.tabId,documentIds:[binding.documentId]},world:'MAIN',func:lingoYouTube,
        args:[message.action,{videoId:binding.videoId,trackIndex:message.trackIndex}],
      }),15000);
      return results[0]?.result ?? captionFailure(message,'MAIN_WORLD_NO_RESULT','Проигрыватель не ответил. Повторите загрузку.');
    } catch {
      return captionFailure(message,'PAGE_CONTEXT_CHANGED','Страница изменилась. Закройте режим и включите его снова.');
    }
  }).then(sendResponse).catch(() => sendResponse({error:'Не удалось проверить окно расширения.',code:'PANEL_UNAVAILABLE'}));
  return true;
});
