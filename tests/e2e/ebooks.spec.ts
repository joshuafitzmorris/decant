import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { FormatId } from '../../src/core/formats';
import { convert, expectFormat, saveResult, text } from './helpers';

/** Real ebook conversions in the browser, checked by reading the results back. */
const CONVERSIONS: [source: string, target: FormatId][] = [
  ['sample.epub', 'mobi'],
  ['sample.epub', 'fb2'],
  ['sample.mobi', 'epub'],
  ['sample.azw3', 'epub'],
  ['sample.azw3', 'mobi'],
  ['sample.fb2', 'epub'],
  ['sample.docx', 'epub'],
  ['sample.pdf', 'epub'],
  ['sample.cbz', 'pdf'],
];

for (const [source, target] of CONVERSIONS) {
  test(`${source} → ${target}`, async ({ page }) => {
    await convert(page, [source], target);
    const file = await saveResult(page);
    expect(file.name).toBe(source.replace(/\.[^.]+$/, `.${target}`));
    await expectFormat(file, target);
  });
}

const epubText = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return Object.entries(files)
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([, data]) => text(data))
    .join('\n');
};

test('a Kindle book keeps its text, cover and metadata in EPUB', async ({ page }) => {
  await convert(page, ['sample.azw3'], 'epub');
  const { bytes } = await saveResult(page);
  const files = unzipSync(bytes);
  expect(Object.keys(files)[0]).toBe('mimetype');
  const opf = text(files['OEBPS/content.opf'] as Uint8Array);
  expect(opf).toContain('<dc:title>The Raven</dc:title>');
  expect(opf).toContain('<dc:creator>Edgar Allan Poe</dc:creator>');
  expect(opf).toContain('properties="cover-image"');
  expect(epubText(bytes)).toContain('Once upon a midnight dreary');
});

test('EPUB to PDF typesets the book with its chapters as bookmarks', async ({ page }) => {
  await convert(page, ['sample.epub'], 'pdf');
  const { bytes } = await saveResult(page);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toBe('The Decant Sample Book');
  expect(pdf.getAuthor()).toBe('Ada Lovelace');
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
  const [width, height] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
  expect([Math.round(width), Math.round(height)]).toEqual([420, 595]);
  expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeDefined();
});

test('EPUB to plain text, Markdown and a web page', async ({ page }) => {
  for (const [target, expected] of [
    ['txt', 'It was a dark and stormy night'],
    ['md', '*dark and stormy*'],
    ['html', '<em>dark and stormy</em>'],
  ] as const) {
    await convert(page, ['sample.epub'], target);
    const file = await saveResult(page);
    expect(text(file.bytes)).toContain(expected);
  }
});

test('a PDF becomes a comic archive with one picture per page', async ({ page }) => {
  await convert(page, ['sample.pdf'], 'cbz');
  const file = await saveResult(page);
  expect(file.name).toBe('sample.cbz');
  expect(Object.keys(unzipSync(file.bytes))).toEqual(['page-001.jpg', 'page-002.jpg']);
});

test('DRM-protected Kindle books get a clear explanation', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { fixture } = await import('./helpers');
  const data = new Uint8Array(readFileSync(fixture('sample.mobi')));
  const view = new DataView(data.buffer);
  view.setUint16(view.getUint32(78) + 12, 2);
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles({
    name: 'locked.azw',
    mimeType: 'application/vnd.amazon.ebook',
    buffer: Buffer.from(data),
  });
  await page.getByRole('button', { name: /^Convert to/ }).click();
  await expect(page.getByRole('alert')).toContainText('protected with DRM');
});
