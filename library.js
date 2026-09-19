(function () {
  'use strict';

  if (location.hash) {
    location.replace(location.pathname + location.search);
    return;
  }

  const state = {
    lessons: [],
    words: [],
    preferences: null,
    storageEpoch: 0,
    invalidCount: 0,
    language: 'en',
  };
  const retryImportCodes = new Set([
    'IMPORT_CHANGED',
    'EPOCH_CONFLICT',
    'REVISION_CONFLICT',
    'NOT_FOUND',
  ]);
  const byId = (id) => document.getElementById(id);
  const lessonList = byId('lesson-list');
  const wordList = byId('word-list');
  const wordSearch = byId('word-search');
  const wordSort = byId('word-sort');
  const announcer = byId('announcer');
  const confirmElement = byId('confirm-dialog');
  const exportDialog = byId('export-dialog');
  const importDialog = byId('import-dialog');
  const helpDialog = byId('help-dialog');
  let preparedExport = null;
  let currentImport = null;

  const t = (key, parameters = {}) => LingoI18n.text(key, parameters, state.language);
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  async function requestLibrary(action, payload = {}) {
    const result = await chrome.runtime.sendMessage({ type: 'LINGO_LIBRARY', action, ...payload });
    if (!result) throw new Error(t('Расширение не ответило.'));
    if (result.error) throw Object.assign(new Error(result.error), result);
    return result;
  }

  function announce(key, parameters) {
    announcer.textContent = t(key, parameters);
  }

  function translatedError(error) {
    return t(error?.message || 'Не удалось загрузить библиотеку.');
  }

  function applyLanguage(language) {
    state.language = LingoI18n.resolve(language, navigator.language);
    document.documentElement.lang = state.language;
    document.title = `${t('Мои занятия')} · Lingo Practice`;
    for (const element of document.querySelectorAll('[data-i18n]'))
      element.textContent = t(element.dataset.i18n);
    for (const element of document.querySelectorAll('[data-i18n-aria-label]'))
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    for (const element of document.querySelectorAll('[data-i18n-placeholder]'))
      element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
      : `${minutes}:${remainder}`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(state.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  function translateSource(label) {
    const automatic = ' · автоматические';
    return label.endsWith(automatic) ? label.slice(0, -automatic.length) + t(automatic) : t(label);
  }

  function appendUserTemplate(element, key, parameter, value) {
    const marker = '\u0000';
    const [before, after = ''] = t(key, { [parameter]: marker }).split(marker);
    const userValue = create('span', 'user-content', value);
    element.append(before, userValue, after);
  }

  function openLesson(videoId, position) {
    if (!/^[\w-]{1,64}$/.test(videoId)) throw new Error(t('Некорректный идентификатор видео.'));
    const seconds = Math.max(0, Math.floor(Number(position) || 0));
    return chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` });
  }

  function renderLessons(lessons) {
    lessonList.replaceChildren();
    if (!lessons.length) {
      lessonList.append(create('p', 'empty-state', t('Сохранённых занятий пока нет.')));
      return;
    }
    const cards = create('div', 'cards');
    for (const lesson of lessons) {
      const card = create('article', 'card lesson-card');
      card.dataset.lessonId = lesson.videoId;
      const title = create('h3', 'user-content', lesson.title || lesson.videoId);
      const source = create('p', 'meta');
      appendUserTemplate(
        source,
        'Источник: {source}',
        'source',
        translateSource(lesson.sourceLabel),
      );
      const date = create(
        'p',
        'meta',
        t('Обновлено: {date}', { date: formatDate(lesson.updatedAt) }),
      );
      const position = create(
        'p',
        'meta',
        t('Позиция: {time}', { time: formatTime(lesson.position) }),
      );
      const progress = create(
        'p',
        'progress',
        t('Завершено: {completed} / {total}', {
          completed: lesson.completed,
          total: lesson.total,
        }),
      );
      const actions = create('div', 'card-actions');
      const continueButton = create('button', '', t('Продолжить'));
      continueButton.type = 'button';
      continueButton.addEventListener('click', () => {
        Promise.resolve(openLesson(lesson.videoId, lesson.position)).catch((error) =>
          announce(error.message),
        );
      });
      const deleteButton = create('button', 'danger secondary-danger', t('Удалить'));
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', () => deleteLesson(lesson, deleteButton));
      actions.append(continueButton, deleteButton);
      card.append(title, source, date, position, progress, actions);
      cards.append(card);
    }
    lessonList.append(cards);
  }

  function normalizeSearch(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[‘’]/g, "'")
      .toLocaleLowerCase(state.language)
      .trim();
  }

  function filteredWords() {
    const query = normalizeSearch(wordSearch.value);
    const result = state.words.filter((entry) =>
      normalizeSearch(`${entry.word} ${entry.context?.text ?? ''}`).includes(query),
    );
    return result.sort(
      wordSort.value === 'recent'
        ? (a, b) => b.lastSeenAt - a.lastSeenAt || a.word.localeCompare(b.word, state.language)
        : (a, b) =>
            b.score - a.score ||
            b.lastSeenAt - a.lastSeenAt ||
            a.word.localeCompare(b.word, state.language),
    );
  }

  function renderVocabulary(words) {
    wordList.replaceChildren();
    if (!state.words.length) {
      wordList.append(create('p', 'empty-state', t('Трудных слов пока нет.')));
      return;
    }
    if (!words.length) {
      wordList.append(create('p', 'empty-state', t('Ничего не найдено.')));
      return;
    }
    const cards = create('div', 'cards word-cards');
    for (const entry of words) {
      const card = create('article', 'card word-card');
      card.dataset.word = entry.word;
      card.append(create('h3', 'user-content', entry.word));
      const stats = create('div', 'word-stats');
      for (const [key, count] of [
        ['Попыток: {count}', entry.attempts],
        ['Самостоятельно: {count}', entry.clean],
        ['Ошибок: {count}', entry.mistakes],
        ['Подсказок: {count}', entry.hints],
        ['Пропусков: {count}', entry.misses],
      ])
        stats.append(create('span', '', t(key, { count })));
      card.append(stats);
      if (entry.context) {
        card.append(create('p', 'word-context user-content', entry.context.text));
        const contextMeta = create(
          'p',
          'meta user-content',
          [entry.context.videoTitle, entry.context.source].filter(Boolean).join(' · '),
        );
        card.append(contextMeta);
        const openButton = create(
          'button',
          'secondary',
          t('Открыть видео с {time}', { time: formatTime(entry.context.time) }),
        );
        openButton.type = 'button';
        openButton.addEventListener('click', () => {
          Promise.resolve(openLesson(entry.context.videoId, entry.context.time)).catch((error) =>
            announce(error.message),
          );
        });
        card.append(openButton);
      } else card.append(create('p', 'meta', t('Контекст недоступен.')));
      cards.append(card);
    }
    wordList.append(cards);
  }

  async function refreshLibrary() {
    byId('load-status').hidden = false;
    byId('load-error').hidden = true;
    try {
      const [listed, vocabulary] = await Promise.all([
        requestLibrary('list'),
        requestLibrary('vocabulary'),
      ]);
      Object.assign(state, listed, {
        words: vocabulary.words,
        invalidCount: Math.max(listed.invalidCount, vocabulary.invalidCount),
      });
      applyLanguage(listed.preferences.language);
      const warning = byId('invalid-warning');
      warning.hidden = state.invalidCount === 0;
      warning.textContent = state.invalidCount
        ? t('Пропущено повреждённых записей: {count}.', { count: state.invalidCount })
        : '';
      renderLessons(state.lessons);
      renderVocabulary(filteredWords());
    } catch (error) {
      const loadError = byId('load-error');
      loadError.hidden = false;
      loadError.textContent = `${t('Не удалось загрузить библиотеку.')} ${translatedError(error)}`;
    } finally {
      byId('load-status').hidden = true;
    }
  }

  function openDialog(dialog, trigger, initialFocus) {
    dialog.returnValue = '';
    dialog._returnFocus = trigger;
    dialog.addEventListener(
      'close',
      () => {
        if (dialog._returnFocus?.isConnected) dialog._returnFocus.focus();
        dialog._returnFocus = null;
      },
      { once: true },
    );
    dialog.showModal();
    (initialFocus || dialog.querySelector('button, input, select'))?.focus();
  }

  function confirmDialog({ title, message, confirmText, returnFocus }) {
    byId('confirm-title').textContent = title;
    confirmElement.querySelector('.dialog-message').textContent = message;
    byId('confirm-action').textContent = confirmText;
    return new Promise((resolve) => {
      confirmElement.addEventListener(
        'close',
        () => resolve(confirmElement.returnValue === 'confirm'),
        { once: true },
      );
      openDialog(
        confirmElement,
        returnFocus,
        confirmElement.querySelector('button[value="cancel"]'),
      );
    });
  }

  async function deleteLesson(lesson, trigger) {
    if (
      !(await confirmDialog({
        title: t('Удалить занятие?'),
        message: lesson.title,
        confirmText: t('Удалить'),
        returnFocus: trigger,
      }))
    )
      return;
    try {
      await requestLibrary('delete', {
        videoId: lesson.videoId,
        expectedRevision: lesson.revision,
        expectedEpoch: state.storageEpoch,
      });
      announce('Занятие удалено.');
    } catch (error) {
      announce(error.message);
    } finally {
      await refreshLibrary();
      if (!trigger.isConnected) byId('lessons').focus();
    }
  }

  async function clearLibrary(trigger) {
    if (
      !(await confirmDialog({
        title: t('Удалить все данные?'),
        message: t('Будут удалены занятия, ответы, настройки и статистика слов.'),
        confirmText: t('Удалить всё'),
        returnFocus: trigger,
      }))
    )
      return;
    try {
      await requestLibrary('clear', { expectedEpoch: state.storageEpoch });
      announce('Все данные удалены.');
    } catch (error) {
      announce(error.message);
    } finally {
      await refreshLibrary();
    }
  }

  function downloadBlob(filename, type, content) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function finishExport(result) {
    downloadBlob(
      `lingo-practice-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json;charset=utf-8',
      JSON.stringify(result.backup, null, 2),
    );
    exportDialog.close();
    announce('Резервная копия скачана.');
  }

  function openExport(trigger) {
    preparedExport = null;
    byId('export-warning').hidden = true;
    byId('export-warning').textContent = '';
    byId('export-error').hidden = true;
    byId('export-error').textContent = '';
    byId('download-backup').disabled = false;
    openDialog(exportDialog, trigger, exportDialog.querySelector('button[value="cancel"]'));
  }

  async function exportBackup() {
    if (preparedExport) {
      finishExport(preparedExport);
      preparedExport = null;
      return;
    }
    const button = byId('download-backup');
    button.disabled = true;
    try {
      const result = await requestLibrary('export');
      if (result.invalidCount > 0) {
        preparedExport = result;
        const warning = byId('export-warning');
        warning.hidden = false;
        warning.textContent = t('Пропущено повреждённых записей: {count}.', {
          count: result.invalidCount,
        });
      } else finishExport(result);
    } catch (error) {
      const exportError = byId('export-error');
      exportError.hidden = false;
      exportError.textContent = translatedError(error);
    } finally {
      button.disabled = false;
    }
  }

  async function readBackupFile(file) {
    if (!file || file.size > LingoData.limits.backupBytes)
      throw new Error(t('Резервная копия слишком большая: максимум 10 МБ.'));
    try {
      return JSON.parse(await file.text());
    } catch {
      throw new Error(t('Не удалось прочитать JSON резервной копии.'));
    }
  }

  function renderImportSummary(summary) {
    const container = byId('import-summary');
    container.replaceChildren(
      create('p', '', t('Добавлено: {count}', { count: summary.added })),
      create('p', '', t('Обновлено занятий: {count}', { count: summary.updated })),
      create('p', '', t('Пропущено занятий: {count}', { count: summary.skipped })),
      create('p', '', t('Обновлено слов: {count}', { count: summary.wordsUpdated })),
    );
  }

  function isCurrentImport(operation) {
    return currentImport === operation && importDialog.open;
  }

  async function previewCurrentImport(operation = currentImport) {
    if (!operation || !isCurrentImport(operation)) return;
    const ticket = {};
    operation.previewTicket = ticket;
    operation.preview = null;
    const applyButton = byId('apply-import');
    applyButton.disabled = true;
    byId('import-error').hidden = true;
    byId('import-summary').textContent = t('Загрузка библиотеки…');
    try {
      const result = await requestLibrary('previewImport', {
        backup: operation.backup,
        importPreferences: byId('import-preferences').checked,
      });
      if (!isCurrentImport(operation) || operation.previewTicket !== ticket) return;
      operation.preview = {
        storageEpoch: result.storageEpoch,
        summary: Object.freeze({ ...result.summary }),
      };
      renderImportSummary(operation.preview.summary);
      const warning = byId('import-warning');
      warning.hidden = result.invalidLocalCount === 0;
      warning.textContent = result.invalidLocalCount
        ? t('Пропущено повреждённых записей: {count}.', {
            count: result.invalidLocalCount,
          })
        : '';
      applyButton.disabled = false;
    } catch (error) {
      if (!isCurrentImport(operation) || operation.previewTicket !== ticket) return;
      const importError = byId('import-error');
      importError.hidden = false;
      importError.textContent = translatedError(error);
      byId('import-summary').textContent = '';
    }
  }

  async function openImport(file, trigger) {
    const operation = { backup: null, preview: null, previewTicket: null };
    currentImport = operation;
    byId('import-file-name').textContent = file?.name ?? '';
    byId('import-preferences').checked = false;
    byId('import-warning').hidden = true;
    byId('import-error').hidden = true;
    byId('import-summary').textContent = t('Загрузка библиотеки…');
    byId('apply-import').disabled = true;
    importDialog.addEventListener(
      'close',
      () => {
        if (currentImport === operation) currentImport = null;
      },
      { once: true },
    );
    openDialog(importDialog, trigger, importDialog.querySelector('button[value="cancel"]'));
    try {
      const backup = await readBackupFile(file);
      if (!isCurrentImport(operation)) return;
      operation.backup = backup;
      await previewCurrentImport(operation);
    } catch (error) {
      if (!isCurrentImport(operation)) return;
      const importError = byId('import-error');
      importError.hidden = false;
      importError.textContent = translatedError(error);
      byId('import-summary').textContent = '';
    }
  }

  async function applyImport() {
    const operation = currentImport;
    if (!operation?.preview || !isCurrentImport(operation)) return;
    const applyButton = byId('apply-import');
    applyButton.disabled = true;
    const preview = operation.preview;
    try {
      await requestLibrary('import', {
        backup: operation.backup,
        importPreferences: byId('import-preferences').checked,
        expectedEpoch: preview.storageEpoch,
        expectedSummary: preview.summary,
      });
      if (!isCurrentImport(operation)) return;
      importDialog.close();
      currentImport = null;
      announce('Импорт завершён.');
      await refreshLibrary();
    } catch (error) {
      if (!isCurrentImport(operation)) return;
      if (retryImportCodes.has(error.code)) {
        announce(error.message);
        await refreshLibrary();
        if (isCurrentImport(operation)) await previewCurrentImport(operation);
      } else {
        const importError = byId('import-error');
        importError.hidden = false;
        importError.textContent = translatedError(error);
      }
    } finally {
      if (isCurrentImport(operation) && operation.preview) applyButton.disabled = false;
    }
  }

  function initialize() {
    applyLanguage('auto');
    for (const link of document.querySelectorAll('.section-nav a'))
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target?.scrollIntoView({ block: 'start' });
        target?.focus({ preventScroll: true });
      });
    byId('refresh-library').addEventListener('click', refreshLibrary);
    wordSearch.addEventListener('input', () => renderVocabulary(filteredWords()));
    wordSort.addEventListener('change', () => renderVocabulary(filteredWords()));
    byId('download-csv').addEventListener('click', () => {
      downloadBlob(
        'lingo-practice-difficult-words.csv',
        'text/csv;charset=utf-8',
        LingoData.createVocabularyCsv(state.words),
      );
      announce('CSV скачан.');
    });
    byId('export-backup').addEventListener('click', (event) => openExport(event.currentTarget));
    byId('download-backup').addEventListener('click', exportBackup);
    byId('backup-file').addEventListener('change', async (event) => {
      const input = event.currentTarget;
      await openImport(input.files[0], input);
      input.value = '';
    });
    byId('import-preferences').addEventListener('change', previewCurrentImport);
    byId('apply-import').addEventListener('click', applyImport);
    byId('clear-data').addEventListener('click', (event) => clearLibrary(event.currentTarget));
    byId('show-help').addEventListener('click', (event) =>
      openDialog(helpDialog, event.currentTarget, helpDialog.querySelector('button')),
    );
    refreshLibrary();
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
