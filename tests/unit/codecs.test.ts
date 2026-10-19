import { describe, expect, it } from 'vitest';
import { baseName, outputName, uniqueNames } from '../../src/core/names';
import {
  buildIco,
  decodeIcoDib,
  encodeBmp,
  fitWithin,
  hasTransparency,
  readIcoDirectory,
} from '../../src/engines/image/codecs';
import { even, scaledDimensions } from '../../src/engines/media/specs';

describe('fitWithin', () => {
  it('leaves images that already fit alone', () => {
    expect(fitWithin(800, 600, 1024)).toEqual([800, 600]);
    expect(fitWithin(800, 600, null)).toEqual([800, 600]);
  });

  it('scales the long edge down to the limit', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual([2048, 1536]);
    expect(fitWithin(1080, 1920, 1280)).toEqual([720, 1280]);
  });

  it('only enlarges when asked to', () => {
    expect(fitWithin(16, 16, 256)).toEqual([16, 16]);
    expect(fitWithin(16, 16, 256, true)).toEqual([256, 256]);
  });
});

describe('encodeBmp', () => {
  it('writes a valid 24-bit bitmap with padded, bottom-up rows', () => {
    // 3×2 image: top row red, green, blue; bottom row white, black, grey.
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255,
    ]);
    const bmp = encodeBmp({ width: 3, height: 2, data });
    const view = new DataView(bmp.buffer);
    const rowSize = 12; // 3 px × 3 bytes = 9, padded to 12
    expect(String.fromCharCode(bmp[0] as number, bmp[1] as number)).toBe('BM');
    expect(view.getUint32(2, true)).toBe(54 + rowSize * 2);
    expect(view.getInt32(18, true)).toBe(3);
    expect(view.getInt32(22, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(24);
    // First stored row is the bottom row (white, black, grey) in BGR order.
    expect(Array.from(bmp.subarray(54, 63))).toEqual([255, 255, 255, 0, 0, 0, 128, 128, 128]);
    // Second stored row is the top row: red, green, blue as BGR.
    expect(Array.from(bmp.subarray(54 + rowSize, 54 + rowSize + 9))).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0]);
  });
});

describe('ICO', () => {
  it('round-trips a directory of PNG entries', () => {
    const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);
    const ico = buildIco([
      { size: 16, png: png(1) },
      { size: 256, png: png(2) },
    ]);
    const entries = readIcoDirectory(ico);
    expect(entries.map((e) => [e.width, e.height, e.bitCount, e.size])).toEqual([
      [16, 16, 32, 5],
      [256, 256, 32, 5],
    ]);
    const last = entries[1];
    expect(last && ico[last.offset + 4]).toBe(2);
  });

  it('decodes a 32-bit DIB entry, which is stored upside down', () => {
    const width = 2;
    const height = 2;
    const header = new Uint8Array(40);
    const view = new DataView(header.buffer);
    view.setUint32(0, 40, true);
    view.setInt32(4, width, true);
    view.setInt32(8, height * 2, true);
    view.setUint16(14, 32, true);
    // Bottom row first: blue, green; then top row: red, transparent.
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
    const mask = new Uint8Array(8);
    const dib = new Uint8Array([...header, ...pixels, ...mask]);
    const image = decodeIcoDib(dib);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(Array.from(image.data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(image.data[7]).toBe(0);
    expect(Array.from(image.data.subarray(8, 12))).toEqual([0, 0, 255, 255]);
  });

  it('spots transparency', () => {
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 10]))).toBe(true);
  });
});

describe('video sizing', () => {
  it('rounds to even numbers', () => {
    expect(even(719)).toBe(720);
    expect(even(1)).toBe(2);
  });

  it('treats "720p" as the short edge, keeping portrait video upright', () => {
    expect(scaledDimensions(1920, 1080, 720)).toEqual([1280, 720]);
    expect(scaledDimensions(1080, 1920, 720)).toEqual([720, 1280]);
    expect(scaledDimensions(1280, 720, 1080)).toBeNull();
  });
});

describe('file names', () => {
  it('swaps the extension and keeps the rest', () => {
    expect(baseName('IMG_0001.HEIC')).toBe('IMG_0001');
    expect(baseName('archive.tar.gz')).toBe('archive.tar');
    expect(baseName('.env')).toBe('.env');
    expect(outputName('IMG_0001.HEIC', 'jpg')).toBe('IMG_0001.jpg');
    expect(outputName('book.pdf', 'png', '-page-01')).toBe('book-page-01.png');
  });

  it('de-duplicates names for archives', () => {
    expect(uniqueNames(['a.jpg', 'b.jpg', 'a.jpg', 'A.jpg', 'a (2).jpg'])).toEqual([
      'a.jpg',
      'b.jpg',
      'a (2).jpg',
      'A (3).jpg',
      'a (2) (2).jpg',
    ]);
  });
});
