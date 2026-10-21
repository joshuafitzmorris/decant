#!/usr/bin/env node
/**
 * Measures the advance widths that src/app/vessel.ts uses to size the pour line, by
 * setting each character in the .vessel style in Chrome. Run it after changing that
 * style's font, weight, width or tracking, and paste the table into vessel.ts.
 * Usage: npm run build && npx vite preview --port 4174 & node scripts/vessel-metrics.mjs
 */
import { chromium } from '@playwright/test';

const url = process.env.DECANT_URL ?? 'http://localhost:4174/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
const table = await page.evaluate(() => {
  const widths = {};
  for (const char of '.abcdefghijklmnopqrstuvwxyz0123456789') {
    const el = document.createElement('span');
    el.className = 'vessel';
    el.style.cssText = 'position:absolute;visibility:hidden;font-size:1000px';
    el.textContent = char;
    document.body.append(el);
    widths[char] = Number((el.getBoundingClientRect().width / 1000).toFixed(4));
    el.remove();
  }
  return widths;
});
await browser.close();
for (const [char, width] of Object.entries(table))
  console.log(`  ${/[a-z]/.test(char) ? char : `'${char}'`}: ${width},`);
