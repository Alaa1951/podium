/** Capture the live public results at Apple display sizes, without stretching. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const require = createRequire(process.env.PODIUM_CAPTURE_MODULES
  ? join(resolve(process.env.PODIUM_CAPTURE_MODULES), '__capture__.cjs') : import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const output = resolve(process.argv[2] || 'build/store-screenshots');
const series = process.env.PODIUM_SCREENSHOT_SERIES || 'podium-series-1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PODIUM_CAPTURE_BROWSER || 'chrome', headless: true });
const manifest = [];
try {
  for (const device of [
    { name: 'iphone', width: 414, height: 896, scale: 3, mobile: true, display: 'APP_IPHONE_65' },
    { name: 'ipad', width: 1024, height: 1366, scale: 2, mobile: false, display: 'APP_IPAD_PRO_3GEN_129' },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.scale,
      isMobile: device.mobile, hasTouch: true, locale: 'en-GB', serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      for (const [index, category, division] of [[1, 'Womens', 'Rookie'], [2, 'Mens', 'Pro']]) {
        const url = `https://podium.bftmiddleeast.com/results/${encodeURIComponent(series)}/${category}/${division}`;
        const response = await page.goto(url, { waitUntil: 'networkidle' });
        if (response?.status() !== 200) throw new Error(`Results returned ${response?.status()}`);
        await page.evaluate(() => document.fonts.ready);
        const text = await page.locator('body').innerText();
        if (!text.toLowerCase().includes(category.toLowerCase()) || !text.toLowerCase().includes(division.toLowerCase()) || /That screen does not exist/.test(text)) {
          throw new Error(`Unexpected leaderboard at ${url}: ${text.slice(0,700)}`);
        }
        const fileName = `${device.name}-${index}-${category.toLowerCase()}-${division.toLowerCase()}.png`;
        const file = join(output, fileName);
        // Browser renders at the final pixel size. Sharp strips alpha and encodes sRGB PNG;
        // it never rescales or changes the aspect ratio of the captured page.
        await sharp(await page.screenshot({ fullPage: false })).removeAlpha().png().toFile(file);
        const { width, height } = await sharp(file).metadata();
        if (width !== device.width * device.scale || height !== device.height * device.scale) {
          throw new Error(`Unexpected image dimensions: ${fileName}`);
        }
        manifest.push({ fileName, url, width, height, display: device.display, order: index });
        console.log(fileName, `${width}x${height}`, url);
      }
    } finally { await context.close(); }
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
} finally { await browser.close(); }
