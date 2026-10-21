export type Category = 'image' | 'audio' | 'video' | 'document' | 'ebook' | 'data';

export interface Format {
  /** Stable identifier, also the default output extension. */
  id: string;
  /** Short label for buttons and lists, e.g. "JPG" or "WEBP". */
  label: string;
  /** How the format is written in a sentence, when that differs from the label: "WebP", not "WEBP". */
  display?: string;
  /** Human name, e.g. "JPEG image". */
  name: string;
  /** Extensions recognised on input. The first is used for output files. */
  exts: readonly string[];
  mime: string;
  category: Category;
}

const define = <const T extends readonly Format[]>(formats: T) => formats;

export const FORMATS = define([
  // Images
  {
    id: 'jpg',
    label: 'JPG',
    name: 'JPEG image',
    exts: ['jpg', 'jpeg', 'jfif', 'jpe'],
    mime: 'image/jpeg',
    category: 'image',
  },
  { id: 'png', label: 'PNG', name: 'PNG image', exts: ['png', 'apng'], mime: 'image/png', category: 'image' },
  {
    id: 'webp',
    label: 'WEBP',
    display: 'WebP',
    name: 'WebP image',
    exts: ['webp'],
    mime: 'image/webp',
    category: 'image',
  },
  { id: 'avif', label: 'AVIF', name: 'AVIF image', exts: ['avif'], mime: 'image/avif', category: 'image' },
  {
    id: 'heic',
    label: 'HEIC',
    name: 'HEIC photo',
    exts: ['heic', 'heif', 'hif'],
    mime: 'image/heic',
    category: 'image',
  },
  { id: 'gif', label: 'GIF', name: 'GIF image', exts: ['gif'], mime: 'image/gif', category: 'image' },
  { id: 'jxl', label: 'JXL', name: 'JPEG XL image', exts: ['jxl'], mime: 'image/jxl', category: 'image' },
  { id: 'tiff', label: 'TIFF', name: 'TIFF image', exts: ['tiff', 'tif'], mime: 'image/tiff', category: 'image' },
  { id: 'bmp', label: 'BMP', name: 'Bitmap image', exts: ['bmp', 'dib'], mime: 'image/bmp', category: 'image' },
  { id: 'ico', label: 'ICO', name: 'Icon', exts: ['ico', 'cur'], mime: 'image/x-icon', category: 'image' },
  { id: 'svg', label: 'SVG', name: 'SVG vector image', exts: ['svg'], mime: 'image/svg+xml', category: 'image' },

  // Audio
  { id: 'mp3', label: 'MP3', name: 'MP3 audio', exts: ['mp3'], mime: 'audio/mpeg', category: 'audio' },
  { id: 'wav', label: 'WAV', name: 'WAV audio', exts: ['wav', 'wave'], mime: 'audio/wav', category: 'audio' },
  { id: 'flac', label: 'FLAC', name: 'FLAC audio', exts: ['flac'], mime: 'audio/flac', category: 'audio' },
  { id: 'm4a', label: 'M4A', name: 'M4A audio', exts: ['m4a', 'm4b', 'm4r'], mime: 'audio/mp4', category: 'audio' },
  { id: 'aac', label: 'AAC', name: 'AAC audio', exts: ['aac', 'adts'], mime: 'audio/aac', category: 'audio' },
  { id: 'ogg', label: 'OGG', name: 'Ogg audio', exts: ['ogg', 'oga'], mime: 'audio/ogg', category: 'audio' },
  {
    id: 'opus',
    label: 'OPUS',
    display: 'Opus',
    name: 'Opus audio',
    exts: ['opus'],
    mime: 'audio/ogg',
    category: 'audio',
  },
  {
    id: 'aiff',
    label: 'AIFF',
    name: 'AIFF audio',
    exts: ['aiff', 'aif', 'aifc'],
    mime: 'audio/aiff',
    category: 'audio',
  },
  { id: 'wma', label: 'WMA', name: 'Windows Media audio', exts: ['wma'], mime: 'audio/x-ms-wma', category: 'audio' },

  // Video
  { id: 'mp4', label: 'MP4', name: 'MP4 video', exts: ['mp4', 'm4v'], mime: 'video/mp4', category: 'video' },
  { id: 'mov', label: 'MOV', name: 'QuickTime video', exts: ['mov', 'qt'], mime: 'video/quicktime', category: 'video' },
  {
    id: 'webm',
    label: 'WEBM',
    display: 'WebM',
    name: 'WebM video',
    exts: ['webm'],
    mime: 'video/webm',
    category: 'video',
  },
  {
    id: 'mkv',
    label: 'MKV',
    name: 'Matroska video',
    exts: ['mkv', 'mk3d'],
    mime: 'video/x-matroska',
    category: 'video',
  },
  { id: 'avi', label: 'AVI', name: 'AVI video', exts: ['avi'], mime: 'video/x-msvideo', category: 'video' },
  {
    id: 'wmv',
    label: 'WMV',
    name: 'Windows Media video',
    exts: ['wmv', 'asf'],
    mime: 'video/x-ms-wmv',
    category: 'video',
  },
  { id: 'flv', label: 'FLV', name: 'Flash video', exts: ['flv'], mime: 'video/x-flv', category: 'video' },
  {
    id: 'ts',
    label: 'TS',
    name: 'MPEG transport stream',
    exts: ['ts', 'mts', 'm2ts', 'm2t'],
    mime: 'video/mp2t',
    category: 'video',
  },
  {
    id: 'mpg',
    label: 'MPG',
    name: 'MPEG video',
    exts: ['mpg', 'mpeg', 'vob', 'm2v'],
    mime: 'video/mpeg',
    category: 'video',
  },
  { id: '3gp', label: '3GP', name: '3GP video', exts: ['3gp', '3g2'], mime: 'video/3gpp', category: 'video' },

  // Documents
  { id: 'pdf', label: 'PDF', name: 'PDF document', exts: ['pdf'], mime: 'application/pdf', category: 'document' },
  {
    id: 'docx',
    label: 'DOCX',
    name: 'Word document',
    exts: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'document',
  },
  {
    id: 'md',
    label: 'MD',
    display: 'Markdown',
    name: 'Markdown',
    exts: ['md', 'markdown', 'mdown', 'mkd'],
    mime: 'text/markdown',
    category: 'document',
  },
  {
    id: 'html',
    label: 'HTML',
    name: 'Web page',
    exts: ['html', 'htm', 'xhtml'],
    mime: 'text/html',
    category: 'document',
  },
  { id: 'txt', label: 'TXT', name: 'Plain text', exts: ['txt', 'text'], mime: 'text/plain', category: 'document' },

  // Ebooks
  { id: 'epub', label: 'EPUB', name: 'EPUB ebook', exts: ['epub'], mime: 'application/epub+zip', category: 'ebook' },
  {
    id: 'mobi',
    label: 'MOBI',
    name: 'Kindle ebook (MOBI)',
    exts: ['mobi', 'azw', 'prc'],
    mime: 'application/x-mobipocket-ebook',
    category: 'ebook',
  },
  {
    id: 'azw3',
    label: 'AZW3',
    name: 'Kindle ebook (AZW3)',
    exts: ['azw3', 'kf8'],
    mime: 'application/vnd.amazon.ebook',
    category: 'ebook',
  },
  {
    id: 'fb2',
    label: 'FB2',
    name: 'FictionBook ebook',
    exts: ['fb2'],
    mime: 'application/x-fictionbook+xml',
    category: 'ebook',
  },
  {
    id: 'cbz',
    label: 'CBZ',
    name: 'Comic book archive',
    exts: ['cbz'],
    mime: 'application/vnd.comicbook+zip',
    category: 'ebook',
  },

  // Data
  { id: 'csv', label: 'CSV', name: 'CSV spreadsheet', exts: ['csv'], mime: 'text/csv', category: 'data' },
  {
    id: 'tsv',
    label: 'TSV',
    name: 'TSV spreadsheet',
    exts: ['tsv', 'tab'],
    mime: 'text/tab-separated-values',
    category: 'data',
  },
  {
    id: 'xlsx',
    label: 'XLSX',
    name: 'Excel workbook',
    exts: ['xlsx', 'xlsm'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'data',
  },
  {
    id: 'xls',
    label: 'XLS',
    name: 'Excel 97–2003 workbook',
    exts: ['xls'],
    mime: 'application/vnd.ms-excel',
    category: 'data',
  },
  {
    id: 'ods',
    label: 'ODS',
    name: 'OpenDocument spreadsheet',
    exts: ['ods'],
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    category: 'data',
  },
  { id: 'json', label: 'JSON', name: 'JSON data', exts: ['json'], mime: 'application/json', category: 'data' },
  { id: 'yaml', label: 'YAML', name: 'YAML data', exts: ['yaml', 'yml'], mime: 'application/yaml', category: 'data' },
  { id: 'toml', label: 'TOML', name: 'TOML data', exts: ['toml'], mime: 'application/toml', category: 'data' },
  { id: 'xml', label: 'XML', name: 'XML data', exts: ['xml'], mime: 'application/xml', category: 'data' },
]);

export type FormatId = (typeof FORMATS)[number]['id'];

const byId = new Map<string, Format>(FORMATS.map((f) => [f.id, f]));
const byExt = new Map<string, Format>();
for (const format of FORMATS) {
  for (const ext of format.exts) byExt.set(ext, format);
}

export function getFormat(id: FormatId): Format {
  const format = byId.get(id);
  if (!format) throw new Error(`Unknown format: ${id}`);
  return format;
}

/** The format's name as it reads in running text: "WebP", "Markdown", "JPG". */
export function displayName(id: FormatId): string {
  const format = getFormat(id);
  return format.display ?? format.label;
}

export function isFormatId(value: string): value is FormatId {
  return byId.has(value);
}

export function formatFromExtension(ext: string): Format | undefined {
  return byExt.get(ext.toLowerCase());
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export const CATEGORY_NAMES: Record<Category, string> = {
  image: 'Images',
  audio: 'Audio',
  video: 'Video',
  document: 'Documents',
  ebook: 'Ebooks',
  data: 'Data',
};
