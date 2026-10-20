/**
 * The common ground between every ebook reader and writer. Readers (EPUB, MOBI,
 * AZW3, FB2, Word, Markdown...) produce a Book; writers (EPUB, MOBI, FB2, PDF,
 * text...) consume one, so any source can become any target.
 *
 * Chapter HTML is already simplified by the reader: publisher CSS is folded into
 * plain tags (<em>, <strong>, align attributes), so writers never need to
 * understand stylesheets.
 */
export interface Book {
  title: string;
  authors: string[];
  /** BCP 47 language tag, e.g. "en" or "pt-BR". */
  language: string;
  publisher?: string;
  description?: string;
  /** ISO date or just a year. */
  date?: string;
  /** ISBN, URN or similar. Writers make one up when it's missing. */
  identifier?: string;
  /** The `id` of the cover image in `resources`. */
  coverId?: string;
  /** In reading order. */
  chapters: Chapter[];
  /** Images used by chapters (and the cover). */
  resources: Resource[];
  /** Table of contents. When empty, writers list the chapters by title. */
  toc: TocEntry[];
}

export interface Chapter {
  /** File name other chapters link to, e.g. "chapter-3.xhtml". Unique within the book. */
  href: string;
  title?: string;
  /**
   * Well-formed XHTML for the contents of <body>, without the <body> tag or namespaces.
   * Images use `src` equal to a resource's `href`. Links to other chapters use their
   * `href`, optionally with "#id"; ids are unique within a chapter.
   */
  html: string;
}

export interface Resource {
  id: string;
  /** Path used by chapters, e.g. "images/figure-2.jpg". */
  href: string;
  /** MIME type, e.g. "image/jpeg". */
  type: string;
  data: Uint8Array;
}

export interface TocEntry {
  title: string;
  /** A chapter's `href`, optionally with "#id". */
  href: string;
  children: TocEntry[];
}

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Parses a chapter's HTML into a document whose <body> holds it. Tolerates HTML that isn't valid XML. */
export function parseChapter(html: string): Document {
  const parser = new DOMParser();
  const xml = parser.parseFromString(
    `<html xmlns="${XHTML_NS}"><head></head><body>${html}</body></html>`,
    'application/xhtml+xml',
  );
  if (!xml.getElementsByTagName('parsererror').length && xml.body) return xml;
  return parser.parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
}

/** Serialises an element's children as namespace-free XHTML, the form `Chapter.html` uses. */
export function serializeChildren(element: Element): string {
  const serializer = new XMLSerializer();
  let out = '';
  for (const node of Array.from(element.childNodes)) out += serializer.serializeToString(node);
  return out.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

/** MIME type for an image path, from its extension. */
export function imageTypeFromName(name: string): string | undefined {
  return IMAGE_TYPES[name.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? ''];
}

/** MIME type for image bytes, from their signature. */
export function imageTypeFromBytes(bytes: Uint8Array): string | undefined {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif';
  if (b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  if (b(0) === 0x42 && b(1) === 0x4d) return 'image/bmp';
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

export const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** The table of contents to show: the book's own, or one entry per titled chapter. */
export function tocOrChapters(book: Book): TocEntry[] {
  if (book.toc.length) return book.toc;
  return book.chapters
    .filter((chapter) => chapter.title)
    .map((chapter) => ({ title: chapter.title as string, href: chapter.href, children: [] }));
}

/** A stable identifier for books that don't have one. */
export function fallbackIdentifier(book: Pick<Book, 'title' | 'authors'>): string {
  let hash = 0x811c9dc5;
  for (const char of `${book.title}\u0000${book.authors.join(',')}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `urn:decant:${hash.toString(16).padStart(8, '0')}`;
}
