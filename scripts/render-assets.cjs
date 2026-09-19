// Dev-only: use the same NODE_PATH and Chromium override as tests/browser-smoke.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 440, height: 280 },
      deviceScaleFactor: 1,
    });
    const render = async (source, destination, width, height) => {
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${source}`,
      );
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({
        path: path.join(root, destination),
        clip: { x: 0, y: 0, width, height },
        omitBackground: true,
      });
      assert.equal(png.readUInt32BE(16), width);
      assert.equal(png.readUInt32BE(20), height);
      console.log(`${destination}: ${width}×${height}`);
    };
    const icon = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
    // Small toolbar icons use the tile's full area; the 128px store icon keeps its 16px transparent margin.
    for (const size of [16, 32, 48, 128]) {
      await render(
        size === 128 ? icon : icon.replace('viewBox="0 0 128 128"', 'viewBox="16 16 96 96"'),
        `icons/icon${size}.png`,
        size,
        size,
      );
    }
    await render(
      fs.readFileSync(path.join(root, 'store-assets/promo.svg'), 'utf8'),
      'store-assets/promo440x280.png',
      440,
      280,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
