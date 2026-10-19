#!/usr/bin/env node
/**
 * Captures the README screenshots from a production build.
 * Usage: npm run build && npx vite preview --port 4174 & node scripts/screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const url = process.env.DECANT_URL ?? 'http://localhost:4174/decant/';
const root = join(import.meta.dirname, '..');
const fixture = (name) => join(root, 'tests', 'fixtures', name);
const out = join(root, 'docs');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });

async function shot(name, { width, height, colorScheme = 'light', files, target, crop }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  if (files) {
    await page.locator('input[type=file]').setInputFiles(files.map(fixture));
    await page.getByRole('button', { name: target, exact: true }).first().click();
    await page.getByRole('button', { name: /^Convert .*to / }).click();
    await page.getByRole('button', { name: /^Save/ }).first().waitFor();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: join(out, name), clip: crop ?? { x: 0, y: 0, width, height } });
  await context.close();
}

await shot('home.png', { width: 1440, height: 820 });
await shot('convert-dark.png', {
  width: 1440,
  height: 1040,
  colorScheme: 'dark',
  files: ['sample.heic', 'sample.png', 'sample.avif'],
  target: 'WEBP',
});
await shot('mobile.png', { width: 390, height: 844, files: ['sample.mov'], target: 'MP4' });

await browser.close();
console.log('Screenshots written to docs/');
