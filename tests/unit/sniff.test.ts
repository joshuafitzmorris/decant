import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, sniffHead } from '../../src/core/sniff';

const fixtures = join(import.meta.dirname, '..', 'fixtures');

/** What each committed sample should be detected as. */
const EXPECTED: Record<string, string> = {
  'sample.png': 'png',
  'sample.jpg': 'jpg',
  'sample.webp': 'webp',
  'sample.avif': 'avif',
  'sample.heic': 'heic',
  'sample.gif': 'gif',
  'sample.jxl': 'jxl',
  'sample.tiff': 'tiff',
  'sample.bmp': 'bmp',
  'sample.ico': 'ico',
  'sample.svg': 'svg',
  'sample.mp3': 'mp3',
  'sample.wav': 'wav',
  'sample.flac': 'flac',
  'sample.m4a': 'm4a',
  'sample.aac': 'aac',
  'sample.ogg': 'ogg',
  'sample.opus': 'opus',
  'sample.aiff': 'aiff',
  'sample.wma': 'wma',
  'sample.mp4': 'mp4',
  'sample.mov': 'mov',
  'sample.webm': 'webm',
  'sample.mkv': 'mkv',
  'sample.avi': 'avi',
  'sample.wmv': 'wmv',
  'sample.flv': 'flv',
  'sample.m2ts': 'ts',
  'sample.mpg': 'mpg',
  'sample.3gp': '3gp',
  'sample.pdf': 'pdf',
  'sample.docx': 'docx',
  'sample.md': 'md',
  'sample.html': 'html',
  'sample.txt': 'txt',
  'sample.csv': 'csv',
  'sample.tsv': 'tsv',
  'sample.xlsx': 'xlsx',
  'sample.xls': 'xls',
  'sample.ods': 'ods',
  'sample.json': 'json',
  'sample.yaml': 'yaml',
  'sample.toml': 'toml',
  'sample.xml': 'xml',
};

const load = (name: string, as = name) => new File([readFileSync(join(fixtures, name))], as);

describe('detectFormat', () => {
  it('has an expectation for every fixture', () => {
    const files = readdirSync(fixtures).filter((f) => !f.startsWith('.'));
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [name, format] of Object.entries(EXPECTED)) {
    it(`detects ${name} as ${format}`, async () => {
      expect(await detectFormat(load(name))).toBe(format);
    });
  }

  it('trusts contents over a misleading extension', async () => {
    expect(await detectFormat(load('sample.heic', 'IMG_0001.jpg'))).toBe('heic');
    expect(await detectFormat(load('sample.png', 'photo.jpg'))).toBe('png');
    expect(await detectFormat(load('sample.webm', 'clip.mp4'))).toBe('webm');
    expect(await detectFormat(load('sample.docx', 'report.zip'))).toBe('docx');
    expect(await detectFormat(load('sample.xlsx', 'data.bin'))).toBe('xlsx');
  });

  it('recognises files that have no extension', async () => {
    expect(await detectFormat(load('sample.pdf', 'download'))).toBe('pdf');
    expect(await detectFormat(load('sample.flac', 'track'))).toBe('flac');
    expect(await detectFormat(load('sample.json', 'response'))).toBe('json');
    expect(await detectFormat(load('sample.svg', 'icon'))).toBe('svg');
  });

  it('returns null for files it cannot convert', async () => {
    expect(await detectFormat(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])], 'archive.zip'))).toBeNull();
    expect(await detectFormat(new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1])], 'program'))).toBeNull();
    expect(await detectFormat(new File([], 'empty.bin'))).toBeNull();
  });
});

describe('sniffHead', () => {
  it('does not mistake text that starts with "G" for an MPEG transport stream', () => {
    const text = new TextEncoder().encode(`Grace,Admiral${'G'.repeat(400)}`);
    expect(sniffHead(text, 'csv')).toBeNull();
  });

  it('does not mistake CSV beginning with ID3 for an MP3', () => {
    expect(sniffHead(new TextEncoder().encode('ID3,name\n1,a\n'), 'csv')).toBeNull();
  });

  it('flags camera raw files built on TIFF as unsupported', () => {
    expect(sniffHead(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]), 'cr2')).toBe('unsupported');
  });
});
