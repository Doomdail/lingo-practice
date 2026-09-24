'use strict';
importScripts('youtube.js', 'exercise.js', 'data.js');
let storageQueue = Promise.resolve();

async function toggleTab(tab) {
  if (!tab?.id || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url ?? '')) {
    if (tab?.id) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: 'YT' });
      await chrome.action.setTitle({
        tabId: tab.id,
        title: chrome.i18n.getMessage('openYouTubeTitle'),
      });
    }
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['i18n.js', 'exercise.js', 'content.js'],
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage('actionTitle') });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: chrome.i18n.getMessage('activationFailureTitle'),
    });
    console.warn('Lingo Practice: activation failed', error.message);
  }
}
chrome.action.onClicked.addListener(toggleTab);

const LESSON_ACTIONS = new Set(['get', 'save']);
const LIBRARY_ACTIONS = new Set([
  'list',
  'vocabulary',
  'delete',
  'clear',
  'export',
  'previewImport',
  'import',
]);
const validVideoId = (value) => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
const isLibrarySender = (message, sender) =>
  message?.type === 'LINGO_LIBRARY' &&
  LIBRARY_ACTIONS.has(message.action) &&
  sender?.id === chrome.runtime.id &&
  sender.frameId === 0 &&
  sender.url === chrome.runtime.getURL('library.html');
const isLessonPageSender = (sender) =>
  sender?.id === chrome.runtime.id &&
  Number.isInteger(sender.tab?.id) &&
  sender.tab.id >= 0 &&
  sender.frameId === 0 &&
  /^https:\/\/www\.youtube\.com\/watch(?:\?|$)/.test(sender.url ?? '');
const isLessonSender = (message, sender) =>
  message?.type === 'LINGO_STORE' &&
  LESSON_ACTIONS.has(message.action) &&
  isLessonPageSender(sender) &&
  typeof message.videoId === 'string' &&
  /^[\w-]{1,64}$/.test(message.videoId);
const isOpenLibrarySender = (message, sender) =>
  message?.type === 'LINGO_OPEN_LIBRARY' && isLessonPageSender(sender);
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
  const result = storageQueue.then(operation);
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
  if (isOpenLibrarySender(message, sender)) {
    Promise.resolve()
      .then(() => chrome.runtime.openOptionsPage())
      .then(() => sendResponse({ opened: true }))
      .catch(() =>
        sendResponse({
          error: 'Не удалось открыть «Мои занятия». Повторите попытку.',
          code: 'OPEN_LIBRARY_FAILED',
        }),
      );
    return true;
  }
  if (isLibrarySender(message, sender))
    return enqueue(() => handleLibraryMessage(message), sendResponse);
  if (isLessonSender(message, sender))
    return enqueue(() => handleLessonMessage(message), sendResponse);
  if (
    message?.type !== 'LINGO_YOUTUBE' ||
    !sender.tab?.id ||
    sender.frameId !== 0 ||
    !/^https:\/\/www\.youtube\.com\/watch\?/.test(sender.url ?? '') ||
    !['tracks', 'load', 'transcript'].includes(message.action)
  )
    return;
  chrome.scripting
    .executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: lingoYouTube,
      args: [message.action, { videoId: message.videoId, trackIndex: message.trackIndex }],
    })
    .then((results) =>
      sendResponse(
        results[0]?.result ??
          captionFailure(message, 'MAIN_WORLD_NO_RESULT', 'Проигрыватель не ответил. Повторите загрузку.'),
      ),
    )
    .catch(() =>
      sendResponse(
        captionFailure(message, 'PAGE_CONTEXT_CHANGED', 'Страница изменилась. Закройте режим и включите его снова.'),
      ),
    );
  return true;
});
