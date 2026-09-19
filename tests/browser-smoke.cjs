// Run with NODE_PATH pointing at a directory containing Playwright, or install it outside the extension.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(process.env.LINGO_EXTENSION_ROOT || path.join(__dirname, '..'));
const learningScenario = process.argv.includes('--learning');
const hasLibraryRuntime = ['library.html', 'library.js', 'library.css'].every((name) =>
  fs.existsSync(path.join(root, name)),
);

(async () => {
  assert.ok(fs.existsSync(path.join(root, 'manifest.json')), 'installable extension exists');
  const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-extension-'));
  const copyRuntime = (name, optional = false) => {
    const source = path.join(root, name);
    if (optional && !fs.existsSync(source)) return;
    fs.mkdirSync(path.dirname(path.join(installed, name)), { recursive: true });
    fs.copyFileSync(source, path.join(installed, name));
  };
  for (const name of [
    'manifest.json',
    'background.js',
    'youtube.js',
    'exercise.js',
    'data.js',
    'content.js',
    'styles.css',
    'i18n.js',
  ])
    copyRuntime(name);
  // Task 5 lands in a parallel worktree; include its runtime closure as soon as it is rebased here.
  for (const name of ['library.html', 'library.js', 'library.css']) copyRuntime(name, true);
  for (const name of [
    '_locales/en/messages.json',
    '_locales/ru/messages.json',
    ...['16', '32', '48', '128'].map((size) => `icons/icon${size}.png`),
  ])
    copyRuntime(name, true);
  // The test cannot click Chrome's toolbar. Grant the same host access as a real action click, in this temporary copy only.
  const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://www.youtube.com/*'];
  fs.writeFileSync(path.join(installed, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
  const context = await chromium.launchPersistentContext(
    fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-')),
    {
      channel: 'chromium',
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [`--disable-extensions-except=${installed}`, `--load-extension=${installed}`],
      viewport: { width: 1440, height: 1050 },
      locale: process.argv.includes('--i18n') ? 'en-US' : 'ru-RU',
    },
  );
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    let page = await context.newPage();
    const activate = () =>
      worker.evaluate(
        async ({ fixedRandom, stubOptions }) => {
          const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
          if (fixedRandom !== null || stubOptions)
            await chrome.scripting.executeScript({
              target: { tabId: tabs.at(-1).id },
              func: (value, replaceOptions) => {
                if (value !== null) Math.random = () => value;
                if (replaceOptions)
                  chrome.runtime.openOptionsPage = async () => {
                    document.documentElement.dataset.lingoLibraryOpened = 'true';
                  };
              },
              args: [fixedRandom, stubOptions],
            });
          await toggleTab(tabs.at(-1));
        },
        {
          fixedRandom: learningScenario ? 0.4 : null,
          stubOptions: learningScenario && !hasLibraryRuntime,
        },
      );
    const liveArg = process.argv.find((arg) => arg.startsWith('--live='));
    if (liveArg) {
      await page.addInitScript(() => {
        window.liveHold = (event) => {
          if (event.target instanceof HTMLVideoElement) event.target.pause();
        };
        document.addEventListener('play', window.liveHold, true);
      });
      await page.goto(liveArg.slice(7), { waitUntil: 'domcontentloaded' });
      const consent = page.getByRole('button', {
        name: /Reject all|Запретить использование файлов cookie/,
      });
      try {
        await consent.waitFor({ timeout: 5000 });
        await consent.click();
      } catch {}
      await page.locator('#movie_player video').waitFor();
      await page.evaluate(() => document.querySelector('video').pause());
      await page.waitForFunction(
        () => !!document.querySelector('ytd-video-description-transcript-section-renderer button'),
        {},
        { timeout: 20000 },
      );
      await activate();
      const answers = page.locator('#lingo-practice-root input[data-cue]');
      try {
        await answers.first().waitFor({ timeout: 25000 });
      } catch (error) {
        await page.screenshot({ path: path.join(root, 'output/playwright/live-failure.png') });
        console.log(
          await page.evaluate(() => ({
            url: location.href,
            root: !!document.querySelector('#lingo-practice-root'),
            lesson: document.querySelector('#lingo-practice-root')?.shadowRoot?.textContent,
            player: !!document.querySelector('#movie_player'),
            time: document.querySelector('video')?.currentTime,
            paused: document.querySelector('video')?.paused,
          })),
        );
        throw error;
      }
      const hiddenWord = await page.evaluate(
        () =>
          document.querySelector('#lingo-practice-root').shadowRoot.querySelector('.sentence')
            .textContent,
      );
      await page.evaluate(() => {
        document.querySelector('#movie_player video').currentTime = 3;
      });
      await page.waitForFunction(
        () => {
          const v = document.querySelector('#movie_player video');
          return !v.seeking && v.readyState >= 2;
        },
        {},
        { timeout: 10000 },
      );
      assert.ok(
        await page
          .locator('#movie_player video')
          .evaluate((e) => e.getBoundingClientRect().height > 200),
        'live video frame must remain visible',
      );
      assert.equal(
        await page.evaluate(() => {
          const p = document.querySelector('#movie_player'),
            r = p.getBoundingClientRect();
          return !!document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest('#movie_player');
        }),
        true,
        'live player must be above the lesson background',
      );
      console.log(
        JSON.stringify({
          url: page.url(),
          rows: await answers.count(),
          source: await page.locator('.notice').innerText(),
          maskedSentence: hiddenWord,
        }),
      );
      await page.screenshot({ path: path.join(root, 'output/playwright/live-youtube.png') });
      await page.evaluate(() => document.removeEventListener('play', window.liveHold, true));
      const first = answers.first();
      await first.fill('test');
      await first.press('k');
      assert.equal(
        await page.evaluate(() => document.querySelector('video').paused),
        true,
        'typing k must not start real YouTube',
      );
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      assert.equal(await page.locator('#lingo-practice-root').count(), 0);
      console.log('PASS: live YouTube captions, lesson rendering, keyboard protection and exit');
      return;
    }
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const captionData = {
      events: [
        { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'keyboard' }] },
        { tStartMs: 4000, dDurationMs: 4000, segs: [{ utf8: 'Hello, friend!' }] },
        { tStartMs: 8000, dDurationMs: 4000, segs: [{ utf8: "Don't stop believing." }] },
        { tStartMs: 12000, dDurationMs: 4000, segs: [{ utf8: 'Learning a little every day.' }] },
        {
          tStartMs: 16000,
          dDurationMs: 4000,
          segs: [
            {
              utf8: process.argv.includes('--learning')
                ? 'Hello, friend!'
                : 'Listen closely and try again.',
            },
          ],
        },
      ],
    };
    let emptyCaptions = false;
    await context.route('https://www.youtube.com/test-video.webm', (route) => {
      const bytes = fs.readFileSync(path.join(__dirname, 'fixture.webm'));
      const range = route
        .request()
        .headers()
        .range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0,
        end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: 'video/webm',
        body: bytes.subarray(start, end + 1),
        headers: {
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
      });
    });
    await context.route('https://www.youtube.com/api/timedtext**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: emptyCaptions ? '' : JSON.stringify(captionData),
      }),
    );
    await context.route('https://www.youtube.com/watch?**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body style="margin:0;background:#f4f4f4">
      <ytd-app style="position:relative;z-index:0"><header id="original-header">YouTube fixture</header><main><div id="movie_player" class="html5-video-player">
      <div class="html5-video-container" style="position:absolute;width:100%"><video style="position:absolute;background:#131c2c" src="/test-video.webm" preload="auto" controls></video></div><div class="caption-window-container">keyboard</div>
      </div><section id="comments">Original comments</section></main></ytd-app>
      <script>
      const video=document.querySelector('video');
      window.fixtureClock=t=>{document.querySelector('video').currentTime=t;};
      window.fixtureKeys=0;
      document.addEventListener('keydown',e=>{if(e.key==='k'){window.fixtureKeys++;video.paused?video.play():video.pause();}});
      const player=document.querySelector('#movie_player');
      player.getVideoData=()=>({video_id:new URL(location.href).searchParams.get('v'),title:'A little English, every day'});
      player.getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),title:'A little English, every day'},
        captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',name:{simpleText:'English'},baseUrl:'https://www.youtube.com/api/timedtext?v=fixture01'}]}}});
      </script></body></html>`,
      }),
    );
    await page.goto('https://www.youtube.com/watch?v=fixture01');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    if (learningScenario)
      await worker.evaluate(() => chrome.storage.local.set({ storageEpoch: 7 }));
    await activate();
    await page.locator('#lingo-practice-root').waitFor();
    let inputs = page.locator('#lingo-practice-root input[data-cue]');
    await inputs.first().waitFor();
    if (process.argv.includes('--learning')) {
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      assert.deepEqual(await page.getByLabel('Сложность').locator('option').allTextContents(), [
        'Лёгкая',
        'Обычная',
        'Сложная',
        'Адаптивная',
      ]);
      assert.deepEqual(
        await page.getByLabel('Частота пропусков').locator('option').allTextContents(),
        ['Часто', 'Обычно', 'Редко'],
      );
      assert.equal(
        await page.getByRole('button', { name: 'Мои занятия', exact: true }).count(),
        1,
        'settings expose the local lesson library',
      );
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      const denseAnswerCount = await inputs.count();
      assert.equal(denseAnswerCount, 5);
      assert.equal(
        await page.locator('[data-cue-row="1"] .sentence').evaluate((node) => node.firstChild.data),
        '',
        'the deterministic balanced fixture initially hides Hello',
      );
      await inputs.nth(1).fill('Hello');
      await inputs.nth(1).press('Enter');
      await page.getByText('Верно', { exact: true }).waitFor();
      await inputs.nth(2).fill('draft');
      const startedBefore = await page.locator('[data-cue-row="2"]').evaluate((node) => ({
        text: node.textContent,
        value: node.querySelector('input').value,
      }));
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByLabel('Сложность').selectOption('adaptive');
      assert.equal(
        await page.locator('[data-cue-row="4"] .sentence').evaluate((node) => node.firstChild.data),
        'Hello, ',
        'the in-memory clean answer profile changes a later adaptive gap',
      );
      await page.getByLabel('Частота пропусков').selectOption('sparse');
      await page.getByText('Сохранено на устройстве', { exact: true }).waitFor({ timeout: 3000 });
      const sparseAnswerCount = await inputs.count();
      assert.ok(sparseAnswerCount < denseAnswerCount, 'sparse frequency removes untouched gaps');
      assert.deepEqual(
        await page.locator('[data-cue-row="2"]').evaluate((node) => ({
          text: node.textContent,
          value: node.querySelector('input').value,
        })),
        startedBefore,
        'difficulty and frequency preserve a started task byte-for-byte',
      );
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      await activate();
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().waitFor();
      assert.equal(
        await inputs.count(),
        sparseAnswerCount,
        'restoring a session keeps exact task gaps',
      );
      assert.equal(await page.locator('[data-cue-row="2"] input').inputValue(), 'draft');
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      assert.equal(await page.getByLabel('Сложность').inputValue(), 'adaptive');
      assert.equal(await page.getByLabel('Частота пропусков').inputValue(), 'sparse');
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();

      const sourceSelect = page.getByLabel('Источник субтитров', { exact: true });
      const importInput = page.getByLabel('Файл субтитров');
      const importButton = page.getByRole('button', { name: 'Открыть SRT/VTT', exact: true });
      const sourceDialog = page.getByRole('dialog', { name: 'Сменить источник субтитров?' });
      const lessonSnapshot = () =>
        page.locator('.cue').evaluateAll((nodes) =>
          nodes.map((node) => ({
            className: node.className,
            text: node.textContent,
            value: node.querySelector('input')?.value ?? null,
            disabled: node.querySelector('input')?.disabled ?? null,
          })),
        );
      let candidate = 0;
      const uploadCandidate = async (word) => {
        const name = `candidate-${++candidate}.srt`;
        await importInput.setInputFiles({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${word}`),
        });
        return name;
      };
      const sourceState = () =>
        sourceSelect.evaluate((node) => ({
          value: node.value,
          label: node.selectedOptions[0]?.textContent ?? null,
        }));
      const assertCancelPreserves = async (word, escape = false, narrow = false) => {
        const before = await lessonSnapshot();
        const selected = await sourceState();
        await uploadCandidate(word);
        await sourceDialog.waitFor({ timeout: 3000 });
        if (narrow) {
          await page.setViewportSize({ width: 320, height: 800 });
          const layout = await sourceDialog.evaluate((dialog) => {
            const [first, second] = dialog.querySelectorAll('.dialog-actions > button');
            const firstBox = first.getBoundingClientRect();
            const secondBox = second.getBoundingClientRect();
            const dialogBox = dialog.getBoundingClientRect();
            return {
              fits:
                dialog.scrollWidth <= dialog.clientWidth &&
                dialogBox.left >= 0 &&
                dialogBox.right <= innerWidth,
              stacked: secondBox.top >= firstBox.bottom,
            };
          });
          assert.deepEqual(layout, { fits: true, stacked: true });
        }
        if (escape) await page.keyboard.press('Escape');
        else await sourceDialog.getByRole('button', { name: 'Отмена', exact: true }).click();
        await sourceDialog.waitFor({ state: 'hidden' });
        if (narrow) await page.setViewportSize({ width: 1440, height: 1050 });
        assert.deepEqual(await lessonSnapshot(), before);
        assert.deepEqual(await sourceState(), selected);
        assert.equal(
          await importButton.evaluate((node) => node.getRootNode().activeElement === node),
          true,
          'source cancellation returns focus to the import button',
        );
      };
      const confirmReplacement = async (word) => {
        const name = await uploadCandidate(word);
        await sourceDialog.waitFor({ timeout: 3000 });
        await sourceDialog.getByRole('button', { name: 'Сменить субтитры', exact: true }).click();
        await page.waitForFunction(
          (label) =>
            document.querySelector('#lingo-practice-root').shadowRoot.querySelector('.notice')
              .textContent === label,
          name,
        );
      };

      const restoredBeforeBrokenImport = await lessonSnapshot();
      await importInput.setInputFiles({
        name: 'broken.vtt',
        mimeType: 'text/vtt',
        buffer: Buffer.from('broken file'),
      });
      await page.locator('.notice.error').waitFor();
      assert.equal(await sourceDialog.count(), 0, 'invalid input never asks to replace the lesson');
      assert.deepEqual(await lessonSnapshot(), restoredBeforeBrokenImport);
      assert.equal(await page.locator('[data-cue-row="2"] input').inputValue(), 'draft');
      await importInput.setInputFiles({
        name: 'no-gaps.vtt',
        mimeType: 'text/vtt',
        buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000\nhttps://example.com'),
      });
      await page.waitForFunction(
        (message) =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelector('.notice')
            .textContent.startsWith(message),
        'В субтитрах не найдено слов для пропусков.',
      );
      assert.equal(await sourceDialog.count(), 0, 'a parsed candidate without gaps never asks');
      assert.deepEqual(await lessonSnapshot(), restoredBeforeBrokenImport);

      await assertCancelPreserves('Alpha', false, true); // existing correct answer and draft
      await confirmReplacement('Alpha');
      inputs = page.locator('#lingo-practice-root input[data-cue]');

      await inputs.first().fill('   ');
      await assertCancelPreserves('Bravo', true); // whitespace-only draft and Escape
      await confirmReplacement('Bravo');

      await inputs.first().fill('wrong');
      await inputs.first().press('Enter');
      await page.getByText('Попробуй ещё раз', { exact: true }).waitFor();
      await assertCancelPreserves('Charlie'); // mistake
      await confirmReplacement('Charlie');

      await page.locator('[data-cue-row="0"] [data-action="hint"]').click();
      await page.getByText('Первая буква: C', { exact: true }).waitFor();
      await assertCancelPreserves('Delta', true); // hint and Escape
      await confirmReplacement('Delta');

      await page.locator('[data-cue-row="0"] [data-action="skip"]').click();
      await page.getByText('Пропущено', { exact: true }).waitFor();
      await assertCancelPreserves('Echo'); // skipped
      await confirmReplacement('Echo');

      await inputs.first().fill('Echo');
      await inputs.first().press('Enter');
      await page.getByText('Верно', { exact: true }).waitFor();
      await assertCancelPreserves('Foxtrot', true); // correct and Escape

      await sourceSelect.selectOption('auto');
      await sourceDialog.waitFor({ timeout: 3000 });
      await sourceDialog.getByRole('button', { name: 'Сменить субтитры', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('#lingo-practice-root').shadowRoot.querySelector('.notice')
            .textContent === 'English',
      );
      await sourceSelect.selectOption('0');
      await page.waitForFunction(() => {
        const source = document
          .querySelector('#lingo-practice-root')
          .shadowRoot.querySelector('[aria-label="Источник субтитров"]');
        return source.value === '0' && !source.disabled;
      });
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().fill('track-draft');
      const beforeFailedFetch = await lessonSnapshot();
      const selectedBeforeFailedFetch = await sourceState();
      await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        window.task6OriginalPlayerResponse = player.getPlayerResponse;
        player.getPlayerResponse = () => {
          const response = window.task6OriginalPlayerResponse();
          return {
            ...response,
            captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
          };
        };
      });
      emptyCaptions = true;
      await sourceSelect.selectOption('auto');
      await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
      assert.equal(
        await sourceDialog.count(),
        0,
        'failed caption fetch never asks for confirmation',
      );
      assert.deepEqual(await lessonSnapshot(), beforeFailedFetch);
      assert.deepEqual(await sourceState(), selectedBeforeFailedFetch);
      await page.evaluate(() => {
        document.querySelector('#movie_player').getPlayerResponse =
          window.task6OriginalPlayerResponse;
        delete window.task6OriginalPlayerResponse;
      });
      emptyCaptions = false;
      await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
      await sourceDialog.waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await sourceDialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await lessonSnapshot(), beforeFailedFetch);
      assert.deepEqual(await sourceState(), selectedBeforeFailedFetch);
      assert.equal(
        await sourceSelect.evaluate((node) => node.getRootNode().activeElement === node),
        true,
        'track cancellation returns focus to the source select',
      );

      await confirmReplacement('Golf');
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().fill('wrong');
      await inputs.first().press('Enter');
      await page.getByText('Попробуй ещё раз', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Разбор ошибок', exact: true }).click();
      await page.getByRole('button', { name: 'Повторить сложные места', exact: true }).click();
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().fill('Golf');
      await inputs.first().press('Enter');
      await page.getByText('Верно', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'К основной тренировке', exact: true }).click();
      await confirmReplacement('Golf hotel');
      assert.equal(
        await page.locator('[data-cue-row="0"] .sentence').evaluate((node) => node.firstChild.data),
        '',
        'repeat review does not change the adaptive word profile',
      );
      await page.getByText('Сохранено на устройстве', { exact: true }).waitFor({ timeout: 3000 });
      await worker.evaluate(() => {
        const originalHandleLessonMessage = handleLessonMessage;
        let releaseBlockedSave = () => {};
        globalThis.task6SaveAttempts = 0;
        globalThis.task6BlockedSaveStarted = false;
        globalThis.task6ReleaseBlockedSave = () => releaseBlockedSave();
        handleLessonMessage = async (message) => {
          if (message.action === 'save') {
            globalThis.task6SaveAttempts++;
            if (
              !globalThis.task6BlockedSaveStarted &&
              message.session?.tasks.some((task) => task.value === 'barrier-draft')
            ) {
              globalThis.task6BlockedSaveStarted = true;
              await new Promise((resolve) => {
                releaseBlockedSave = resolve;
              });
            }
          }
          return originalHandleLessonMessage(message);
        };
      });
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().fill('barrier-draft');
      await worker.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + 3000;
            const poll = () => {
              if (globalThis.task6BlockedSaveStarted) resolve();
              else if (Date.now() >= deadline) reject(new Error('save did not reach worker'));
              else setTimeout(poll, 10);
            };
            poll();
          }),
      );
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      const pagesBeforeLibrary = context.pages().length;
      const libraryPagePromise = hasLibraryRuntime ? context.waitForEvent('page') : null;
      await page.getByRole('button', { name: 'Мои занятия', exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator('.settings-dialog').evaluate((node) => node.open),
        true,
        'library waits for the pending lesson save',
      );
      assert.equal(context.pages().length, pagesBeforeLibrary);
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.lingoLibraryOpened),
        undefined,
      );
      await worker.evaluate(() => globalThis.task6ReleaseBlockedSave());
      let libraryPage = null;
      if (hasLibraryRuntime) {
        libraryPage = await libraryPagePromise;
        await libraryPage.waitForLoadState('domcontentloaded');
        const listing = await libraryPage.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'LINGO_LIBRARY', action: 'list' }),
        );
        assert.equal(
          listing.lessons.some((lesson) => lesson.videoId === 'fixture01'),
          true,
        );
      } else {
        await page.waitForFunction(
          () => document.documentElement.dataset.lingoLibraryOpened === 'true',
        );
      }
      assert.equal(
        await worker.evaluate(async () => {
          await storageQueue;
          return (await chrome.storage.local.get('lesson:fixture01'))['lesson:fixture01'].tasks[0]
            .value;
        }),
        'barrier-draft',
        'the draft is committed before the library opens',
      );
      await libraryPage?.close();

      const attemptsBeforeConflict = await worker.evaluate(() => globalThis.task6SaveAttempts);
      await worker.evaluate(async () => {
        const { storageEpoch } = await chrome.storage.local.get('storageEpoch');
        await chrome.storage.local.set({ storageEpoch: storageEpoch + 1 });
      });
      await inputs.first().fill('stale-draft');
      await page
        .getByText(
          'Хранилище изменено. Закройте режим и откройте снова, чтобы загрузить свежий прогресс.',
          { exact: true },
        )
        .waitFor({ timeout: 3000 });
      const attemptsAfterConflict = await worker.evaluate(() => globalThis.task6SaveAttempts);
      assert.ok(attemptsAfterConflict > attemptsBeforeConflict);
      await inputs.first().fill('stale-again');
      await page.waitForTimeout(150);
      assert.equal(
        await worker.evaluate(() => globalThis.task6SaveAttempts),
        attemptsAfterConflict,
        'an epoch conflict permanently stops saves from this open lesson',
      );
      assert.equal(
        await worker.evaluate(async () => {
          await storageQueue;
          return (await chrome.storage.local.get('lesson:fixture01'))['lesson:fixture01'].tasks[0]
            .value;
        }),
        'barrier-draft',
        'the stale lesson never adopts the conflicting epoch',
      );

      await uploadCandidate('Hotel');
      await sourceDialog.waitFor({ timeout: 3000 });
      await page.evaluate(() => {
        window.task6ClosingFileInput = document
          .querySelector('#lingo-practice-root')
          .shadowRoot.querySelector('input[type=file]');
      });
      await activate();
      await page.locator('#lingo-practice-root').waitFor({ state: 'detached' });
      await page.waitForFunction(() => window.task6ClosingFileInput.value === '', null, {
        timeout: 3000,
      });
      await activate();
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().waitFor();
      assert.equal(await inputs.first().inputValue(), 'barrier-draft');
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(
        'PASS: adaptive learning, source protection, save barrier and terminal epoch handling',
      );
      return;
    }
    if (process.argv.includes('--i18n')) {
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 1500 });
      assert.equal(await page.locator('#lingo-practice-root').getAttribute('lang'), 'en');
      await inputs.first().fill('keyboard');
      await inputs.first().press('Enter');
      await page.getByText('Correct', { exact: true }).waitFor();
      await inputs.nth(1).fill('draft');
      await page.evaluate(() => window.fixtureClock(6));
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      assert.deepEqual(await page.getByLabel('Difficulty').locator('option').allTextContents(), [
        'Easy',
        'Balanced',
        'Hard',
        'Adaptive',
      ]);
      assert.deepEqual(await page.getByLabel('Gap frequency').locator('option').allTextContents(), [
        'Often',
        'Normal',
        'Rarely',
      ]);
      await page.getByRole('button', { name: 'My lessons', exact: true }).waitFor();
      await page.getByLabel('Interface language').selectOption('ru');
      await page.getByText('Подстрой под себя', { exact: true }).waitFor();
      assert.equal(await page.locator('#lingo-practice-root').getAttribute('lang'), 'ru');
      assert.equal(await inputs.first().inputValue(), 'keyboard');
      assert.equal(await inputs.first().isDisabled(), true);
      assert.equal(await inputs.nth(1).inputValue(), 'draft');
      assert.ok(
        await page.evaluate(() => Math.abs(document.querySelector('video').currentTime - 6) < 0.1),
        'language switching preserves playback position',
      );
      await page.getByLabel('Сдвиг субтитров, секунды').fill('1.5');
      await page.getByLabel('Сдвиг субтитров, секунды').press('Tab');
      await page.screenshot({ path: path.join(root, 'output/playwright/settings-ru-0.3.png') });
      await page.getByLabel('Язык интерфейса').selectOption('en');
      await page.getByLabel('Interface language').selectOption('auto');
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      assert.equal(
        await page.locator('[data-cue-row="1"] .timestamp').innerText(),
        '0:05',
        'language changes preserve adjusted timestamps',
      );
      await page.screenshot({ path: path.join(root, 'output/playwright/lesson-en-0.3.png') });
      await page.locator('input[type=file]').setInputFiles({
        name: 'replacement.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nReplacement'),
      });
      const sourceDialog = page.getByRole('dialog', { name: 'Change subtitle source?' });
      await sourceDialog.waitFor();
      assert.equal(/[А-Яа-яЁё]/u.test(await sourceDialog.innerText()), false);
      await sourceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.locator('input[type=file]').setInputFiles({
        name: 'broken.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('broken file'),
      });
      await page.locator('.notice.error').waitFor();
      assert.equal(
        /[А-Яа-яЁё]/.test(await page.locator('.notice').innerText()),
        false,
        'import errors are translated',
      );
      assert.equal(
        /[А-Яа-яЁё]/.test(await page.locator('.shell').innerText()),
        false,
        'English interface contains no untranslated Russian labels',
      );
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Interface language').selectOption('ru');
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      await activate();
      await inputs.first().waitFor();
      await page.getByRole('button', { name: 'Настройки', exact: true }).waitFor();
      assert.equal(
        await inputs.nth(1).inputValue(),
        'draft',
        'language preference and drafts survive reopening',
      );
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(
        'PASS: browser language, manual RU/EN switching, translated errors, unchanged answers/playback and persisted language',
      );
      return;
    }
    if (process.argv.includes('--storage')) {
      const duplicate = await context.newPage();
      await duplicate.goto('https://www.youtube.com/watch?v=fixture01');
      await duplicate.waitForFunction(() => document.querySelector('video').readyState >= 2);
      await activate();
      await duplicate.locator('input[data-cue]').first().waitFor();
      await duplicate.getByText('Сохранено на устройстве', { exact: true }).waitFor();
      await duplicate.locator('input[data-cue]').first().fill('keyboard');
      await duplicate.locator('input[data-cue]').first().press('Enter');
      await inputs.first().fill('old draft');
      await page.locator('.save-status.error').waitFor();
      assert.match(await page.locator('.save-status').innerText(), /другой вкладке/);
      const saved = await worker.evaluate(async () => {
        await storageQueue;
        return (await chrome.storage.local.get('lesson:fixture01'))['lesson:fixture01'];
      });
      assert.equal(saved.tasks[0].value, 'keyboard');
      assert.equal(saved.tasks[0].status, 'correct');
      await duplicate.close();
      assert.deepEqual(errors, []);
      console.log(
        'PASS: an older duplicate tab cannot overwrite saved answers and displays a recovery message',
      );
      return;
    }
    if (process.argv.includes('--upgrade')) {
      assert.equal(
        await page.getByRole('button', { name: 'Настройки', exact: true }).count(),
        1,
        'version 0.2 settings are available',
      );
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByLabel('Сложность').selectOption('hard');
      await page.getByLabel('Размер видео').selectOption('small');
      await page.getByLabel('Размер текста').fill('22');
      await page.getByLabel('Количество строк').selectOption('3');
      await page.getByLabel('Сдвиг субтитров, секунды').fill('1.5');
      await page.getByLabel('Сдвиг субтитров, секунды').press('Tab');
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      assert.equal(
        await page.locator('[data-cue-row="1"] .timestamp').innerText(),
        '0:05',
        'timestamps reflect the subtitle offset',
      );
      assert.match(await page.locator('.notice').innerText(), /сдвиг \+1.5 с/);
      await page.evaluate(() => window.fixtureClock(1));
      await page.waitForFunction(
        () =>
          !document.querySelector('#lingo-practice-root').shadowRoot.querySelector('.cue.active'),
      );
      await page.evaluate(() => window.fixtureClock(1.7));
      await page.waitForFunction(
        () =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelector('[data-cue-row="0"]')
            ?.getAttribute('aria-current') === 'true',
      );
      await inputs.first().fill('mistake');
      await inputs.first().press('Enter');
      await page.locator('[data-cue-row="0"] [data-action="hint"]').click();
      await page.getByText('Первая буква: k', { exact: true }).waitFor();
      await inputs.first().fill('keyboard');
      await inputs.first().press('Enter');
      await page.getByText('Верно с подсказкой', { exact: true }).waitFor();
      await page.locator('[data-cue-row="1"] .timestamp').click();
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector('video').currentTime >= 5.5 &&
            document.querySelector('video').currentTime < 6.5,
        ),
        'repeat includes offset',
      );
      await page.evaluate(() => document.querySelector('video').pause());
      const upload = page.locator('input[type=file]');
      await upload.setInputFiles({
        name: 'broken.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('broken file'),
      });
      await page.locator('.notice.error').waitFor();
      assert.equal(await inputs.count(), 5, 'invalid imports preserve the lesson');
      const approveSourceChange = async () => {
        const dialog = page.getByRole('dialog', { name: 'Сменить источник субтитров?' });
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Сменить субтитры', exact: true }).click();
      };
      const srt =
        '1\n00:00:01,000 --> 00:00:03,000\nAlpha\n\n2\n00:00:05,000 --> 00:00:07,000\nBravo\n\n3\n00:00:08,000 --> 00:00:10,000\nCharlie';
      await upload.setInputFiles({
        name: 'lesson.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from(srt),
      });
      await approveSourceChange();
      await page.waitForFunction(
        () =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelectorAll('input[data-cue]').length === 3,
      );
      await inputs.first().fill('Alfa');
      await inputs.first().press('Enter');
      await inputs.first().fill('Alpha');
      await inputs.first().press('Enter');
      const secondHint = page.locator('[data-cue-row="1"] [data-action="hint"]');
      await secondHint.click();
      await secondHint.click();
      assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 0.75);
      await page.evaluate(() => window.fixtureClock(9));
      await page.waitForFunction(() => document.querySelector('video').playbackRate === 1);
      await secondHint.click();
      await page.locator('[data-cue-row="1"]').getByText('Показано', { exact: true }).waitFor();
      await page.evaluate(() => {
        document.querySelector('video').pause();
        window.fixtureClock(8.4);
      });
      await inputs.nth(2).fill('Char');
      await page.close(); // The most recent answer must survive an immediate tab close.
      page = await context.newPage();
      await page.goto('https://www.youtube.com/watch?v=fixture01');
      await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
      await activate();
      inputs = page.locator('#lingo-practice-root input[data-cue]');
      await inputs.first().waitFor();
      assert.equal(await inputs.count(), 3, 'imported captions restored without reimport');
      assert.equal(await inputs.first().inputValue(), 'Alpha');
      assert.equal(await inputs.first().isDisabled(), true);
      assert.equal(await inputs.nth(1).inputValue(), 'Bravo');
      assert.equal(await inputs.nth(2).inputValue(), 'Char');
      await page.waitForFunction(
        () => Math.abs(document.querySelector('video').currentTime - 8.4) < 0.25,
      );
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      assert.equal(await page.getByLabel('Размер видео').inputValue(), 'small');
      assert.equal(await page.getByLabel('Размер текста').inputValue(), '22');
      assert.equal(await page.getByLabel('Количество строк').inputValue(), '3');
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      await page.getByRole('button', { name: 'Разбор ошибок', exact: true }).click();
      assert.equal(
        await page.locator('.review-entry').count(),
        2,
        'corrected mistakes remain in review',
      );
      await page.screenshot({ path: path.join(root, 'output/playwright/review-0.2.png') });
      await page.getByRole('button', { name: 'Повторить сложные места', exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelectorAll('input[data-cue]').length === 2,
      );
      assert.equal(await page.getByLabel('Источник субтитров', { exact: true }).isDisabled(), true);
      assert.equal(
        await page.getByRole('button', { name: 'Открыть SRT/VTT', exact: true }).isDisabled(),
        true,
      );
      assert.equal(await page.getByLabel('Сложность').isDisabled(), true);
      assert.equal(await page.getByLabel('Частота пропусков').isDisabled(), true);
      await page.setViewportSize({ width: 780, height: 800 });
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByLabel('Размер видео').selectOption('large');
      await page.getByLabel('Размер текста').fill('26');
      await page.getByLabel('Размер текста').press('Tab');
      await page.screenshot({ path: path.join(root, 'output/playwright/settings-0.2.png') });
      await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
      assert.equal(await inputs.first().isDisabled(), false);
      await inputs.first().fill('Alpha');
      await inputs.first().press('Enter');
      assert.equal(
        await inputs.nth(1).evaluate((e) => {
          const r = e.getBoundingClientRect(),
            list = e.getRootNode().querySelector('.cue-list').getBoundingClientRect();
          return r.top >= list.top && r.bottom <= list.bottom;
        }),
        true,
        'large text remains visible while reviewing on a small screen',
      );
      await page.screenshot({ path: path.join(root, 'output/playwright/replay-narrow-0.2.png') });
      await page.evaluate(() => window.fixtureClock(2.8));
      await page.waitForFunction(
        () =>
          document.querySelector('video').currentTime >= 5 &&
          document.querySelector('video').currentTime < 6.8,
        {},
        { timeout: 3000 },
      );
      await page.locator('[data-cue-row="1"] [data-action="skip"]').click();
      await page.evaluate(() => window.fixtureClock(6.8));
      await page
        .getByText('Повтор завершён. Основная оценка сохранена.', { exact: true })
        .waitFor({ timeout: 3000 });
      assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
      await page.getByRole('button', { name: 'К основной тренировке', exact: true }).click();
      assert.equal(await page.getByLabel('Источник субтитров', { exact: true }).isEnabled(), true);
      assert.equal(
        await page.getByRole('button', { name: 'Открыть SRT/VTT', exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByLabel('Сложность').isEnabled(), true);
      assert.equal(await page.getByLabel('Частота пропусков').isEnabled(), true);
      assert.equal(await inputs.count(), 3);
      assert.equal(await inputs.nth(2).inputValue(), 'Char');
      await page.locator('[data-cue-row="1"]').getByText('Показано', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'К текущей строке', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.screenshot({ path: path.join(root, 'output/playwright/lesson-0.2.png') });
      await page.locator('input[type=file]').setInputFiles({
        name: 'entities.vtt',
        mimeType: 'text/vtt',
        buffer: Buffer.from(
          'WEBVTT\n\n00:00.000 --> 00:02.000\n<img src=x onerror="window.importExecuted=true">caf&eacute;',
        ),
      });
      await approveSourceChange();
      await page.waitForFunction(
        () =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelectorAll('input[data-cue]').length === 1,
      );
      await page.locator('[data-cue-row="0"] [data-action="skip"]').click();
      assert.equal(
        await inputs.first().inputValue(),
        'café',
        'browser imports decode HTML entities',
      );
      assert.equal(
        await page.evaluate(() => window.importExecuted),
        undefined,
        'subtitle markup is inert',
      );
      assert.equal(await page.locator('#lingo-practice-root img').count(), 0);
      assert.equal(
        await page
          .getByLabel('Источник субтитров', { exact: true })
          .locator('option:checked')
          .innerText(),
        'entities.vtt',
        'a second import updates the selected filename',
      );
      await page.locator('input[type=file]').setInputFiles({
        name: 'ending.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:21,000 --> 00:00:30,000\nOmega'),
      });
      await approveSourceChange();
      await page.waitForFunction(
        () =>
          document.querySelector('#lingo-practice-root').shadowRoot.querySelector('.notice')
            .textContent === 'ending.srt',
      );
      await page.locator('[data-cue-row="0"] [data-action="skip"]').click();
      await page.getByRole('button', { name: 'Разбор ошибок', exact: true }).click();
      await page.getByRole('button', { name: 'Повторить сложные места', exact: true }).click();
      await page.evaluate(() => {
        const v = document.querySelector('video');
        v.currentTime = v.duration - 0.2;
      });
      await page.waitForFunction(
        () => document.querySelector('video').ended,
        {},
        { timeout: 3000 },
      );
      await inputs.first().fill('Omega');
      await inputs.first().press('Enter');
      await page
        .getByText('Повтор завершён. Основная оценка сохранена.', { exact: true })
        .waitFor({ timeout: 1500 });
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      assert.deepEqual(errors, []);
      console.log(
        'PASS: import, offset, difficulty, hints, speed restoration, tab-close persistence, settings and difficult-fragment review',
      );
      return;
    }
    assert.equal(
      await page.evaluate(() => {
        const p = document.querySelector('#movie_player'),
          r = p.getBoundingClientRect();
        return !!document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest('#movie_player');
      }),
      true,
      'native video must be above the lesson background',
    );
    assert.ok(
      await page
        .locator('#movie_player video')
        .evaluate((e) => e.getBoundingClientRect().height > 200),
      'actual video frame must retain a visible height',
    );
    assert.equal(await inputs.count(), 5);
    assert.equal(await page.locator('.caption-window-container').isVisible(), false);
    await inputs.first().fill('wrong');
    await inputs.first().press('Enter');
    await page.getByText('Попробуй ещё раз', { exact: true }).waitFor();
    await inputs.first().fill('');
    await inputs.first().pressSequentially('keyboard');
    assert.equal(
      await page.evaluate(() => window.fixtureKeys),
      0,
      'YouTube must not receive typing',
    );
    await inputs.first().press('Enter');
    await page.getByText('Верно', { exact: true }).waitFor();
    assert.equal(await inputs.first().inputValue(), 'keyboard');
    assert.equal(await inputs.first().isDisabled(), true);
    await inputs.nth(1).fill('unfinished');
    await page.evaluate(() => window.fixtureClock(9));
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('#lingo-practice-root')
            .shadowRoot.querySelector('[data-cue-row="2"]')
            .getAttribute('aria-current') === 'true',
        {},
        { timeout: 4000 },
      )
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => {
            const v = document.querySelector('video');
            return {
              time: v.currentTime,
              duration: v.duration,
              seeking: v.seeking,
              ready: v.readyState,
              seekable: [...Array(v.seekable.length)].map((_, i) => [
                v.seekable.start(i),
                v.seekable.end(i),
              ]),
              rows: [
                ...document
                  .querySelector('#lingo-practice-root')
                  .shadowRoot.querySelectorAll('.cue'),
              ].map((e) => e.className),
            };
          }),
        );
        throw error;
      });
    assert.equal(
      await page.locator('[data-cue-row="2"]').getAttribute('aria-current'),
      'true',
      'the visible active row must follow video time',
    );
    assert.equal(await inputs.nth(1).inputValue(), 'unfinished');
    assert.equal(
      await inputs.nth(1).evaluate((e) => e.getRootNode().activeElement === e),
      true,
      'clock must not steal focus',
    );
    await page.locator('[data-cue-row="1"] [data-action="skip"]').click();
    await page.getByText('Пропущено', { exact: true }).waitFor();
    await page.getByLabel('Пауза в конце строки').check();
    await page.evaluate(() => window.fixtureClock(11.7));
    await page.waitForFunction(() => !document.querySelector('video').seeking);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video').paused, {}, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('video').currentTime >= 12 &&
          document.querySelector('video').currentTime < 12.7,
      ),
    );
    await page.evaluate(() => {
      const old = document.querySelector('video');
      old.replaceWith(old.cloneNode(true));
    });
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.evaluate(() => window.fixtureClock(17));
    await page.waitForFunction(
      () =>
        document
          .querySelector('#lingo-practice-root')
          ?.shadowRoot.querySelector('[data-cue-row="4"]')
          ?.getAttribute('aria-current') === 'true',
      {},
      { timeout: 2000 },
    );
    assert.equal(
      await inputs.first().inputValue(),
      'keyboard',
      'answers survive a same-video player refresh',
    );
    await page.screenshot({ path: path.join(root, 'output/playwright/lesson.png') });
    await page.setViewportSize({ width: 780, height: 800 });
    assert.equal(
      await page
        .locator('#lingo-practice-root')
        .evaluate((e) => e.getBoundingClientRect().width <= innerWidth),
      true,
    );
    await page.screenshot({ path: path.join(root, 'output/playwright/lesson-narrow.png') });
    await page.locator('[data-cue-row="2"] [data-action="skip"]').click();
    assert.equal(
      await inputs.nth(3).evaluate((e) => {
        const rect = e.getBoundingClientRect(),
          list = e.getRootNode().querySelector('.cue-list').getBoundingClientRect();
        return rect.top >= list.top && rect.bottom <= list.bottom;
      }),
      true,
      'the next focused answer must scroll into view',
    );
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    assert.equal(await page.locator('#lingo-practice-root').count(), 0);
    assert.equal(await page.locator('#original-header').isVisible(), true);
    assert.equal(await page.locator('.caption-window-container').isVisible(), true);
    await page.locator('body').press('k');
    assert.equal(await page.evaluate(() => window.fixtureKeys), 1, 'keyboard must work after exit');
    await activate();
    await inputs.first().waitFor();
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=fixture02');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForFunction(() => !document.querySelector('#lingo-practice-root'));
    emptyCaptions = true;
    await activate();
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
    assert.equal(await inputs.count(), 0, 'failure must never show invented captions');
    await page.evaluate(() => {
      const section = document.createElement('ytd-video-description-transcript-section-renderer');
      const button = document.createElement('button');
      button.textContent = 'Показать текст видео';
      section.append(button);
      document.body.append(section);
      button.onclick = () => {
        const panel = document.createElement('ytd-engagement-panel-section-list-renderer');
        panel.innerHTML = '<transcript-segment-view-model></transcript-segment-view-model>';
        panel.data = {
          content: {
            items: [
              { transcriptSegmentViewModel: { timestamp: '0:01', simpleText: 'Hello there' } },
              { transcriptSegmentViewModel: { timestamp: '0:04', simpleText: 'General Kenobi' } },
            ],
          },
        };
        document.body.append(panel);
      };
    });
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await inputs.first().waitFor();
    assert.equal(
      await inputs.count(),
      2,
      'modern native transcript is the fallback for empty timedtext',
    );
    assert.match(await page.locator('.notice').innerText(), /округлено/);
    await page.getByLabel('Источник субтитров', { exact: true }).selectOption('0');
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
    assert.equal(
      await inputs.count(),
      2,
      'a failed explicit language change preserves the current lesson',
    );
    assert.equal(
      await page.getByLabel('Источник субтитров', { exact: true }).inputValue(),
      'auto',
      'failed track selection rolls back to the existing source',
    );
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: extension loading, gaps, answers, keyboard isolation, focus, seek, auto-pause, responsive layout, restore, navigation and caption errors',
    );
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
