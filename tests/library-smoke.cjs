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
  'lesson:older01': lesson('older01', 10, 1, { position: 3 }),
  'lesson:newer01': lesson('newer01', 20, 4, {
    title: 'Мой новый урок',
    sourceLabel: 'Русская дорожка',
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

    const englishClear = page.getByRole('button', { name: 'Delete all data', exact: true });
    await englishClear.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete everything', exact: true })
      .click();
    await page.getByText('No saved lessons yet.', { exact: true }).waitFor();
    await page.getByText('No difficult words yet.', { exact: true }).waitFor();

    const englishImport = page.getByLabel('Backup file');
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
      clone.querySelectorAll('.user-content, dialog:not([open])').forEach((node) => node.remove());
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 320), true);
    const helpBox = await page
      .getByRole('button', { name: 'How to practice', exact: true })
      .boundingBox();
    assert.ok(helpBox && helpBox.x >= 0 && helpBox.x + helpBox.width <= 320);

    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 640), true);
    const clearBox = await page
      .getByRole('button', { name: 'Delete all data', exact: true })
      .boundingBox();
    assert.ok(clearBox && clearBox.x >= 0 && clearBox.x + clearBox.width <= 640);

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
