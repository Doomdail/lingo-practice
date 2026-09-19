// Run with NODE_PATH pointing at a directory containing Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const runtimeFiles = [
  'manifest.json',
  'background.js',
  'youtube.js',
  'exercise.js',
  'data.js',
  'i18n.js',
  'content.js',
  'styles.css',
  'library.html',
  'library.js',
  'library.css',
  '_locales/en/messages.json',
  '_locales/ru/messages.json',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const task = (id, word, status = 'pending', patch = {}) => ({
  id,
  start: id * 3,
  end: id * 3 + 2,
  text: `Say ${word}`,
  before: 'Say ',
  answer: word,
  after: '',
  value: status === 'pending' ? '' : word,
  status,
  mistakes: 0,
  hints: 0,
  ...patch,
});
const lesson = (videoId, updatedAt, revision, patch = {}) => ({
  schema: 2,
  videoId,
  title: `Lesson ${videoId}`,
  sourceLabel: 'English',
  sourceSelection: 'auto',
  approximate: false,
  difficulty: 'balanced',
  gapFrequency: 'dense',
  offset: 0,
  position: 12,
  updatedAt,
  tasks: [task(0, 'hello', 'correct'), task(1, 'friend', 'assisted'), task(2, 'again')],
  revision,
  writerId: `writer-${videoId}`,
  ...patch,
});
const librarySeed = {
  'lesson:older01': lesson('older01', 10, 1, {
    position: 3,
    sourceLabel: 'English · автоматические',
  }),
  'lesson:newer01': lesson('newer01', 20, 4, {
    title: 'Мой новый урок',
    sourceLabel: 'Расшифровка YouTube · текущий язык',
    tasks: [
      task(0, 'hello', 'correct', {
        text: 'Привет, hello!',
        before: 'Привет, ',
        after: '!',
        mistakes: 2,
      }),
      task(1, 'friend', 'assisted', { hints: 1 }),
      task(2, 'again'),
    ],
  }),
  'lesson:broken': { videoId: 'broken', tasks: ['PRIVATE DAMAGED RECORD'] },
  preferences: {
    difficulty: 'balanced',
    gapFrequency: 'dense',
    language: 'ru',
    videoSize: 'medium',
    fontSize: 18,
    visibleRows: 5,
    autoPause: true,
    onboardingSeen: false,
  },
  wordProfile: {
    schema: 1,
    words: {
      hello: { attempts: 4, clean: 1, mistakes: 2, hints: 1, misses: 0, lastSeenAt: 20 },
      again: { attempts: 1, clean: 0, mistakes: 1, hints: 0, misses: 0, lastSeenAt: 30 },
    },
  },
  storageEpoch: 0,
};

function copyExtension(target) {
  for (const name of runtimeFiles) {
    const source = path.join(root, name);
    assert.ok(fs.existsSync(source), `runtime dependency exists: ${name}`);
    const destination = path.join(target, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

async function assertDialogReflow(page, dialog, actionName) {
  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const action = dialog.getByRole('button', { name: actionName, exact: true });
  await action.scrollIntoViewIfNeeded();
  const metrics = await dialog.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return {
      dialogHorizontalOverflow: element.scrollWidth > element.clientWidth,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      reachedBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      left: rectangle.left,
      right: rectangle.right,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(metrics.dialogHorizontalOverflow, false);
  assert.equal(metrics.documentHorizontalOverflow, false);
  assert.equal(metrics.reachedBottom, true);
  assert.ok(
    metrics.left >= 0 && metrics.right <= metrics.viewportWidth,
    `dialog must stay inside the viewport: ${JSON.stringify(metrics)}`,
  );
  const actionBox = await action.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(
    actionBox &&
      actionBox.x >= 0 &&
      actionBox.x + actionBox.width <= viewport.width &&
      actionBox.y >= 0 &&
      actionBox.y + actionBox.height <= viewport.height,
  );
}

(async () => {
  const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-library-extension-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-library-profile-'));
  copyExtension(installed);
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [`--disable-extensions-except=${installed}`, `--load-extension=${installed}`],
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    acceptDownloads: true,
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => {
      self.__libraryOriginalStorageGet = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async () => {
        throw new Error('forced storage failure');
      };
    });
    for (const expected of [
      {
        locale: 'ru-RU',
        language: 'ru',
        title: 'Мои занятия · Lingo Practice',
        heading: 'Мои занятия',
        refresh: 'Обновить библиотеку',
        error: 'Не удалось загрузить библиотеку. Не удалось сохранить или прочитать прогресс.',
      },
      {
        locale: 'en-US',
        language: 'en',
        title: 'My lessons · Lingo Practice',
        heading: 'My lessons',
        refresh: 'Refresh library',
        error: 'Could not load the library. Could not save or read progress.',
      },
    ]) {
      const failurePage = await context.newPage();
      await failurePage.addInitScript((locale) => {
        Object.defineProperty(Navigator.prototype, 'language', {
          configurable: true,
          get: () => locale,
        });
      }, expected.locale);
      await failurePage.goto(`chrome-extension://${extensionId}/library.html`);
      const loadError = failurePage.locator('#load-error:not([hidden])');
      await loadError.waitFor();
      assert.equal(await failurePage.locator('html').getAttribute('lang'), expected.language);
      assert.equal(await failurePage.title(), expected.title);
      await failurePage.getByRole('heading', { name: expected.heading, exact: true }).waitFor();
      await failurePage.getByRole('button', { name: expected.refresh, exact: true }).waitFor();
      assert.match(await loadError.innerText(), new RegExp(expected.error.replaceAll('.', '\\.')));
      await failurePage.close();
    }
    await worker.evaluate(() => {
      chrome.storage.local.get = self.__libraryOriginalStorageGet;
      delete self.__libraryOriginalStorageGet;
    });
    await worker.evaluate((seed) => chrome.storage.local.set(seed), librarySeed);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await page.getByRole('heading', { name: 'Занятия', exact: true }).waitFor();
    assert.deepEqual(
      await page
        .locator('[data-lesson-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.lessonId)),
      ['newer01', 'older01'],
    );
    assert.match(await page.locator('[data-lesson-id="newer01"]').innerText(), /2 \/ 3/);

    const invalidWarning = page.locator('#invalid-warning');
    assert.match(await invalidWarning.innerText(), /1/);
    assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE DAMAGED RECORD/);

    const exactLibraryUrl = page.url();
    await page.getByRole('link', { name: 'Данные и помощь', exact: true }).click();
    assert.equal(page.url(), exactLibraryUrl, 'section navigation must preserve the trusted URL');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'data-help');
    await page.getByRole('button', { name: 'Обновить библиотеку', exact: true }).click();
    await page.locator('[data-lesson-id="newer01"]').waitFor();

    const fragmentPagePromise = context.waitForEvent('page');
    await page
      .getByRole('link', { name: 'Трудные слова', exact: true })
      .click({ button: 'middle' });
    const fragmentPage = await fragmentPagePromise;
    await fragmentPage.locator('[data-lesson-id="newer01"]').waitFor({ timeout: 5000 });
    assert.equal(fragmentPage.url(), exactLibraryUrl);
    await fragmentPage.close();

    await context.route('https://www.youtube.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>YouTube fixture</title>',
      }),
    );
    const openedPromise = context.waitForEvent('page');
    await page
      .locator('[data-lesson-id="newer01"]')
      .getByRole('button', { name: 'Продолжить', exact: true })
      .click();
    const opened = await openedPromise;
    await opened.waitForURL('https://www.youtube.com/watch?v=newer01&t=12s');
    await opened.close();

    const deleteTrigger = page
      .locator('[data-lesson-id="newer01"]')
      .getByRole('button', { name: 'Удалить', exact: true });
    await deleteTrigger.click();
    const confirmDialog = page.getByRole('dialog');
    await confirmDialog.getByRole('heading', { name: 'Удалить занятие?', exact: true }).waitFor();
    assert.equal(await confirmDialog.locator('.dialog-message').innerText(), 'Мой новый урок');
    const focusTrace = [];
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      focusTrace.push(
        await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          id: document.activeElement?.id,
          text: document.activeElement?.textContent?.trim(),
          inDialog: Boolean(document.activeElement?.closest('dialog')),
        })),
      );
    }
    assert.equal(
      focusTrace.every(({ tag, inDialog }) => inDialog || tag === 'BODY'),
      true,
      'native modal focus cannot reach an outside control',
    );
    assert.equal(focusTrace.at(-1).inDialog, true);
    await confirmDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.equal(
      await deleteTrigger.evaluate((element) => element === document.activeElement),
      true,
    );

    await page.getByRole('link', { name: 'Трудные слова', exact: true }).click();
    assert.equal(page.url(), exactLibraryUrl);
    assert.deepEqual(
      await page
        .locator('[data-word]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.word)),
      ['hello', 'again', 'friend'],
    );
    const search = page.getByRole('searchbox', { name: 'Поиск по словам и контексту' });
    await search.fill('привет');
    assert.deepEqual(
      await page
        .locator('[data-word]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.word)),
      ['hello'],
    );
    await search.fill('no-match');
    await page.getByText('Ничего не найдено.', { exact: true }).waitFor();
    await search.fill('');
    await page.getByLabel('Сортировка').selectOption('recent');
    assert.deepEqual(
      await page
        .locator('[data-word]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.word)),
      ['again', 'hello', 'friend'],
    );

    const csvDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
    const csvPath = await (await csvDownloadPromise).path();
    const csv = fs.readFileSync(csvPath, 'utf8');
    assert.ok(csv.startsWith('\uFEFFword,context,'));
    assert.match(csv, /Привет, hello!/);
    assert.doesNotMatch(csv, /writerId|PRIVATE DAMAGED RECORD/);

    const helpTrigger = page.getByRole('button', { name: 'Как заниматься', exact: true });
    await helpTrigger.click();
    const helpDialog = page.getByRole('dialog');
    assert.equal(await helpDialog.locator('ol li').count(), 3);
    await helpDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    assert.equal(await helpTrigger.evaluate((element) => element === document.activeElement), true);
    assert.equal(
      await worker.evaluate(
        async () => (await chrome.storage.local.get('preferences')).preferences.onboardingSeen,
      ),
      false,
      'manual help must not mark onboarding as seen',
    );

    const exportTrigger = page.getByRole('button', {
      name: 'Экспортировать резервную копию',
      exact: true,
    });
    await exportTrigger.click();
    const exportDialog = page.getByRole('dialog');
    assert.match(
      await exportDialog.innerText(),
      /открытый текст субтитров.*правильные.*введённые/s,
    );
    const exportDownload = exportDialog.getByRole('button', { name: 'Скачать JSON', exact: true });
    await exportDownload.click();
    assert.match(await exportDialog.innerText(), /повреждённых записей: 1/);
    const backupDownloadPromise = page.waitForEvent('download');
    await exportDownload.click();
    const backupPath = await (await backupDownloadPromise).path();
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.format, 'lingo-practice-backup');
    assert.equal(backup.lessons.length, 2);
    assert.equal(JSON.stringify(backup).includes('writerId'), false);
    assert.equal(JSON.stringify(backup).includes('PRIVATE DAMAGED RECORD'), false);
    assert.equal(
      await exportTrigger.evaluate((element) => element === document.activeElement),
      true,
    );

    const importInput = page.getByLabel('Файл резервной копии');
    await importInput.setInputFiles({
      name: 'Моя копия.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const importDialog = page.getByRole('dialog');
    await page.waitForFunction(() => !document.querySelector('#apply-import').disabled);
    assert.match(await importDialog.innerText(), /Моя копия\.json/);
    assert.match(
      await importDialog.innerText(),
      /Добавлено: 0.*Обновлено занятий: 0.*Пропущено занятий: 2.*Обновлено слов: 0/s,
    );
    await importDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.equal(await importInput.evaluate((element) => element === document.activeElement), true);

    const clearTrigger = page.getByRole('button', { name: 'Удалить все данные', exact: true });
    await clearTrigger.click();
    const clearDialog = page.getByRole('dialog');
    assert.match(
      await clearDialog.innerText(),
      /Будут удалены занятия, ответы, настройки и статистика слов\./,
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await clearTrigger.evaluate((element) => element === document.activeElement),
      true,
    );

    await worker.evaluate(async () => {
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...preferences, language: 'en' } });
    });
    await page.reload();
    await page.getByRole('heading', { name: 'My lessons', exact: true }).waitFor();
    assert.equal(await page.locator('[data-lesson-id="newer01"] h3').innerText(), 'Мой новый урок');
    assert.match(
      await page.locator('[data-word="hello"] .word-context').innerText(),
      /Привет, hello!/,
    );
    assert.equal(await page.title(), 'My lessons · Lingo Practice');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.match(
      await page.locator('[data-lesson-id="newer01"]').innerText(),
      /Source: YouTube transcript · current language/,
    );
    assert.match(
      await page.locator('[data-lesson-id="older01"]').innerText(),
      /Source: English · auto-generated/,
    );

    const englishHelpTrigger = page.getByRole('button', { name: 'How to practice', exact: true });
    await englishHelpTrigger.click();
    const englishHelpDialog = page.getByRole('dialog');
    await englishHelpDialog
      .getByRole('heading', { name: 'How to practice', exact: true })
      .waitFor();
    assert.match(
      await englishHelpDialog.innerText(),
      /Choose a subtitle track or import SRT\/VTT.*Listen, fill in the word and press Enter.*Use replay and hints/s,
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await englishHelpTrigger.evaluate((element) => element === document.activeElement),
      true,
    );

    const englishExportTrigger = page.getByRole('button', {
      name: 'Export backup',
      exact: true,
    });
    await englishExportTrigger.click();
    const englishExportDialog = page.getByRole('dialog');
    await englishExportDialog
      .getByRole('heading', { name: 'Backup export', exact: true })
      .waitFor();
    assert.match(
      await englishExportDialog.innerText(),
      /plaintext captions.*correct answers.*entered answers/s,
    );
    await englishExportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await englishExportTrigger.evaluate((element) => element === document.activeElement),
      true,
    );

    await worker.evaluate(async () => {
      const key = 'lesson:newer01';
      const snapshot = await chrome.storage.local.get(key);
      await chrome.storage.local.set({
        [key]: { ...snapshot[key], revision: snapshot[key].revision + 1 },
      });
    });
    const englishDelete = page
      .locator('[data-lesson-id="newer01"]')
      .getByRole('button', { name: 'Delete', exact: true });
    await englishDelete.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#announcer').textContent ===
        'The lesson changed. Refresh the library.',
    );
    assert.equal(await page.locator('[data-lesson-id="newer01"]').count(), 1);

    const refreshedDelete = page
      .locator('[data-lesson-id="newer01"]')
      .getByRole('button', { name: 'Delete', exact: true });
    await refreshedDelete.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-lesson-id="newer01"]'));
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'lessons');

    const englishClear = page.getByRole('button', { name: 'Delete all data', exact: true });
    await englishClear.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete everything', exact: true })
      .click();
    await page.getByText('No saved lessons yet.', { exact: true }).waitFor();
    await page.getByText('No difficult words yet.', { exact: true }).waitFor();

    const raceBackupA = structuredClone(backup);
    raceBackupA.lessons = [backup.lessons.find(({ videoId }) => videoId === 'newer01')];
    const raceBackupB = structuredClone(backup);
    raceBackupB.lessons = [backup.lessons.find(({ videoId }) => videoId === 'older01')];
    assert.ok(raceBackupA.lessons[0] && raceBackupB.lessons[0]);
    await worker.evaluate(() => {
      self.__libraryImportMessages = [];
      self.__libraryImportObserver = (message) => {
        if (
          message?.type === 'LINGO_LIBRARY' &&
          ['previewImport', 'import'].includes(message.action)
        )
          self.__libraryImportMessages.push({
            action: message.action,
            lessons: message.backup?.lessons?.map(({ videoId }) => videoId) ?? [],
          });
      };
      chrome.runtime.onMessage.addListener(self.__libraryImportObserver);
    });
    await page.evaluate(() => {
      const originalText = File.prototype.text;
      let release;
      window.__restoreFileText = () => {
        File.prototype.text = originalText;
      };
      File.prototype.text = function () {
        if (this.name !== 'slow-a.json') return originalText.call(this);
        return new Promise((resolve, reject) => {
          release = () => originalText.call(this).then(resolve, reject);
        });
      };
      window.__releaseSlowFile = () => release();
    });
    const englishImport = page.getByLabel('Backup file');
    await englishImport.setInputFiles({
      name: 'slow-a.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(raceBackupA)),
    });
    const importRaceDialog = page.getByRole('dialog');
    await importRaceDialog.getByText('slow-a.json', { exact: true }).waitFor();
    await importRaceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await englishImport.setInputFiles({
      name: 'chosen-b.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(raceBackupB)),
    });
    await importRaceDialog.getByText('chosen-b.json', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#apply-import').disabled);
    await page.evaluate(() => window.__releaseSlowFile());
    await page.waitForTimeout(750);
    assert.match(await importRaceDialog.innerText(), /chosen-b\.json/);
    assert.deepEqual(
      await worker.evaluate(() => self.__libraryImportMessages),
      [{ action: 'previewImport', lessons: ['older01'] }],
      'closing the delayed file must prevent its preview request',
    );
    await importRaceDialog.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('[data-lesson-id="older01"]').waitFor();
    assert.equal(await page.locator('[data-lesson-id="newer01"]').count(), 0);
    assert.deepEqual(
      await page
        .locator('[data-lesson-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.lessonId)),
      ['older01'],
    );
    await worker.evaluate(() => {
      chrome.runtime.onMessage.removeListener(self.__libraryImportObserver);
      delete self.__libraryImportObserver;
      delete self.__libraryImportMessages;
    });
    await page.evaluate(() => {
      window.__restoreFileText();
      delete window.__restoreFileText;
      delete window.__releaseSlowFile;
    });

    const clearAfterRace = page.getByRole('button', { name: 'Delete all data', exact: true });
    await clearAfterRace.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete everything', exact: true })
      .click();
    await page.getByText('No saved lessons yet.', { exact: true }).waitFor();

    await englishImport.setInputFiles({
      name: 'Моя копия.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const restoreDialog = page.getByRole('dialog');
    await page.waitForFunction(() => !document.querySelector('#apply-import').disabled);
    assert.match(
      await restoreDialog.innerText(),
      /Added: 2.*Lessons updated: 0.*Lessons skipped: 0.*Words updated: 2/s,
    );
    assert.equal(await restoreDialog.getByLabel('Import settings').isChecked(), false);
    await worker.evaluate(() =>
      chrome.storage.local.set({
        wordProfile: {
          schema: 1,
          words: {
            hello: {
              attempts: 99,
              clean: 99,
              mistakes: 0,
              hints: 0,
              misses: 0,
              lastSeenAt: 999,
            },
          },
        },
      }),
    );
    await restoreDialog.getByRole('button', { name: 'Import', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#announcer').textContent ===
        'Data changed. Preview the import again.',
    );
    await page.waitForFunction(() =>
      document.querySelector('#import-summary').textContent.includes('Words updated: 1'),
    );
    await restoreDialog.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('[data-lesson-id="newer01"]').waitFor();
    assert.equal(await page.locator('[data-lesson-id]').count(), 2);

    const englishUi = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('.user-content').forEach((node) => {
        if (!node.parentElement?.matches('.lesson-card > .meta')) node.remove();
      });
      clone.querySelectorAll('dialog:not([open])').forEach((node) => node.remove());
      const holder = document.createElement('div');
      holder.hidden = true;
      holder.append(clone);
      document.documentElement.append(holder);
      const copy = holder.textContent;
      holder.remove();
      return copy;
    });
    assert.doesNotMatch(englishUi, /[А-Яа-яЁё]/u, 'English UI copy must not mix languages');

    await page.setViewportSize({ width: 320, height: 800 });
    await englishHelpTrigger.click();
    await assertDialogReflow(page, page.getByRole('dialog'), 'Close');
    await page.keyboard.press('Escape');
    assert.equal(
      await englishHelpTrigger.evaluate((element) => element === document.activeElement),
      true,
    );
    const longBackupName = `backup-${'very-long-name-'.repeat(12)}.json`;
    await englishImport.setInputFiles({
      name: longBackupName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(() => !document.querySelector('#apply-import').disabled);
    assert.match(await page.getByRole('dialog').innerText(), /Backup import.*Lessons skipped: 2/s);
    await assertDialogReflow(page, page.getByRole('dialog'), 'Import');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await englishImport.evaluate((element) => element === document.activeElement),
      true,
    );

    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await englishHelpTrigger.click();
    await assertDialogReflow(page, page.getByRole('dialog'), 'Close');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(
      await englishHelpTrigger.evaluate((element) => element === document.activeElement),
      true,
    );
    await englishImport.setInputFiles({
      name: longBackupName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(() => !document.querySelector('#apply-import').disabled);
    await assertDialogReflow(page, page.getByRole('dialog'), 'Import');
    await page.keyboard.press('Escape');
    assert.equal(
      await englishImport.evaluate((element) => element === document.activeElement),
      true,
    );

    for (const dialog of await page.locator('dialog').all()) {
      const labelledBy = await dialog.getAttribute('aria-labelledby');
      assert.ok(labelledBy && (await dialog.locator(`#${labelledBy}`).count()) === 1);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: lesson library, vocabulary, backup, deletion, help, languages and reflow');
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
