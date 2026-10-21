import { describe, expect, it } from 'vitest';
import { formatDuration } from '../../src/app/format';
import { detectFormat, sniffHead } from '../../src/core/sniff';
import { decodeText } from '../../src/core/text';
import { jpegOrientation } from '../../src/engines/image/codecs';

/** A minimal JPEG whose only content is an EXIF block carrying the orientation tag. */
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const u16 = (n: number) => (littleEndian ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (littleEndian ? [n & 0xff, (n >> 8) & 0xff, 0, 0] : [0, 0, (n >> 8) & 0xff, n & 0xff]);
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1), // one IFD entry
    ...u16(0x0112), // Orientation
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0),
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0"
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

describe('JPEG orientation', () => {
  it.each([1, 3, 6, 8])('reads orientation %i from little-endian EXIF', (o) => {
    expect(jpegOrientation(jpegWithOrientation(o))).toBe(o);
  });

  it('reads big-endian EXIF too', () => {
    expect(jpegOrientation(jpegWithOrientation(6, false))).toBe(6);
  });

  it('treats a JPEG without EXIF, or anything else, as upright', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
  });
});

describe('text encodings', () => {
  const utf16le = (text: string) => {
    const out = new Uint8Array(2 + text.length * 2);
    out.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) out[2 + i * 2] = text.charCodeAt(i);
    return out;
  };

  it('does not mistake UTF-16 text for an MP3', async () => {
    expect(await detectFormat(new File([utf16le('name,city\nAda,London\n')], 'export.csv'))).toBe('csv');
    expect(await detectFormat(new File([utf16le('{"a":1}')], 'data'))).toBe('json');
  });

  it('still recognises a bare MP3 frame header', () => {
    expect(sniffHead(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0]), '')).toBe('mp3');
  });

  it('decodes byte-order marks and falls back to Windows-1252', () => {
    expect(decodeText(utf16le('héllo'))).toBe('héllo');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeText(new TextEncoder().encode('naïve'))).toBe('naïve');
  });
});

describe('formatDuration', () => {
  it.each([
    [38, '38 ms'],
    [1412, '1.4 s'],
    [42_400, '42 s'],
    [59_600, '1 min'],
    [119_600, '2 min'],
    [75_000, '1 min 15 s'],
  ])('%i ms → %s', (ms, text) => {
    // Numbers are joined to their units with a no-break space.
    expect(formatDuration(ms).replaceAll('\u00a0', ' ')).toBe(text);
  });
});
