#!/usr/bin/env node
/**
 * Renders the PWA icons and the social preview image with headless Chrome.
 * Run after changing the mark or the palette: `node scripts/make-images.mjs`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const out = join(root, 'public');
mkdirSync(join(out, 'icons'), { recursive: true });

const font = readFileSync(
  join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'),
).toString('base64');
const fontFace = `@font-face { font-family: Archivo; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }`;

const VESSEL = 'M11 3h10v8.2c4.2 1.9 7 6 7 10.8C28 28.6 22.6 31 16 31S4 28.6 4 22c0-4.8 2.8-8.9 7-10.8z';
const LIQUID = 'M0 19.5c4-1.6 8-1.6 12 0s8 1.6 12 0 6-1.2 8-.6V32H0z';

/** The mark on a dark tile. `inset` leaves room for maskable icon safe zones. */
const iconHtml = (inset) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: 100%; height: 100%; }
  body { background: #0f1a17; display: grid; place-items: center; }
  svg { width: ${100 - inset * 2}%; height: ${100 - inset * 2}%; }
</style></head><body>
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="v"><path d="${VESSEL}"/></clipPath></defs>
  <g clip-path="url(#v)"><rect width="32" height="32" fill="#f2f4f3" opacity=".16"/><path d="${LIQUID}" fill="#f2f4f3"/></g>
  <path d="${VESSEL}" fill="none" stroke="#f2f4f3" stroke-width="1.6" stroke-linejoin="round"/>
</svg></body></html>`;

const ogHtml = `<!doctype html><html><head><style>
  ${fontFace}
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; box-sizing: border-box; padding: 72px 84px; background: #f2f4f3; color: #0f1a17;
    font-family: Archivo, sans-serif; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 800; font-stretch: 125%; }
  .pour { display: flex; align-items: center; gap: 0.12em; font-size: 212px; font-weight: 780; font-stretch: 78%; letter-spacing: -0.035em; line-height: 0.86; }
  .to { color: transparent; background: linear-gradient(to top, oklch(0.62 0.19 12) 58%, rgb(15 26 23 / 0.13) 58%); -webkit-background-clip: text; background-clip: text; padding-block: 0.12em; margin-block: -0.12em; }
  .arrow { width: 0.7em; height: 0.42em; }
  p { margin: 0; font-size: 34px; color: #47544f; }
</style></head><body>
  <div class="brand">
    <svg width="40" height="40" viewBox="0 0 32 32"><defs><clipPath id="m"><path d="${VESSEL}"/></clipPath></defs>
      <g clip-path="url(#m)"><rect width="32" height="32" fill="#0f1a17" opacity=".14"/><path d="${LIQUID}" fill="#0f1a17"/></g>
      <path d="${VESSEL}" fill="none" stroke="#0f1a17" stroke-width="2" stroke-linejoin="round"/></svg>
    Decant
  </div>
  <div class="pour"><span>.heic</span>
    <svg class="arrow" viewBox="0 0 100 60" fill="none" stroke="#87938e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 30 H90"/><path d="M68 10 L92 30 L68 50"/></svg>
    <span class="to">.jpg</span></div>
  <p>Convert files in your browser. Nothing is uploaded.</p>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [name, size, inset] of [
  ['icon-192.png', 192, 14],
  ['icon-512.png', 512, 14],
  ['maskable-512.png', 512, 22],
  ['apple-touch-icon.png', 180, 14],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(iconHtml(inset));
  await page.screenshot({ path: join(out, 'icons', name) });
}

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHtml);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(out, 'og.png') });

await browser.close();
console.log('Icons and social image written to public/');
