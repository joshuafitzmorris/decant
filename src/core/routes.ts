import { type FormatId, getFormat } from './formats';

export type EngineId = 'image' | 'media' | 'pdf' | 'docs' | 'ebook' | 'data';

const AUDIO_TARGETS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'] as const;
const audioTargetsFor = (from: FormatId): FormatId[] => AUDIO_TARGETS.filter((t) => t !== from);

/**
 * Every conversion Decant offers, keyed by source format.
 * Targets are ordered by how often people want them; the first one is preselected.
 */
const TARGETS: Partial<Record<FormatId, readonly FormatId[]>> = {
  heic: ['jpg', 'png', 'webp', 'avif', 'pdf', 'jxl', 'tiff', 'gif', 'bmp'],
  jpg: ['png', 'webp', 'avif', 'pdf', 'jxl', 'gif', 'tiff', 'bmp', 'ico'],
  png: ['jpg', 'webp', 'avif', 'ico', 'pdf', 'jxl', 'gif', 'tiff', 'bmp'],
  webp: ['png', 'jpg', 'gif', 'avif', 'pdf', 'jxl', 'tiff', 'bmp', 'ico'],
  avif: ['jpg', 'png', 'webp', 'pdf', 'jxl', 'gif', 'tiff', 'bmp'],
  gif: ['mp4', 'webm', 'png', 'jpg', 'webp', 'avif', 'pdf'],
  jxl: ['jpg', 'png', 'webp', 'avif', 'pdf', 'tiff', 'bmp', 'gif'],
  tiff: ['jpg', 'png', 'pdf', 'webp', 'avif', 'jxl', 'gif', 'bmp'],
  bmp: ['png', 'jpg', 'webp', 'avif', 'pdf', 'ico', 'gif', 'tiff'],
  ico: ['png', 'jpg', 'webp', 'bmp', 'gif'],
  svg: ['png', 'jpg', 'webp', 'ico', 'pdf', 'avif', 'gif', 'tiff', 'bmp'],

  mp3: audioTargetsFor('mp3'),
  wav: audioTargetsFor('wav'),
  flac: audioTargetsFor('flac'),
  m4a: audioTargetsFor('m4a'),
  aac: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'],
  ogg: audioTargetsFor('ogg'),
  opus: audioTargetsFor('opus'),
  aiff: [...AUDIO_TARGETS],
  wma: [...AUDIO_TARGETS],

  mp4: ['mp3', 'gif', 'webm', 'mov', 'mkv', ...audioTargetsFor('mp3')],
  mov: ['mp4', 'gif', 'mp3', 'webm', 'mkv', ...audioTargetsFor('mp3')],
  webm: ['mp4', 'mp3', 'gif', 'mov', 'mkv', ...audioTargetsFor('mp3')],
  mkv: ['mp4', 'mp3', 'webm', 'mov', 'gif', ...audioTargetsFor('mp3')],
  avi: ['mp4', 'mp3', 'webm', 'mov', 'mkv', 'gif', ...audioTargetsFor('mp3')],
  wmv: ['mp4', 'mp3', 'webm', 'mov', 'mkv', 'gif', ...audioTargetsFor('mp3')],
  flv: ['mp4', 'mp3', 'webm', 'mov', 'mkv', 'gif', ...audioTargetsFor('mp3')],
  ts: ['mp4', 'mp3', 'mkv', 'webm', 'mov', 'gif', ...audioTargetsFor('mp3')],
  mpg: ['mp4', 'mp3', 'webm', 'mov', 'mkv', 'gif', ...audioTargetsFor('mp3')],
  '3gp': ['mp4', 'mp3', 'webm', 'mov', 'mkv', 'gif', ...audioTargetsFor('mp3')],

  pdf: ['png', 'jpg', 'txt', 'epub', 'webp', 'cbz'],
  docx: ['md', 'html', 'txt', 'epub'],
  md: ['html', 'txt', 'epub'],
  html: ['md', 'txt', 'epub'],
  txt: ['html', 'md', 'epub'],

  epub: ['pdf', 'mobi', 'txt', 'fb2', 'md', 'html'],
  mobi: ['epub', 'pdf', 'txt', 'fb2', 'md', 'html'],
  azw3: ['epub', 'mobi', 'pdf', 'txt', 'fb2', 'md', 'html'],
  fb2: ['epub', 'mobi', 'pdf', 'txt', 'md', 'html'],
  cbz: ['pdf'],

  csv: ['xlsx', 'json', 'tsv', 'ods'],
  tsv: ['xlsx', 'csv', 'json', 'ods'],
  xlsx: ['csv', 'json', 'tsv', 'ods'],
  xls: ['xlsx', 'csv', 'json', 'tsv', 'ods'],
  ods: ['xlsx', 'csv', 'json', 'tsv'],
  json: ['yaml', 'csv', 'xlsx', 'toml', 'xml', 'tsv', 'ods'],
  yaml: ['json', 'toml', 'xml'],
  toml: ['json', 'yaml', 'xml'],
  xml: ['json', 'yaml', 'toml'],
};

export function targetsFor(from: FormatId): readonly FormatId[] {
  return TARGETS[from] ?? [];
}

export function canConvert(from: FormatId, to: FormatId): boolean {
  return targetsFor(from).includes(to);
}

export function engineFor(from: FormatId, to: FormatId): EngineId {
  const source = getFormat(from);
  const target = getFormat(to);
  switch (source.category) {
    case 'image':
      if (to === 'pdf') return 'pdf';
      return target.category === 'video' ? 'media' : 'image';
    case 'audio':
    case 'video':
      return 'media';
    case 'document':
      if (target.category === 'ebook') return 'ebook';
      return from === 'pdf' ? 'pdf' : 'docs';
    case 'ebook':
      return 'ebook';
    case 'data':
      return 'data';
  }
}

/** All source formats Decant can read, for the file picker's accept list. */
export function readableFormats(): FormatId[] {
  return Object.keys(TARGETS) as FormatId[];
}
