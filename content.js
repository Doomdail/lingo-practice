(function () {
  'use strict';
  if (globalThis.LingoLesson) {
    globalThis.LingoLesson.close();
    return;
  }
  const videoId = new URL(location.href).searchParams.get('v');
  let player = document.querySelector('#movie_player');
  let video = player?.querySelector('video');
  if (location.pathname !== '/watch' || !videoId || !video) return;
  const exercise = globalThis.LingoExercise;
  const abort = new AbortController();
  const { signal } = abort;
  let disposed = false,
    revision = 0,
    tasks = [],
    rows = [],
    current = -1;
  let previousTime = video.currentTime,
    pausedAt = -1,
    ready = false,
    interval,
    mediaAbort;
  let prefs = exercise.preferences(),
    offset = 0,
    sourceSelection = 'auto',
    sourceLabel = '',
    approximate = false;
  let initialized = false,
    busy = false,
    failedSelection = null,
    lastSave = 0,
    lastPosition = video.currentTime;
  let pendingSeek = null,
    slowReplay = null,
    review = null,
    rowAbort = new AbortController();
  const writerId = crypto.randomUUID();
  let storageVersion = 0,
    storageEpoch = 0,
    saveBlocked = false,
    preferenceChanges = {},
    wordProfile = { schema: 1, words: {} };
  let noticeState = 'loading',
    noticeMessage = '';
  const i18n = globalThis.LingoI18n;
  const language = () => i18n.resolve(prefs.language, navigator.language);
  const t = (key, parameters) => i18n.text(key, parameters, language());
  const localizedAttributes = new WeakMap();
  function setText(node, key, parameters = {}) {
    node.dataset.i18n = key;
    node.dataset.i18nParams = JSON.stringify(parameters);
    node.textContent = t(key, parameters);
  }
  function setRawText(node, text) {
    delete node.dataset.i18n;
    delete node.dataset.i18nParams;
    node.textContent = text;
  }
  function setAttr(node, name, key, parameters = {}) {
    const attributes = localizedAttributes.get(node) ?? {};
    attributes[name] = { key, parameters };
    localizedAttributes.set(node, attributes);
    node.dataset.i18nAttrs = '';
    node.setAttribute(name, t(key, parameters));
  }
  const host = document.createElement('div');
  host.id = 'lingo-practice-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('styles.css');
  shadow.append(stylesheet);
  const el = (tag, className, text, translate = true) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) {
      if (translate) setText(node, text);
      else setRawText(node, text);
    }
    return node;
  };
  const listen = (node, event, fn, options = {}) =>
    node.addEventListener(event, fn, { signal, ...options });
  const button = (text, className, callback, eventSignal = signal) => {
    const node = el('button', className, text);
    node.type = 'button';
    listen(node, 'click', callback, { signal: eventSignal });
    return node;
  };
  const shell = el('section', 'shell');
  setAttr(shell, 'aria-label', 'Тренировка аудирования');
  const header = el('header', 'header');
  const brand = el('div', 'brand');
  brand.append(
    el('span', 'brand-mark', 'lp'),
    el('span', '', 'lingo practice'),
    el('span', 'beta', 'BETA'),
  );
  const headerActions = el('div', 'controls');
  headerActions.append(
    button('Настройки', 'exit', () => settingsDialog.showModal()),
    button('Выйти', 'exit', close),
  );
  header.append(brand, headerActions);
  const lesson = el('main', 'lesson');
  const heading = el('div', 'lesson-heading');
  const titleBox = el('div', 'title-box');
  titleBox.append(el('p', 'eyebrow', 'СЛУШАЙ. ВПИСЫВАЙ. ЗАПОМИНАЙ.'));
  const title = el('h1', '', 'Твоя следующая маленькая победа');
  titleBox.append(title);
  const stats = el('div', 'stats', '—');
  setAttr(stats, 'aria-label', 'Результат');
  heading.append(titleBox, stats);
  const toolbar = el('div', 'toolbar');
  const controls = el('div', 'controls');
  const play = button(video.paused ? 'Продолжить' : 'Пауза', 'primary', togglePlay);
  const repeat = button('↶ Повторить строку', 'secondary', repeatCue);
  repeat.disabled = true;
  const follow = button('К текущей строке', 'secondary', followCurrent);
  controls.append(play, repeat, follow);
  const select = el('select', 'language');
  setAttr(select, 'aria-label', 'Источник субтитров');
  const option = (value, label) => {
    const node = el('option');
    node.value = value;
    if (['auto', 'transcript'].includes(value)) setText(node, label);
    else if (value === 'file') setRawText(node, label);
    else {
      node.dataset.sourceLabel = label;
      setRawText(node, translateSource(label));
    }
    select.append(node);
  };
  option('auto', 'Автоматически');
  option('transcript', 'Расшифровка YouTube');
  listen(select, 'change', () => load(select.value));
  toolbar.append(controls);
  const sources = el('div', 'source-toolbar');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.srt,.vtt';
  fileInput.hidden = true;
  setAttr(fileInput, 'aria-label', 'Файл субтитров');
  listen(fileInput, 'change', importFile);
  const importButton = button('Открыть SRT/VTT', 'secondary', () => fileInput.click());
  const summaryButton = button('Разбор ошибок', 'secondary', showSummary);
  sources.append(select, importButton, summaryButton, fileInput);
  const notice = el('div', 'notice', 'Загружаем субтитры…');
  notice.setAttribute('role', 'status');
  const retry = button('Повторить загрузку', 'secondary retry', () =>
    load(failedSelection ?? select.value),
  );
  retry.hidden = true;
  const reviewBar = el('div', 'review-bar');
  reviewBar.hidden = true;
  const reviewLabel = el('span');
  reviewBar.append(reviewLabel, button('К основной тренировке', 'secondary', leaveReview));
  const list = el('div', 'cue-list');
  setAttr(list, 'aria-label', 'Субтитры с пропусками');
  const footer = el('footer', 'footer');
  const hint = el('span', 'hint', 'Enter — проверить · можно исправить ответ');
  const pauseLabel = el('label', 'pause-option');
  const autoPause = el('input');
  autoPause.type = 'checkbox';
  listen(autoPause, 'change', () => {
    prefs.autoPause = autoPause.checked;
    preferenceChanges.autoPause = prefs.autoPause;
    saveNow();
  });
  pauseLabel.append(autoPause, el('span', '', 'Пауза в конце строки'));
  footer.append(hint, pauseLabel);
  const saveStatus = el('span', 'save-status', 'Прогресс хранится на устройстве');
  saveStatus.setAttribute('role', 'status');
  footer.append(saveStatus);
  lesson.append(heading, toolbar, sources, notice, retry, reviewBar, list, footer);
  shell.append(header, lesson);
  shadow.append(shell);
  const settingsDialog = el('dialog', 'settings-dialog');
  setAttr(settingsDialog, 'aria-label', 'Настройки тренировки');
  settingsDialog.append(el('h2', '', 'Подстрой под себя'));
  const settingsGrid = el('div', 'settings-grid');
  const field = (labelText, node) => {
    const label = el('label', 'setting', labelText);
    label.append(node);
    settingsGrid.append(label);
    return node;
  };
  const choice = (labelText, values) => {
    const node = el('select');
    for (const [value, text] of values) {
      const item = el('option', '', text);
      item.value = value;
      node.append(item);
    }
    return field(labelText, node);
  };
  const languageSelect = choice('Язык интерфейса', [
    ['auto', 'По языку браузера'],
    ['ru', 'Русский'],
    ['en', 'English'],
  ]);
  const difficulty = choice('Сложность', [
    ['easy', 'Лёгкая'],
    ['balanced', 'Обычная'],
    ['hard', 'Сложная'],
    ['adaptive', 'Адаптивная'],
  ]);
  const gapFrequency = choice('Частота пропусков', [
    ['dense', 'Часто'],
    ['normal', 'Обычно'],
    ['sparse', 'Редко'],
  ]);
  const videoSize = choice('Размер видео', [
    ['small', 'Компактное'],
    ['medium', 'Среднее'],
    ['large', 'Большое'],
  ]);
  const fontSize = field('Размер текста', el('input'));
  fontSize.type = 'number';
  fontSize.min = '14';
  fontSize.max = '26';
  fontSize.step = '1';
  const visibleRows = choice(
    'Количество строк',
    [3, 4, 5, 6, 7].map((n) => [String(n), String(n)]),
  );
  const offsetInput = field('Сдвиг субтитров, секунды', el('input'));
  offsetInput.type = 'number';
  offsetInput.min = '-30';
  offsetInput.max = '30';
  offsetInput.step = '0.1';
  settingsDialog.append(
    settingsGrid,
    el(
      'p',
      'setting-help',
      '+ задерживает субтитры, − показывает раньше. Например, +1,5 — на полторы секунды позже.',
    ),
  );
  settingsDialog.append(
    el(
      'p',
      'setting-help',
      'Сложность меняет только ещё не начатые задания. На небольшом экране видимых строк может быть меньше выбранного числа.',
    ),
  );
  settingsDialog.append(
    button('Мои занятия', 'secondary', openLibrary),
    button('Закрыть настройки', 'primary', () => settingsDialog.close()),
  );
  const summaryDialog = el('dialog', 'summary-dialog');
  setAttr(summaryDialog, 'aria-label', 'Разбор ошибок');
  const sourceDialog = el('dialog', 'modal source-dialog');
  const sourceDialogTitle = el('h2', '', 'Сменить источник субтитров?');
  sourceDialogTitle.id = 'source-change-title';
  sourceDialog.setAttribute('aria-labelledby', sourceDialogTitle.id);
  const sourceDialogActions = el('div', 'dialog-actions');
  sourceDialogActions.append(
    button('Отмена', 'secondary', () => sourceDialog.close('cancel')),
    button('Сменить субтитры', 'primary', () => sourceDialog.close('confirm')),
  );
  sourceDialog.append(
    sourceDialogTitle,
    el(
      'p',
      '',
      'Смена субтитров начнёт новую тренировку и удалит текущие ответы, ошибки и подсказки для этого видео.',
    ),
    sourceDialogActions,
  );
  shadow.append(settingsDialog, summaryDialog, sourceDialog);
  listen(languageSelect, 'change', () => {
    prefs.language = languageSelect.value;
    preferenceChanges.language = prefs.language;
    applyLanguage();
    saveNow();
  });
  listen(difficulty, 'change', () => {
    prefs = exercise.preferences({ ...prefs, difficulty: difficulty.value });
    preferenceChanges.difficulty = prefs.difficulty;
    rebuildUntouchedTasks();
    saveNow();
  });
  listen(gapFrequency, 'change', () => {
    prefs = exercise.preferences({ ...prefs, gapFrequency: gapFrequency.value });
    preferenceChanges.gapFrequency = prefs.gapFrequency;
    rebuildUntouchedTasks();
    saveNow();
  });
  for (const node of [videoSize, fontSize, visibleRows])
    listen(node, 'change', () => {
      prefs = exercise.preferences({
        ...prefs,
        videoSize: videoSize.value,
        fontSize: fontSize.value,
        visibleRows: visibleRows.value,
      });
      const key = node === videoSize ? 'videoSize' : node === fontSize ? 'fontSize' : 'visibleRows';
      preferenceChanges[key] = prefs[key];
      applyPreferences();
      saveNow();
    });
  listen(offsetInput, 'change', () => {
    offset = Number.isFinite(Number(offsetInput.value))
      ? Math.max(-30, Math.min(30, Number(offsetInput.value)))
      : 0;
    rows.forEach((row, index) => {
      setRawText(row.timestamp, formatTime(tasks[index].start + offset));
      setAttr(row.timestamp, 'aria-label', 'Повторить с {time}', {
        time: row.timestamp.textContent,
      });
    });
    if (ready && !busy && noticeState !== 'error') setNotice('source');
    offsetInput.value = offset;
    stopSlowReplay();
    pausedAt = -1;
    previousTime = captionTime();
    tick();
    saveNow();
  });
  const pageStyle = el('style');
  pageStyle.textContent = `
    html.lp-active { --lp-width:min(900px,calc(100vw - 40px),71.111vh); --lp-height:min(506.25px,calc((100vw - 40px)*9/16),40vh); }
    html.lp-active body { overflow:hidden!important; }
    html.lp-active body > :not(#lingo-practice-root) { visibility:hidden!important; }
    html.lp-active body > ytd-app { position:relative!important; z-index:2147483001!important; pointer-events:none!important; }
    html.lp-active #lingo-practice-root { visibility:visible!important; position:fixed!important; inset:0!important; z-index:2147483000!important; }
    html.lp-active .lp-player { visibility:visible!important; pointer-events:auto!important; position:fixed!important; top:78px!important; left:50%!important; transform:translateX(-50%)!important; width:var(--lp-width)!important; height:var(--lp-height)!important; min-height:0!important; margin:0!important; z-index:2147483001!important; border-radius:14px!important; overflow:hidden!important; box-shadow:0 12px 60px #0007!important; }
    html.lp-active .lp-player .html5-video-container { width:100%!important; height:100%!important; }
    html.lp-active .lp-player video { width:100%!important; height:100%!important; left:0!important; top:0!important; object-fit:contain!important; }
    html.lp-active .lp-player .caption-window-container { display:none!important; }
    html.lp-active .lp-player .ytp-fullscreen-button, html.lp-active .lp-player .ytp-size-button, html.lp-active .lp-player .ytp-miniplayer-button { display:none!important; }
  `;
  document.head.append(pageStyle);
  document.body.append(host);
  const layoutStyle = el('style');
  document.head.append(layoutStyle);
  player.classList.add('lp-player');
  document.documentElement.classList.add('lp-active');
  globalThis.LingoLesson = { close };
  window.dispatchEvent(new Event('resize'));

  function close() {
    if (disposed) return;
    saveNow();
    stopSlowReplay();
    disposed = true;
    revision++;
    if (sourceDialog.open) sourceDialog.close('cancel');
    abort.abort();
    mediaAbort?.abort();
    rowAbort.abort();
    clearInterval(interval);
    settingsDialog.close();
    summaryDialog.close();
    player.classList.remove('lp-player');
    document.documentElement.classList.remove('lp-active');
    host.remove();
    pageStyle.remove();
    layoutStyle.remove();
    delete globalThis.LingoLesson;
    window.dispatchEvent(new Event('resize'));
  }
  async function request(action, trackIndex) {
    const result = await chrome.runtime.sendMessage({
      type: 'LINGO_YOUTUBE',
      action,
      videoId,
      trackIndex,
    });
    if (result?.error) throw new Error(result.error);
    if (!result) throw new Error('Расширение не ответило. Обновите страницу YouTube.');
    return result;
  }
  const captionTime = () => video.currentTime - offset;
  const isAd = () =>
    player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  function applyLanguage() {
    host.lang = language();
    languageSelect.value = prefs.language;
    for (const node of shadow.querySelectorAll('[data-i18n]')) {
      const text = t(node.dataset.i18n, JSON.parse(node.dataset.i18nParams));
      if (node.firstChild?.nodeType === Node.TEXT_NODE) node.firstChild.data = text;
      else node.prepend(document.createTextNode(text));
    }
    for (const node of shadow.querySelectorAll('[data-i18n-attrs]')) {
      for (const [name, { key, parameters }] of Object.entries(localizedAttributes.get(node)))
        node.setAttribute(name, t(key, parameters));
    }
    for (const node of select.querySelectorAll('[data-source-label]'))
      node.textContent = translateSource(node.dataset.sourceLabel);
    notice.dataset.adMessage = t('Реклама · задания приостановлены. ');
    setText(play, video.paused ? 'Продолжить' : 'Пауза');
    paintNotice();
  }
  function applyPreferences() {
    difficulty.value = prefs.difficulty;
    gapFrequency.value = prefs.gapFrequency;
    videoSize.value = prefs.videoSize;
    fontSize.value = prefs.fontSize;
    visibleRows.value = prefs.visibleRows;
    autoPause.checked = prefs.autoPause;
    offsetInput.value = offset;
    const height = { small: 26, medium: 34, large: 42 }[prefs.videoSize];
    layoutStyle.textContent = `html.lp-active { --lp-width:min(900px,calc(100vw - 40px),${(height * 16) / 9}vh); --lp-height:min(506.25px,calc((100vw - 40px)*9/16),${height}vh); }`;
    host.style.setProperty('--lp-font', prefs.fontSize + 'px');
    host.style.setProperty('--lp-row-height', Math.ceil(prefs.fontSize * 2.1 + 34) + 'px');
    host.style.setProperty(
      '--lp-list-max',
      prefs.visibleRows * Math.ceil(prefs.fontSize * 2.1 + 43) + 'px',
    );
    applyLanguage();
    window.dispatchEvent(new Event('resize'));
  }
  function translateSource(label) {
    const automatic = ' · автоматические';
    return label.endsWith(automatic) ? label.slice(0, -automatic.length) + t(automatic) : t(label);
  }
  function sourceNotice() {
    return (
      (sourceSelection === 'file' ? sourceLabel : translateSource(sourceLabel)) +
      (approximate ? t(' · время округлено до секунд; окончание строки приблизительное') : '') +
      (offset ? t(' · сдвиг {offset} с', { offset: (offset > 0 ? '+' : '') + offset }) : '')
    );
  }
  function setNotice(state, message = '') {
    noticeState = state;
    noticeMessage = message;
    paintNotice();
  }
  function paintNotice() {
    notice.className =
      'notice' + (['loading', 'error'].includes(noticeState) ? ' ' + noticeState : '');
    setRawText(
      notice,
      noticeState === 'loading'
        ? t('Загружаем субтитры…')
        : noticeState === 'restored'
          ? t('Тренировка восстановлена · {source}', { source: sourceNotice() })
          : noticeState === 'source'
            ? sourceNotice()
            : t(noticeMessage) +
              (noticeState === 'error' && ready ? t(' Текущая тренировка сохранена.') : ''),
    );
  }
  async function storage(action, payload = {}) {
    const result = await chrome.runtime.sendMessage({
      type: 'LINGO_STORE',
      action,
      videoId,
      ...payload,
    });
    if (result?.error)
      throw Object.assign(new Error(result.error), {
        code: result.code,
      });
    if (!result) throw new Error('Обновите расширение: сохранение прогресса недоступно.');
    return result;
  }
  function saveNow() {
    if (!initialized || disposed || saveBlocked) return Promise.resolve(false);
    lastSave = Date.now();
    if (
      !review &&
      ready &&
      !isAd() &&
      video.isConnected &&
      new URL(location.href).searchParams.get('v') === videoId
    )
      lastPosition = video.currentTime;
    const base = review?.base ?? tasks;
    const session = base.length
      ? {
          schema: 2,
          videoId,
          title: title.textContent,
          sourceLabel,
          sourceSelection,
          approximate,
          offset,
          difficulty: prefs.difficulty,
          gapFrequency: prefs.gapFrequency,
          position: review?.position ?? lastPosition,
          tasks: base.map((task) => ({ ...task })),
          updatedAt: Date.now(),
        }
      : null;
    const changed = preferenceChanges;
    preferenceChanges = {};
    setText(saveStatus, 'Сохраняем…');
    return storage('save', {
      session,
      writerId,
      version: storageVersion,
      storageEpoch,
      ...(Object.keys(changed).length ? { preferences: changed } : {}),
    })
      .then((result) => {
        storageVersion = Math.max(storageVersion, result.version ?? 0);
        storageEpoch = result.storageEpoch ?? storageEpoch;
        if (!disposed) {
          setText(saveStatus, 'Сохранено на устройстве');
          saveStatus.classList.remove('error');
        }
        return true;
      })
      .catch((error) => {
        if (error.code === 'EPOCH_CONFLICT') saveBlocked = true;
        else
          for (const [key, value] of Object.entries(changed))
            if (prefs[key] === value && !(key in preferenceChanges)) preferenceChanges[key] = value;
        if (!disposed) {
          setText(
            saveStatus,
            error.code === 'EPOCH_CONFLICT'
              ? error.message
              : error.code === 'REVISION_CONFLICT' || error.message.includes('другой вкладке')
                ? 'Прогресс обновлён в другой вкладке. Переоткройте тренировку.'
                : 'Прогресс не сохранён',
          );
          setAttr(saveStatus, 'title', error.message);
          saveStatus.classList.add('error');
        }
        return false;
      });
  }
  async function boot() {
    try {
      const saved = await storage('get');
      if (disposed) return;
      storageVersion = saved.version ?? 0;
      storageEpoch = saved.storageEpoch ?? 0;
      wordProfile = exercise.restoreWordProfile(saved.wordProfile);
      prefs = exercise.preferences(saved.preferences);
      const session = exercise.restoreSession(saved.session, videoId);
      if (session) {
        tasks = session.tasks;
        sourceLabel = session.sourceLabel;
        sourceSelection = session.sourceSelection;
        approximate = session.approximate;
        prefs.difficulty = session.difficulty;
        prefs.gapFrequency = session.gapFrequency;
        offset = session.offset;
        setRawText(title, session.title);
        if (![...select.options].some((o) => o.value === sourceSelection))
          option(sourceSelection, sourceLabel);
        select.value = sourceSelection;
        pendingSeek = session.position;
        lastPosition = session.position;
        initialized = true;
        ready = true;
        applyPreferences();
        draw();
        tick();
        setNotice('restored');
        setText(saveStatus, 'Прогресс восстановлен');
        return;
      }
    } catch (error) {
      setText(saveStatus, 'Сохранение недоступно');
      setAttr(saveStatus, 'title', error.message);
      saveStatus.classList.add('error');
    }
    if (disposed) return;
    initialized = true;
    applyPreferences();
    load('auto');
  }
  function draw() {
    rowAbort.abort();
    rowAbort = new AbortController();
    current = -1;
    pausedAt = -1;
    rows = tasks.map(renderCue);
    list.replaceChildren(...rows.map((row) => row.node));
    repeat.disabled = !ready;
    follow.disabled = !ready;
    summaryButton.disabled = !ready || Boolean(review);
    updateStats();
    tick();
  }
  function setSourceBusy(value) {
    busy = value;
    select.disabled = value || Boolean(review);
    importButton.disabled = value || Boolean(review);
  }
  async function openLibrary() {
    await saveNow();
    if (disposed) return;
    settingsDialog.close();
    await chrome.runtime.openOptionsPage();
  }
  function confirmSourceChange(returnFocus) {
    return new Promise((resolve) => {
      const finish = (confirmed) => {
        sourceDialog.removeEventListener('close', onClose);
        signal.removeEventListener('abort', onAbort);
        setSourceBusy(false);
        if (!disposed) returnFocus?.focus();
        resolve(confirmed);
      };
      const onClose = () => finish(sourceDialog.returnValue === 'confirm');
      const onAbort = () => finish(false);
      sourceDialog.returnValue = 'cancel';
      sourceDialog.addEventListener('close', onClose, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      sourceDialog.showModal();
    });
  }
  function rebuildUntouchedTasks() {
    tasks = exercise.createTasks(tasks, {
      random: Math.random,
      difficulty: prefs.difficulty,
      gapFrequency: prefs.gapFrequency,
      wordProfile,
      previousTasks: tasks,
    });
    if (ready) draw();
  }
  async function commit(cues, label, selection, rounded = false, returnFocus = select) {
    const nextTasks = exercise.createTasks(cues, {
      random: Math.random,
      difficulty: prefs.difficulty,
      gapFrequency: prefs.gapFrequency,
      wordProfile,
    });
    if (!nextTasks.some((task) => task.answer))
      throw new Error('В субтитрах не найдено слов для пропусков.');
    if (ready && exercise.hasUserWork(review?.base ?? tasks)) {
      const confirmed = await confirmSourceChange(returnFocus);
      if (disposed) return false;
      if (!confirmed) {
        select.value = sourceSelection;
        setNotice('source');
        return false;
      }
    }
    if (review) leaveReview();
    stopSlowReplay();
    tasks = nextTasks;
    sourceLabel = label;
    sourceSelection = selection;
    approximate = rounded;
    offset = 0;
    offsetInput.value = '0';
    if (selection === 'file' && ![...select.options].some((o) => o.value === 'file'))
      option('file', label);
    if (selection === 'file')
      setRawText(
        [...select.options].find((o) => o.value === 'file'),
        label,
      );
    select.value = selection;
    ready = true;
    failedSelection = null;
    retry.hidden = true;
    setNotice('source');
    previousTime = captionTime();
    draw();
    saveNow();
    return true;
  }
  async function importFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    const ticket = ++revision;
    setSourceBusy(true);
    retry.hidden = true;
    try {
      if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('Выберите файл .srt или .vtt.');
      if (file.size > 2_000_000) throw new Error('Файл слишком большой: максимум 2 МБ.');
      const cues = exercise.parseSubtitles(await file.text());
      if (disposed || ticket !== revision) return;
      await commit(cues, file.name, 'file', false, importButton);
    } catch (error) {
      if (!disposed && ticket === revision) setNotice('error', error.message);
    } finally {
      fileInput.value = '';
      if (!disposed && ticket === revision) setSourceBusy(false);
    }
  }
  async function load(desired = select.value) {
    if (desired === 'file') {
      select.value = sourceSelection;
      fileInput.click();
      return;
    }
    const ticket = ++revision;
    setSourceBusy(true);
    retry.hidden = true;
    setNotice('loading');
    try {
      const metadata = await request('tracks');
      if (disposed || ticket !== revision) return;
      if (metadata.title) setRawText(title, metadata.title);
      else setText(title, 'Тренировка аудирования');
      while (select.options.length > 2) select.remove(2);
      for (const track of metadata.tracks) option(String(track.index), track.label);
      if (![...select.options].some((item) => item.value === sourceSelection))
        option(sourceSelection, sourceLabel);
      const result = await request(
        desired === 'transcript' ? 'transcript' : 'load',
        /^\d+$/.test(desired) ? Number(desired) : null,
      );
      if (disposed || ticket !== revision) return;
      const cues = result.json
        ? exercise.parseJson3(result.json)
        : exercise.normalizeCues(result.cues ?? []);
      if (!cues.length)
        throw new Error('В этой дорожке нет слов для тренировки. Выберите другой источник.');
      await commit(cues, result.source, desired, result.approximate);
    } catch (error) {
      if (disposed || ticket !== revision) return;
      failedSelection = desired;
      select.value = sourceSelection;
      setNotice('error', error.message);
      retry.hidden = false;
    } finally {
      if (!disposed && ticket === revision) setSourceBusy(false);
    }
  }
  function renderCue(task, index) {
    const node = el('div', 'cue');
    node.dataset.cueRow = index;
    const timestamp = button(
      formatTime(Math.max(0, task.start + offset)),
      'timestamp',
      () => repeatCue(index),
      rowAbort.signal,
    );
    setAttr(timestamp, 'aria-label', 'Повторить с {time}', { time: timestamp.textContent });
    const sentence = el('div', 'sentence');
    const input = el('input', 'answer');
    input.type = 'text';
    input.dataset.cue = index;
    setAttr(input, 'aria-label', 'Пропущенное слово, строка {number}', { number: index + 1 });
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.spellcheck = false;
    input.placeholder = '________';
    input.maxLength = 100;
    sentence.append(document.createTextNode(task.before));
    if (task.answer) sentence.append(input);
    sentence.append(document.createTextNode(task.after));
    const feedback = el('span', 'feedback');
    feedback.id = 'feedback-' + index;
    feedback.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', feedback.id);
    const skip = button('Пропустить', 'skip', () => settle(index, 'skipped'), rowAbort.signal);
    skip.dataset.action = 'skip';
    skip.hidden = !task.answer;
    const help = button('Подсказка', 'hint-button', () => giveHint(index), rowAbort.signal);
    help.dataset.action = 'hint';
    const side = el('div', 'cue-side');
    side.append(feedback, help, skip);
    listen(
      input,
      'input',
      () => {
        task.value = input.value;
        if (task.status === 'wrong') task.status = 'pending';
        paintRow(task, { node, input, feedback, skip, help });
        saveNow();
      },
      { signal: rowAbort.signal },
    );
    node.append(timestamp, sentence, side);
    const row = { node, input, feedback, skip, help, timestamp };
    paintRow(task, row);
    return row;
  }
  function paintRow(task, row) {
    row.node.className = 'cue' + (task.status !== 'pending' ? ' ' + task.status : '');
    if (rows[current]?.node === row.node) row.node.classList.add('active');
    row.input.value = task.value;
    row.input.disabled = exercise.finished(task);
    row.input.setAttribute('aria-invalid', String(task.status === 'wrong'));
    if (exercise.finished(task)) row.input.style.width = task.answer.length + 1 + 'ch';
    row.skip.hidden = !task.answer || exercise.finished(task);
    row.help.hidden = row.skip.hidden;
    setText(
      row.help,
      ['Подсказка', 'Повторить медленнее', 'Показать слово'][Math.min(2, task.hints)],
    );
    setText(
      row.feedback,
      task.status === 'wrong'
        ? 'Попробуй ещё раз'
        : ({
            correct: 'Верно',
            assisted: 'Верно с подсказкой',
            revealed: 'Показано',
            skipped: 'Пропущено',
          }[task.status] ??
            (task.hints >= 2
              ? 'Повтор на скорости 0,75×'
              : task.hints === 1
                ? 'Первая буква: {letter}'
                : '')),
      { letter: [...(task.answer ?? '')][0] ?? '' },
    );
  }
  function settle(index, forcedStatus = null) {
    const task = tasks[index],
      row = rows[index];
    if (!task?.answer || exercise.finished(task) || isAd()) return;
    if (!forcedStatus && !exercise.matches(row.input.value, task.answer)) {
      task.status = 'wrong';
      task.mistakes++;
      paintRow(task, row);
      saveNow();
      return;
    }
    const previousTask = { ...task };
    task.status = forcedStatus ?? (task.hints ? 'assisted' : 'correct');
    task.value = task.answer;
    if (!review)
      wordProfile = exercise.updateWordProfile(wordProfile, [previousTask], [task], Date.now());
    paintRow(task, row);
    updateStats();
    saveNow();
    if (review && pausedAt === index && (video.ended || captionTime() >= task.end)) {
      advanceReview();
      return;
    }
    const next = tasks.findIndex((t, i) => i > index && t.answer && !exercise.finished(t));
    if (next >= 0) {
      rows[next].input.focus({ preventScroll: true });
      scrollToRow(next);
    }
  }
  function giveHint(index) {
    const task = tasks[index];
    if (!task?.answer || exercise.finished(task) || isAd()) return;
    task.hints = Math.min(3, task.hints + 1);
    if (task.hints === 3) {
      settle(index, 'revealed');
      return;
    }
    if (task.status === 'wrong') task.status = 'pending';
    paintRow(task, rows[index]);
    saveNow();
    if (task.hints === 2) repeatCue(index, true);
  }
  function updateStats() {
    const counts = exercise.resultCounts(tasks);
    setRawText(stats, `${counts.independent} / ${counts.total}`);
    const description =
      'Самостоятельно: {independent}. С подсказкой: {assisted}. Показано: {revealed}. Пропущено: {skipped}. Осталось: {remaining}.';
    setAttr(stats, 'title', description, counts);
    setAttr(stats, 'aria-label', description, counts);
    setText(
      hint,
      !counts.remaining
        ? 'Готово · самостоятельно {independent} · с подсказкой {assisted}'
        : 'Enter — проверить · ошибку можно исправить',
      counts,
    );
  }
  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    return value >= 3600
      ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
      : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  async function togglePlay() {
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setNotice('message', 'Нажмите кнопку воспроизведения на видео.');
      }
    } else video.pause();
  }
  function stopSlowReplay() {
    if (!slowReplay) return;
    const previous = slowReplay;
    slowReplay = null;
    if (previous.video.playbackRate === 0.75) previous.video.playbackRate = previous.rate;
  }
  async function repeatCue(index, slow = false) {
    if (isAd()) return;
    const focused = shadow.activeElement?.dataset?.cue;
    if (!Number.isInteger(index))
      index = focused !== undefined ? Number(focused) : current >= 0 ? current : 0;
    const task = tasks[index];
    if (!task) return;
    stopSlowReplay();
    if (review) {
      review.index = index;
      review.done = false;
    }
    if (slow) {
      slowReplay = {
        video,
        rate: video.playbackRate,
        start: Math.max(0, task.start + offset),
        end: task.end + offset,
      };
      video.playbackRate = 0.75;
    }
    pausedAt = -1;
    video.currentTime = Math.max(0, task.start + offset);
    previousTime = captionTime();
    try {
      await video.play();
    } catch {
      setNotice('message', 'Нажмите кнопку воспроизведения на видео.');
    }
    rows[index].input.focus({ preventScroll: true });
    scrollToRow(index);
  }
  function followCurrent() {
    const index = review ? review.index : exercise.activeIndex(tasks, captionTime());
    if (shadow.activeElement instanceof HTMLElement) shadow.activeElement.blur();
    if (index >= 0) scrollToRow(index);
  }
  function showSummary() {
    if (!ready || review) return;
    const counts = exercise.resultCounts(tasks),
      ended = video.ended || captionTime() >= (tasks.at(-1)?.end ?? Infinity);
    const difficult = tasks.filter((task) => exercise.isDifficult(task, ended));
    const summaryCounts = el('p', 'summary-counts');
    setText(
      summaryCounts,
      'Самостоятельно: {independent} · с подсказкой: {assisted} · показано: {revealed} · пропущено: {skipped} · без ответа: {remaining}',
      counts,
    );
    summaryDialog.replaceChildren(el('h2', '', 'Разбор ошибок'), summaryCounts);
    const entries = el('div', 'review-entries');
    for (const task of difficult) {
      const entry = el('article', 'review-entry');
      const details = el('small');
      setText(details, 'Ошибок: {mistakes} · подсказок: {hints}', {
        mistakes: task.mistakes,
        hints: task.hints,
      });
      entry.append(el('strong', '', task.answer, false), el('p', '', task.text, false), details);
      entry.append(
        button('↶ ' + formatTime(Math.max(0, task.start + offset)), 'secondary', () => {
          summaryDialog.close();
          repeatCue(tasks.indexOf(task));
        }),
      );
      entries.append(entry);
    }
    if (!difficult.length)
      entries.append(
        el(
          'p',
          '',
          'Пока нет сложных слов. Здесь появятся ошибки, пропуски и ответы с подсказками.',
        ),
      );
    summaryDialog.append(entries);
    const actions = el('div', 'dialog-actions');
    const replay = button('Повторить сложные места', 'primary', () => startReview(difficult));
    replay.disabled = !difficult.length;
    actions.append(
      replay,
      button('Закрыть разбор', 'secondary', () => summaryDialog.close()),
    );
    summaryDialog.append(actions);
    summaryDialog.showModal();
  }
  function startReview(difficult) {
    if (!difficult.length || isAd()) return;
    summaryDialog.close();
    stopSlowReplay();
    review = { base: tasks, position: video.currentTime, index: 0, done: false };
    tasks = difficult.map((task, id) => ({
      ...task,
      id,
      value: '',
      status: 'pending',
      mistakes: 0,
      hints: 0,
    }));
    reviewBar.hidden = false;
    setSourceBusy(busy);
    difficulty.disabled = true;
    gapFrequency.disabled = true;
    draw();
    repeatCue(0);
  }
  function advanceReview() {
    if (!review || review.done) return;
    stopSlowReplay();
    if (review.index + 1 >= tasks.length) {
      review.done = true;
      video.pause();
      setText(reviewLabel, 'Повтор завершён. Основная оценка сохранена.');
      return;
    }
    review.index++;
    repeatCue(review.index);
  }
  function leaveReview() {
    if (!review) return;
    stopSlowReplay();
    video.pause();
    const previous = review;
    review = null;
    tasks = previous.base;
    video.currentTime = previous.position;
    lastPosition = previous.position;
    previousTime = captionTime();
    reviewBar.hidden = true;
    setSourceBusy(busy);
    difficulty.disabled = false;
    gapFrequency.disabled = false;
    setNotice('source');
    draw();
    saveNow();
  }
  function scrollToRow(index) {
    const row = rows[index]?.node;
    if (!row) return;
    const viewport = list.getBoundingClientRect(),
      bounds = row.getBoundingClientRect();
    const target =
      bounds.height > list.clientHeight ? rows[index].input.getBoundingClientRect() : bounds;
    list.scrollTo({
      top: Math.max(
        0,
        list.scrollTop +
          target.top -
          viewport.top -
          Math.max(0, (list.clientHeight - target.height) / 2),
      ),
      behavior: 'auto',
    });
  }
  function tick() {
    if (disposed) return;
    if (
      new URL(location.href).searchParams.get('v') !== videoId ||
      location.pathname !== '/watch'
    ) {
      close();
      return;
    }
    if (!video.isConnected || !player.isConnected || !player.contains(video)) {
      const replacement = document.querySelector('#movie_player');
      const media = replacement?.querySelector('video');
      if (!media) return; // YouTube can briefly remove the player while switching its internal layout.
      stopSlowReplay();
      player.classList.remove('lp-player');
      player = replacement;
      video = media;
      player.classList.add('lp-player');
      pausedAt = -1;
      previousTime = captionTime();
      bindMedia();
    }
    const ad = isAd();
    shell.classList.toggle('ad-playing', ad);
    if (ad) {
      stopSlowReplay();
      previousTime = captionTime();
      return;
    }
    if (!ready) return;
    if (pendingSeek !== null && video.readyState >= 1 && Number.isFinite(video.duration)) {
      const position = Math.min(pendingSeek, Math.max(0, video.duration - 0.05));
      pendingSeek = null;
      video.pause();
      video.currentTime = position;
      previousTime = captionTime();
    }
    if (
      slowReplay &&
      (video.currentTime >= slowReplay.end || video.currentTime < slowReplay.start - 0.25)
    )
      stopSlowReplay();
    const time = captionTime();
    if (
      review &&
      !review.done &&
      !video.seeking &&
      (video.ended || (!video.paused && time >= tasks[review.index].end))
    ) {
      if (exercise.finished(tasks[review.index])) {
        advanceReview();
        return;
      }
      pausedAt = review.index;
      video.pause();
    }
    if (
      !review &&
      autoPause.checked &&
      !video.paused &&
      current >= 0 &&
      pausedAt < 0 &&
      tasks[current].answer &&
      !exercise.finished(tasks[current]) &&
      previousTime < tasks[current].end &&
      time >= tasks[current].end &&
      time - previousTime < 1.5
    ) {
      pausedAt = current;
      video.pause();
    }
    const index =
      pausedAt >= 0 ? pausedAt : review ? review.index : exercise.activeIndex(tasks, time);
    if (review && !review.done)
      setText(reviewLabel, 'Повтор сложных мест · {current} из {total}', {
        current: review.index + 1,
        total: tasks.length,
      });
    previousTime = time;
    if (!review) lastPosition = video.currentTime;
    if (!video.paused && Date.now() - lastSave > 2000) saveNow();
    if (index !== current) {
      if (current >= 0) {
        rows[current].node.classList.remove('active');
        rows[current].node.removeAttribute('aria-current');
      }
      current = index;
      if (current >= 0) {
        rows[current].node.classList.add('active');
        rows[current].node.setAttribute('aria-current', 'true');
        if (!shadow.activeElement?.matches('input[data-cue]')) scrollToRow(current);
      }
    }
  }
  // Capture before YouTube's document listeners while preserving native text editing.
  const guardKeys = (event) => {
    const insideLesson = event.composedPath().includes(host);
    const numpad = event.code.startsWith('Numpad') || event.location === 3;
    if (disposed || (!insideLesson && !numpad)) return;
    event.stopImmediatePropagation();
    if (!insideLesson) {
      event.preventDefault();
      return;
    }
    const target = event.composedPath()[0];
    if (
      event.type === 'keydown' &&
      event.key === 'Enter' &&
      target.matches?.('input[data-cue]') &&
      !event.isComposing &&
      !event.repeat
    ) {
      event.preventDefault();
      settle(Number(target.dataset.cue));
    }
  };
  for (const type of ['keydown', 'keyup', 'keypress'])
    listen(window, type, guardKeys, { capture: true });
  function bindMedia() {
    mediaAbort?.abort();
    mediaAbort = new AbortController();
    const on = (event, callback) =>
      video.addEventListener(event, callback, { signal: mediaAbort.signal });
    on('timeupdate', tick);
    on('seeked', () => {
      pausedAt = -1;
      previousTime = captionTime();
      tick();
      saveNow();
    });
    on('play', () => {
      pausedAt = -1;
      previousTime = captionTime();
      setText(play, 'Пауза');
      tick();
    });
    on('pause', () => {
      setText(play, 'Продолжить');
      stopSlowReplay();
      saveNow();
    });
    on('loadedmetadata', tick);
    on('ended', () => {
      tick();
      updateStats();
      saveNow();
    });
    setText(play, video.paused ? 'Продолжить' : 'Пауза');
  }
  bindMedia();
  listen(document, 'yt-navigate-finish', tick);
  listen(window, 'pagehide', saveNow);
  listen(document, 'visibilitychange', () => {
    if (document.hidden) saveNow();
  });
  interval = setInterval(tick, 200);
  boot();
})();
