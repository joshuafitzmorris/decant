import { extensionOf, type FormatId, formatFromExtension } from './formats';
import { decodeText } from './text';

/**
 * Identifies a file by its contents, falling back to its extension.
 * Binary signatures win over the name, so a HEIC photo saved as ".jpg" is still
 * read as HEIC. Text formats are ambiguous by nature, so the extension decides.
 */
export async function detectFormat(file: Blob & { name: string }): Promise<FormatId | null> {
  const ext = extensionOf(file.name);
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const sniffed = sniffHead(head, ext);

  if (sniffed === 'zip') return detectZipContainer(file, head, ext);
  if (sniffed === 'cfb') return ext === 'xls' ? 'xls' : null;
  if (sniffed === 'unsupported') return null;
  if (sniffed) return sniffed;
  return (formatFromExtension(ext)?.id as FormatId | undefined) ?? null;
}

type SniffResult = FormatId | 'zip' | 'cfb' | 'unsupported' | null;

const ISOBMFF_EXT_FORMATS = new Set(['mp4', 'm4v', 'mov', 'qt', 'm4a', 'm4b', 'm4r', '3gp', '3g2']);
const RAW_PHOTO_EXTS = new Set([
  'cr2',
  'cr3',
  'nef',
  'arw',
  'dng',
  'orf',
  'rw2',
  'pef',
  'srw',
  'raf',
  'nrw',
  'sr2',
  'x3f',
]);

export function sniffHead(b: Uint8Array, ext = ''): SniffResult {
  const at = (offset: number, text: string) => matchAscii(b, offset, text);
  const bytes = (offset: number, ...values: number[]) => values.every((v, i) => b[offset + i] === v);

  if (b.length === 0) return null;

  // A byte-order mark means text, whatever follows. (UTF-16's FF FE would otherwise pass for an MP3 frame.)
  if (bytes(0, 0xef, 0xbb, 0xbf) || bytes(0, 0xff, 0xfe) || bytes(0, 0xfe, 0xff)) return sniffText(b, ext);

  // Images
  if (bytes(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (bytes(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'gif';
  if (bytes(0, 0xff, 0x0a)) return 'jxl';
  if (bytes(0, 0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)) return 'jxl';
  if (at(0, 'II*\0') || at(0, 'MM\0*')) {
    if (RAW_PHOTO_EXTS.has(ext)) return 'unsupported';
    return 'tiff';
  }
  if (at(0, 'BM') && [12, 40, 52, 56, 64, 108, 124].includes(readU32LE(b, 14))) return 'bmp';
  if ((bytes(0, 0, 0, 1, 0) || bytes(0, 0, 0, 2, 0)) && (b[4] ?? 0) + (b[5] ?? 0) > 0 && (b[9] ?? 1) === 0)
    return 'ico';

  // RIFF family
  if (at(0, 'RIFF')) {
    if (at(8, 'WEBP')) return 'webp';
    if (at(8, 'WAVE')) return 'wav';
    if (at(8, 'AVI ')) return 'avi';
  }

  // ISO base media (MP4, MOV, HEIC, AVIF, M4A, 3GP)
  if (at(4, 'ftyp')) return sniffIsobmff(b, ext);

  // Other audio and video containers
  if (bytes(0, 0x1a, 0x45, 0xdf, 0xa3)) return findAscii(b, 'webm', 0, 64) >= 0 ? 'webm' : 'mkv';
  if (at(0, 'OggS')) {
    if (ext === 'opus' || ext === 'ogg' || ext === 'oga') return ext === 'opus' ? 'opus' : 'ogg';
    return findAscii(b, 'OpusHead', 0, 512) >= 0 ? 'opus' : 'ogg';
  }
  if (at(0, 'fLaC')) return 'flac';
  if (at(0, 'FORM') && (at(8, 'AIFF') || at(8, 'AIFC'))) return 'aiff';
  if (bytes(0, 0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11)) return ext === 'wma' ? 'wma' : 'wmv';
  if (at(0, 'FLV') && b[3] === 1) return 'flv';
  if (!looksLikeText(b)) {
    if (b[0] === 0x47 && b[188] === 0x47 && (b.length < 377 || b[376] === 0x47)) return 'ts';
    if (b[4] === 0x47 && b[196] === 0x47) return 'ts';
  }
  if (bytes(0, 0, 0, 1, 0xba) || bytes(0, 0, 0, 1, 0xb3)) return 'mpg';
  if (at(0, 'ID3') && [2, 3, 4].includes(b[3] ?? 0)) return ext === 'aac' ? 'aac' : 'mp3';
  if (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) {
    const layer = ((b[1] ?? 0) >> 1) & 0x03;
    if (layer === 0 && ((b[1] ?? 0) & 0xf0) === 0xf0) return 'aac';
    // MP3 is MPEG audio Layer III, with a usable bitrate and sample rate.
    const bitrate = (b[2] ?? 0) >> 4;
    const sampleRate = ((b[2] ?? 0) >> 2) & 0x03;
    if (layer === 1 && bitrate !== 0x0f && sampleRate !== 0x03) return 'mp3';
  }

  // Documents and archives
  if (at(0, '%PDF-')) return 'pdf';
  if (bytes(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (bytes(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'cfb';

  return sniffText(b, ext);
}

function sniffIsobmff(b: Uint8Array, ext: string): SniffResult {
  const boxSize = readU32BE(b, 0);
  const major = ascii(b, 8, 4);
  const brands = [major];
  for (let offset = 16; offset + 4 <= Math.min(boxSize, b.length); offset += 4) brands.push(ascii(b, offset, 4));
  const has = (...names: string[]) => names.some((n) => brands.includes(n));

  if (has('avif', 'avis')) return 'avif';
  if (has('heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2')) return 'heic';
  if (major === 'crx ') return 'unsupported';
  // Within the MP4 family the extension is a better guide (audio-only vs. video).
  if (ISOBMFF_EXT_FORMATS.has(ext)) return (formatFromExtension(ext)?.id as FormatId | undefined) ?? 'mp4';
  if (major === 'qt  ') return 'mov';
  if (major.startsWith('M4A') || major.startsWith('M4B') || major === 'M4P ') return 'm4a';
  if (major.startsWith('3g')) return '3gp';
  return 'mp4';
}

const TEXT_EXT_FORMATS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkd',
  'txt',
  'text',
  'csv',
  'tsv',
  'tab',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'xhtml',
  'svg',
]);

function sniffText(b: Uint8Array, ext: string): SniffResult {
  // A known text extension is more specific than anything we can infer here.
  if (TEXT_EXT_FORMATS.has(ext)) return null;
  const utf16 = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  if (!utf16 && !looksLikeText(b)) return null;
  const text = decodeText(b).trimStart();
  const lower = text.slice(0, 1024).toLowerCase();
  if (lower.startsWith('<svg') || (lower.startsWith('<?xml') && lower.includes('<svg'))) return 'svg';
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return 'html';
  if (lower.startsWith('<?xml')) return 'xml';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  return null;
}

function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 1024);
  for (let i = 0; i < n; i++) {
    const c = b[i] ?? 0;
    if (c === 0) return false;
    if (c < 0x09 || (c > 0x0d && c < 0x20 && c !== 0x1b)) return false;
  }
  return true;
}

/** Office files are ZIP archives; the entry names tell them apart. */
async function detectZipContainer(file: Blob, head: Uint8Array, ext: string): Promise<FormatId | null> {
  if (findAscii(head, 'application/vnd.oasis.opendocument.spreadsheet', 0, head.length) >= 0) return 'ods';
  const names = await readZipEntryNames(file).catch(() => null);
  if (names) {
    if (names.some((n) => n === 'word/document.xml')) return 'docx';
    if (names.some((n) => n === 'xl/workbook.xml' || n === 'xl/workbook.bin')) return 'xlsx';
    return null;
  }
  // Unreadable directory (e.g. ZIP64); trust the extension for Office formats.
  if (ext === 'docx' || ext === 'xlsx' || ext === 'xlsm' || ext === 'ods') return ext === 'xlsm' ? 'xlsx' : ext;
  return null;
}

export async function readZipEntryNames(file: Blob): Promise<string[]> {
  const tailSize = Math.min(file.size, 22 + 0xffff);
  const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('No ZIP directory');
  const cdSize = readU32LE(tail, eocd + 12);
  const cdOffset = readU32LE(tail, eocd + 16);
  if (cdOffset === 0xffffffff || cdSize > 16 * 1024 * 1024) throw new Error('Unsupported ZIP directory');
  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const names: string[] = [];
  const decoder = new TextDecoder();
  let p = 0;
  while (p + 46 <= cd.length && readU32LE(cd, p) === 0x02014b50) {
    const nameLength = readU16LE(cd, p + 28);
    const extraLength = readU16LE(cd, p + 30);
    const commentLength = readU16LE(cd, p + 32);
    names.push(decoder.decode(cd.subarray(p + 46, p + 46 + nameLength)));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function matchAscii(b: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function findAscii(b: Uint8Array, text: string, from: number, to: number): number {
  const end = Math.min(to, b.length) - text.length;
  for (let i = from; i <= end; i++) if (matchAscii(b, i, text)) return i;
  return -1;
}

function ascii(b: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(b[offset + i] ?? 0);
  return out;
}

const readU16LE = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const readU32LE = (b: Uint8Array, o: number) => (readU16LE(b, o) | (readU16LE(b, o + 2) << 16)) >>> 0;
const readU32BE = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
