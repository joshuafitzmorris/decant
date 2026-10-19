import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { FormatId } from '../../src/core/formats';
import { convert, expectFormat, fixture, saveResult, text } from './helpers';

/**
 * One real conversion per route family, driven through the UI in Chrome.
 * Each output is checked with the app's own format sniffer.
 */
const BINARY: [source: string, target: FormatId][] = [
  // Images, including the WebAssembly decoders and encoders
  ['sample.heic', 'jpg'],
  ['sample.png', 'webp'],
  ['sample.png', 'avif'],
  ['sample.jpg', 'jxl'],
  ['sample.png', 'gif'],
  ['sample.png', 'tiff'],
  ['sample.png', 'bmp'],
  ['sample.png', 'ico'],
  ['sample.svg', 'png'],
  ['sample.tiff', 'png'],
  ['sample.avif', 'jpg'],
  ['sample.jxl', 'png'],
  ['sample.webp', 'png'],
  ['sample.ico', 'png'],
  ['sample.heic', 'pdf'],
  // Audio
  ['sample.wav', 'mp3'],
  ['sample.wav', 'flac'],
  ['sample.wav', 'm4a'],
  ['sample.mp3', 'wav'],
  ['sample.flac', 'opus'],
  ['sample.m4a', 'aac'],
  ['sample.ogg', 'mp3'],
  // Video, including stream copies, re-encodes and GIF in both directions
  ['sample.mp4', 'webm'],
  ['sample.mp4', 'mov'],
  ['sample.mp4', 'mkv'],
  ['sample.webm', 'mp4'],
  ['sample.mkv', 'mp4'],
  ['sample.m2ts', 'mp4'],
  ['sample.mp4', 'mp3'],
  ['sample.mp4', 'gif'],
  ['sample.gif', 'mp4'],
  // Formats that need the ffmpeg.wasm fallback
  ['sample.avi', 'mp4'],
  ['sample.wma', 'mp3'],
  ['sample.aiff', 'wav'],
  ['sample.aiff', 'opus'],
  // Spreadsheets
  ['sample.csv', 'xlsx'],
  ['sample.json', 'ods'],
];

for (const [source, target] of BINARY) {
  test(`${source} → ${target}`, async ({ page }) => {
    await convert(page, [source], target);
    const file = await saveResult(page);
    expect(file.name).toBe(source.replace(/\.[^.]+$/, `.${target}`));
    await expectFormat(file, target);
  });
}

test('HEVC video from an iPhone-style MOV becomes H.264 MP4', async ({ page }) => {
  await convert(page, ['sample.mov'], 'mp4');
  const file = await saveResult(page);
  await expectFormat(file, 'mp4');
  // An avc1 sample entry means H.264, which plays everywhere.
  expect(Buffer.from(file.bytes).includes(Buffer.from('avc1'))).toBe(true);
});

test('PDF pages become one image each, delivered as a ZIP', async ({ page }) => {
  await convert(page, ['sample.pdf'], 'png');
  const file = await saveResult(page);
  expect(file.name).toBe('sample.zip');
  const names = Object.keys(file.entries ?? {});
  expect(names).toEqual(['sample-page-1.png', 'sample-page-2.png']);
  for (const name of names) await expectFormat({ name, bytes: file.entries?.[name] as Uint8Array }, 'png');
});

test('PDF text is extracted line by line', async ({ page }) => {
  await convert(page, ['sample.pdf'], 'txt');
  const file = await saveResult(page);
  expect(text(file.bytes)).toBe('Decant sample, page one.\nPage 1\n\nAnd this is page two.\nPage 2\n');
});

test('Word documents become clean Markdown', async ({ page }) => {
  await convert(page, ['sample.docx'], 'md');
  const file = await saveResult(page);
  expect(text(file.bytes)).toBe(
    [
      '# Decant sample',
      '',
      'A short document with **bold**, *italic* and a [link](https://example.com).',
      '',
      '## Formats',
      '',
      '- First item',
      '- Second item',
      '',
      '1. Step one',
      '2. Step two',
      '',
      '| Format | Kind |',
      '| --- | --- |',
      '| HEIC | Image |',
      '| FLAC | Audio |',
      '',
    ].join('\n'),
  );
});

test('Markdown becomes a standalone HTML page', async ({ page }) => {
  await convert(page, ['sample.md'], 'html');
  const html = text((await saveResult(page)).bytes);
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain('<h1>Decant sample</h1>');
  expect(html).toContain('<table>');
});

test('CSV becomes JSON without shifting dates or reformatting numbers', async ({ page }) => {
  await convert(page, ['sample.csv'], 'json');
  const rows = JSON.parse(text((await saveResult(page)).bytes));
  expect(rows[0]).toEqual({ name: 'Ada', role: 'Engineer', joined: '2021-04-01', score: 92.5 });
  expect(rows).toHaveLength(3);
});

test('A multi-sheet workbook becomes one CSV per sheet', async ({ page }) => {
  await convert(page, ['sample.xlsx'], 'csv');
  const file = await saveResult(page);
  expect(Object.keys(file.entries ?? {})).toEqual(['sample-People.csv', 'sample-Summary.csv']);
  expect(text(file.entries?.['sample-Summary.csv'] as Uint8Array)).toBe('metric,value\ntotal,3\n');
});

test('YAML becomes TOML', async ({ page }) => {
  await convert(page, ['sample.yaml'], 'toml');
  const toml = text((await saveResult(page)).bytes);
  expect(toml).toContain('service = "decant"');
  expect(toml).toContain('[limits]');
});

test('Trimming a video to a GIF uses only the chosen range', async ({ page }) => {
  await convert(page, ['sample.mp4'], 'gif', async (p) => {
    await p.getByLabel('Frame rate').selectOption('10');
    await p.getByLabel('End').fill('0.5');
  });
  const file = await saveResult(page);
  await expectFormat(file, 'gif');
  // 0.5 s at 10 fps is 5 frames; each frame starts with an image descriptor (0x2C) after a graphic control block.
  const frames = Buffer.from(file.bytes).toString('latin1').split('\x21\xf9\x04').length - 1;
  expect(frames).toBe(5);
});

test('a portrait phone photo stored sideways becomes an upright PDF page', async ({ page }) => {
  // sample.jpg is 96×64; add the EXIF tag phones use to say "rotate 90° clockwise to display".
  const jpeg = readFileSync(fixture('sample.jpg'));
  const tiff = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff]), app1]);
  const rotated = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);

  await convert(page, [{ name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: rotated }], 'pdf');
  const file = await saveResult(page);
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(file.bytes);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 64, height: 96 });
});

test('UTF-16 and Windows-1252 CSVs keep their accented characters', async ({ page }) => {
  const csv = 'city,café\nMontréal,oui\n';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]);
  await convert(page, [{ name: 'utf16.csv', mimeType: 'text/csv', buffer: utf16 }], 'json');
  expect(JSON.parse(text((await saveResult(page)).bytes))).toEqual([{ city: 'Montréal', café: 'oui' }]);

  const latin1 = Buffer.from(csv, 'latin1');
  await convert(page, [{ name: 'windows.csv', mimeType: 'text/csv', buffer: latin1 }], 'json');
  expect(JSON.parse(text((await saveResult(page)).bytes))).toEqual([{ city: 'Montréal', café: 'oui' }]);
});
