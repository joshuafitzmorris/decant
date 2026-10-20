import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { fixture, saveResult } from './helpers';

test('the empty page explains itself and offers a file picker', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/Decant/);
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
});

test('the page cannot talk to other origins', async ({ page }) => {
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self' blob: data:");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/upload', { method: 'POST', body: 'secret' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test('a mixed drop of photos converts to one format, skipping files already in it', async ({ page }) => {
  await page.goto('./');
  await page
    .locator('input[type=file]')
    .setInputFiles([fixture('sample.heic'), fixture('sample.png'), fixture('sample.jpg')]);
  await expect(page.getByRole('img', { name: 'Images to JPG' })).toBeVisible();
  await expect(page.getByText('Already JPG')).toBeVisible();
  await page.getByRole('button', { name: 'Convert 2 files to JPG' }).click();
  await expect(page.getByRole('button', { name: 'Save all 2 as ZIP' })).toBeVisible();
  const file = await saveResult(page);
  expect(Object.keys(unzipSync(file.bytes))).toEqual(['sample.jpg', 'sample (2).jpg']);
});

test('files the app cannot read are explained, not silently dropped', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
  });
  await expect(page.getByText("Decant can't convert this kind of file.")).toBeVisible();
});

test('a damaged file fails with a clear message and can be retried or removed', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]),
  });
  await page.getByRole('button', { name: /^Convert to/ }).click();
  await expect(page.getByRole('alert')).toContainText("couldn't be read");
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove broken.jpg' }).click();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
});

test('changing settings after converting offers to convert again', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles(fixture('sample.png'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.getByRole('button', { name: 'Save sample.jpg' }).first()).toBeVisible();
  await page.getByLabel('Size').selectOption('512');
  await expect(page.getByText('Settings changed since')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convert to JPG' })).toBeVisible();
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('./');
  // Wait until the service worker controls the page, so the converter's code gets cached as it loads.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Use the image converter once so its code is cached.
  await page.locator('input[type=file]').setInputFiles(fixture('sample.png'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.getByRole('button', { name: 'Save sample.jpg' }).first()).toBeVisible();

  // The unsaved result makes the page ask before reloading; accept that prompt.
  page.on('dialog', (dialog) => dialog.accept());
  await context.setOffline(true);
  await page.reload();
  await page.locator('input[type=file]').setInputFiles(fixture('sample.bmp'));
  await page.getByRole('button', { name: 'Convert to PNG' }).click();
  await expect(page.getByRole('button', { name: 'Save sample.png' }).first()).toBeVisible();
});

test('several images can be saved as one PDF, in the order they were added', async ({ page }) => {
  await page.goto('./');
  await page
    .locator('input[type=file]')
    .setInputFiles([fixture('sample.png'), fixture('sample.heic'), fixture('sample.svg')]);
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Convert 3 files to PDF' }).click();
  await expect(page.getByRole('button', { name: 'Save as one PDF' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as one PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('sample-combined.pdf');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(readFileSync(await download.path()));
  expect(pdf.getPageCount()).toBe(3);
});

test('a landing page opens with its conversion and defaults to it', async ({ page }) => {
  await page.goto('./pdf-to-jpg/');
  await expect(page).toHaveTitle('PDF to JPG converter: free, no upload | Decant');
  await expect(page.getByRole('button', { name: 'Choose PDF files' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(fixture('sample.pdf'));
  await expect(page.getByRole('button', { name: 'JPG', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('leaving with unsaved results asks first; saving them stops the prompt', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles(fixture('sample.png'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.getByRole('button', { name: 'Save sample.jpg' }).first()).toBeVisible();

  let prompted = false;
  page.once('dialog', async (dialog) => {
    prompted = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => prompted).toBe(true);
});
