'use strict';
importScripts('youtube.js', 'exercise.js');
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
const isLessonSender = (message, sender) =>
  message?.type === 'LINGO_STORE' &&
  LESSON_ACTIONS.has(message.action) &&
  sender?.id === chrome.runtime.id &&
  Boolean(sender.tab?.id) &&
  sender.frameId === 0 &&
  /^https:\/\/www\.youtube\.com\/watch(?:\?|$)/.test(sender.url ?? '') &&
  typeof message.videoId === 'string' &&
  /^[\w-]{1,64}$/.test(message.videoId);

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

async function ensureWordProfile(snapshot) {
  const restored = LingoExercise.restoreWordProfile(snapshot.wordProfile, true);
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
    const { profile, migrated } = await ensureWordProfile(snapshot);
    if (migrated) await chrome.storage.local.set({ wordProfile: profile });
    return {
      session: previousSession,
      preferences: LingoExercise.preferences(snapshot.preferences),
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
        results[0]?.result ?? { error: 'Проигрыватель не ответил. Повторите загрузку.' },
      ),
    )
    .catch(() =>
      sendResponse({ error: 'Страница изменилась. Закройте режим и включите его снова.' }),
    );
  return true;
});
