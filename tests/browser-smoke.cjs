// Run with NODE_PATH pointing at a directory containing Playwright, or install it outside the extension.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(process.env.LINGO_EXTENSION_ROOT || path.join(__dirname, '..'));

(async () => {
  assert.ok(fs.existsSync(path.join(root, 'manifest.json')), 'installable extension exists');
  const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-extension-'));
  for (const name of [
    'manifest.json',
    'background.js',
    'youtube.js',
    'exercise.js',
    'content.js',
    'styles.css',
  ])
    fs.copyFileSync(path.join(root, name), path.join(installed, name));
  for (const name of [
    'i18n.js',
    '_locales/en/messages.json',
    '_locales/ru/messages.json',
    ...['16', '32', '48', '128'].map((size) => `icons/icon${size}.png`),
  ])
    if (fs.existsSync(path.join(root, name))) {
      fs.mkdirSync(path.dirname(path.join(installed, name)), { recursive: true });
      fs.copyFileSync(path.join(root, name), path.join(installed, name));
    }
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
      worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
        await toggleTab(tabs.at(-1));
      });
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
        { tStartMs: 16000, dDurationMs: 4000, segs: [{ utf8: 'Listen closely and try again.' }] },
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
    await activate();
    await page.locator('#lingo-practice-root').waitFor();
    let inputs = page.locator('#lingo-practice-root input[data-cue]');
    await inputs.first().waitFor();
    if (process.argv.includes('--i18n')) {
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 1500 });
      assert.equal(await page.locator('#lingo-practice-root').getAttribute('lang'), 'en');
      await inputs.first().fill('keyboard');
      await inputs.first().press('Enter');
      await page.getByText('Correct', { exact: true }).waitFor();
      await inputs.nth(1).fill('draft');
      await page.evaluate(() => window.fixtureClock(6));
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
      const srt =
        '1\n00:00:01,000 --> 00:00:03,000\nAlpha\n\n2\n00:00:05,000 --> 00:00:07,000\nBravo\n\n3\n00:00:08,000 --> 00:00:10,000\nCharlie';
      await upload.setInputFiles({
        name: 'lesson.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from(srt),
      });
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
        await page.getByLabel('Источник субтитров').locator('option:checked').innerText(),
        'entities.vtt',
        'a second import updates the selected filename',
      );
      await page.locator('input[type=file]').setInputFiles({
        name: 'ending.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:21,000 --> 00:00:30,000\nOmega'),
      });
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
    await page.getByLabel('Источник субтитров').selectOption('0');
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).waitFor();
    assert.equal(
      await inputs.count(),
      2,
      'a failed explicit language change preserves the current lesson',
    );
    assert.equal(
      await page.getByLabel('Источник субтитров').inputValue(),
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
