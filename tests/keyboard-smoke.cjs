// NODE_PATH and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH work as in browser-smoke.cjs.
// --extension=PATH also permits checking an earlier extension snapshot without changing source files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const copy = (from, to) => {
  if (!fs.statSync(from).isDirectory()) return fs.copyFileSync(from, to);
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
};

(async () => {
  const original = process.argv.find((arg) => arg.startsWith('--extension='))?.slice(12) || root;
  const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-keyboard-'));
  for (const name of fs
    .readdirSync(original)
    .filter(
      (name) =>
        /\.(js|css|html)$/.test(name) || ['manifest.json', '_locales', 'icons'].includes(name),
    )) {
    copy(path.join(original, name), path.join(installed, name));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://www.youtube.com/*'];
  fs.writeFileSync(path.join(installed, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(
    fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-keyboard-profile-')),
    {
      channel: 'chromium',
      headless: true,
      locale: 'ru-RU',
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [`--disable-extensions-except=${installed}`, `--load-extension=${installed}`],
      viewport: { width: 1440, height: 1050 },
    },
  );
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const page = await context.newPage(),
      failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    const media = fs.readFileSync(path.join(__dirname, 'fixture.webm'));
    await page.route('https://www.youtube.com/keyboard.webm', (route) => {
      const range = route
        .request()
        .headers()
        .range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0,
        end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: 'video/webm',
        body: media.subarray(start, end + 1),
        headers: {
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
        },
      });
    });
    await page.route('https://www.youtube.com/watch?*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body tabindex="0">
      <ytd-app><div id="movie_player" tabindex="0"><video src="/keyboard.webm" preload="auto" controls></video></div></ytd-app>
      <script>
        // Live YouTube on jNQXAC9IVRw registers a document keydown capture listener.
        // This listener is registered before the extension, and deliberately treats shadow-host targets as non-editable.
        document.addEventListener('keydown', event => {
          const video = document.querySelector('video');
          if (/^[0-9]$/.test(event.key)) video.currentTime = video.duration * Number(event.key) / 10;
          if (event.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
          if (event.key === 'Home') video.currentTime = 0;
        }, true);
      </script></body></html>`,
      }),
    );
    await page.goto('https://www.youtube.com/watch?v=keyboard01');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        preferences: { onboardingSeen: true },
        'lesson:keyboard01': {
          schema: 2,
          videoId: 'keyboard01',
          title: 'Keyboard regression',
          position: 3,
          sourceLabel: 'Fixture',
          sourceSelection: 'file',
          difficulty: 'balanced',
          tasks: ['keyboard', 'friend', 'ready'].map((text, id) =>
            LingoExercise.create({ id, start: id * 4, end: id * 4 + 4, text }),
          ),
        },
      });
      const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      await toggleTab(tabs.at(-1));
    });
    const answers = page.locator('input[data-cue]');
    await answers.first().waitFor();
    const cdp = await context.newCDPSession(page);
    // Playwright's plain Numpad5 means NumLock-off Clear; explicitly send the NumLock-on trusted key event.
    const numpad = async (key, code, keyCode, text = '') => {
      const event = {
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        isKeypad: true,
        location: 3,
      };
      await cdp.send('Input.dispatchKeyEvent', {
        ...event,
        type: 'keyDown',
        text,
        unmodifiedText: text,
      });
      await cdp.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
    };
    const reset = async () => {
      await page.evaluate(() => {
        const video = document.querySelector('video');
        video.pause();
        video.currentTime = 3;
      });
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return !video.seeking && Math.abs(video.currentTime - 3) < 0.05;
      });
    };
    const check = async (name, run) => {
      try {
        await run();
        console.log('PASS:', name);
      } catch (error) {
        failures.push(name + ': ' + error.message);
        console.log('FAIL:', name, error.message);
      }
    };
    await check('NumPad digits cannot seek while the player has focus', async () => {
      for (const digit of [0, 5, 9]) {
        await reset();
        await page.locator('#movie_player').focus();
        await numpad(String(digit), 'Numpad' + digit, 96 + digit, String(digit));
        assert.equal(
          await page.locator('video').evaluate((video) => video.currentTime),
          3,
          'NumPad' + digit + ' changed playback time',
        );
      }
    });
    await check('NumLock-off navigation cannot seek outside the lesson', async () => {
      for (const [key, code, keyCode] of [
        ['ArrowLeft', 'Numpad4', 37],
        ['Home', 'Numpad7', 36],
      ]) {
        await reset();
        await page.locator('body').focus();
        await numpad(key, code, keyCode);
        assert.equal(
          await page.locator('video').evaluate((video) => video.currentTime),
          3,
          code + ' changed playback time',
        );
      }
    });
    await check(
      'NumPad typing and NumLock-off caret editing remain native in an answer',
      async () => {
        await reset();
        await answers.first().fill('abcd');
        await answers.first().evaluate((input) => input.setSelectionRange(2, 2));
        await numpad('5', 'Numpad5', 101, '5');
        assert.equal(await answers.first().inputValue(), 'ab5cd');
        await numpad('ArrowLeft', 'Numpad4', 37);
        assert.equal(await answers.first().evaluate((input) => input.selectionStart), 2);
        await numpad('Delete', 'NumpadDecimal', 46);
        assert.equal(await answers.first().inputValue(), 'abcd');
        assert.equal(await page.locator('video').evaluate((video) => video.currentTime), 3);
      },
    );
    await check('Enter and NumpadEnter submit answers without seeking', async () => {
      await reset();
      await answers.first().fill('keyboard');
      await answers.first().press('Enter');
      assert.equal(await answers.first().isDisabled(), true);
      await answers.nth(1).fill('friend');
      await numpad('Enter', 'NumpadEnter', 13, '\r');
      assert.equal(await answers.nth(1).isDisabled(), true);
      assert.equal(await page.locator('video').evaluate((video) => video.currentTime), 3);
    });
    await check('Escape closes lesson dialogs and returns focus to each opener', async () => {
      const helpButton = page.getByRole('button', { name: 'Как заниматься', exact: true });
      await helpButton.click();
      const helpDialog = page.getByRole('dialog', { name: 'Как заниматься' });
      await helpDialog.waitFor();
      await helpDialog.press('Escape');
      await helpDialog.waitFor({ state: 'hidden' });
      assert.equal(
        await helpButton.evaluate((node) => node.getRootNode().activeElement === node),
        true,
      );

      const settingsButton = page.getByRole('button', { name: 'Настройки', exact: true });
      await settingsButton.click();
      const settingsDialog = page.getByRole('dialog', { name: 'Подстрой под себя' });
      await settingsDialog.press('Escape');
      await settingsDialog.waitFor({ state: 'hidden' });
      assert.equal(
        await settingsButton.evaluate((node) => node.getRootNode().activeElement === node),
        true,
      );

      const summaryButton = page.getByRole('button', { name: 'Разбор ошибок', exact: true });
      await summaryButton.click();
      const summaryDialog = page.getByRole('dialog', { name: 'Разбор ошибок' });
      await summaryDialog.press('Escape');
      await summaryDialog.waitFor({ state: 'hidden' });
      assert.equal(
        await summaryButton.evaluate((node) => node.getRootNode().activeElement === node),
        true,
      );

      const importButton = page.getByRole('button', { name: 'Открыть SRT/VTT', exact: true });
      await page.locator('input[type=file]').setInputFiles({
        name: 'keyboard-replacement.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nReplacement'),
      });
      const sourceDialog = page.getByRole('dialog', { name: 'Сменить источник субтитров?' });
      await sourceDialog.waitFor();
      await sourceDialog.press('Escape');
      await sourceDialog.waitFor({ state: 'hidden' });
      assert.equal(
        await importButton.evaluate((node) => node.getRootNode().activeElement === node),
        true,
      );
    });
    await check('exiting restores the player keyboard shortcut', async () => {
      await page.locator('.header .controls button').last().click();
      await reset();
      await page.locator('#movie_player').focus();
      await numpad('5', 'Numpad5', 101, '5');
      const video = await page
        .locator('video')
        .evaluate((video) => ({ time: video.currentTime, duration: video.duration }));
      assert.ok(Math.abs(video.time - video.duration / 2) < 0.1);
    });
    assert.deepEqual(failures, [], 'keyboard regression checks failed');
    console.log('PASS: keyboard and NumPad regression checks');
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
