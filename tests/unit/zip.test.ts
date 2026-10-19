import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipFiles } from '../../src/core/zip';

describe('zipFiles', () => {
  it('produces an archive containing every file, with unique names', async () => {
    const text = new Blob(['hello '.repeat(1000)], { type: 'text/plain' });
    const binary = new Blob([new Uint8Array(4096).map((_, i) => i % 251)], { type: 'image/png' });
    const zip = await zipFiles([
      { name: 'notes.txt', blob: text },
      { name: 'photo.png', blob: binary },
      { name: 'photo.png', blob: binary },
    ]);
    expect(zip.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(['notes.txt', 'photo.png', 'photo (2).png']);
    expect(new TextDecoder().decode(entries['notes.txt'])).toBe('hello '.repeat(1000));
    expect(entries['photo (2).png']).toEqual(new Uint8Array(await binary.arrayBuffer()));
    // Text is compressed; already-compressed media is stored.
    expect(zip.size).toBeLessThan(6000 + 2 * 4096 + 600);
  });
});
