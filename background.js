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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type === 'LINGO_STORE' &&
    sender.tab?.id &&
    sender.frameId === 0 &&
    /^https:\/\/www\.youtube\.com\//.test(sender.url ?? '') &&
    /^[\w-]{1,64}$/.test(message.videoId ?? '')
  ) {
    const key = 'lesson:' + message.videoId;
    const operation = storageQueue.then(async () => {
      const data = await chrome.storage.local.get([key, 'preferences']);
      let version = data[key]?.revision ?? 0;
      if (message.action === 'get') {
        return {
          session: LingoExercise.restoreSession(data[key], message.videoId),
          preferences: LingoExercise.preferences(data.preferences ?? {}),
          version,
        };
      }
      if (message.action !== 'save') throw new Error('Unknown storage action');
      const session = message.session
        ? LingoExercise.restoreSession(message.session, message.videoId)
        : null;
      if (message.session && !session) throw new Error('Invalid session');
      if (session) {
        if (
          typeof message.writerId !== 'string' ||
          !message.writerId.length ||
          message.writerId.length > 64 ||
          !Number.isSafeInteger(message.version) ||
          message.version < 0
        )
          throw new Error('Invalid writer');
        // One instance can send drafts before earlier replies arrive; another must first read the current revision.
        if (message.version !== version && data[key]?.writerId !== message.writerId) {
          return {
            error:
              'Тренировка изменена в другой вкладке. Закройте режим и откройте снова, чтобы загрузить свежий прогресс.',
          };
        }
        version++;
      }
      const changes = session
        ? { [key]: { ...session, revision: version, writerId: message.writerId } }
        : {};
      if (message.preferences !== undefined) {
        if (
          !message.preferences ||
          typeof message.preferences !== 'object' ||
          Array.isArray(message.preferences)
        )
          throw new Error('Invalid preferences');
        changes.preferences = LingoExercise.preferences({
          ...data.preferences,
          ...message.preferences,
        });
      }
      if (Object.keys(changes).length) await chrome.storage.local.set(changes);
      return { saved: true, version };
    });
    storageQueue = operation.catch(() => {});
    operation.then(sendResponse).catch(() =>
      sendResponse({
        error:
          'Не удалось сохранить или прочитать прогресс. Проверьте разрешение «storage» и свободное место в хранилище расширения.',
      }),
    );
    return true;
  }
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
