import { ConversionError } from '../types';
import {
  type Book,
  type Chapter,
  fallbackIdentifier,
  parseChapter,
  type Resource,
  type TocEntry,
  tocOrChapters,
} from './book';
import { compressPalmDoc } from './palmdoc';

const NONE = 0xffffffff;
const RECORD_SIZE = 4096;
const MOBI_HEADER_LENGTH = 0xe8;
const STORED_TYPES = new Set(['image/jpeg', 'image/gif']);
const EXTERNAL = /^(?:https?|mailto):/i;

/**
 * Writes a MOBI 6 book, the Mobipocket format every Kindle opens. The layout follows Calibre's MOBI
 * writer: a Palm database whose first record holds the headers and metadata, then the whole book as
 * one HTML document cut into compressed 4096-byte records, then the images (JPEG and GIF only; the
 * caller converts the rest), then the FLIS, FCIS and end-of-file records.
 */
export async function writeMobi(book: Book): Promise<Uint8Array> {
  const html = new MobiHtml(book);
  const text = html.write();
  const records = [new Uint8Array(0), ...textRecords(text)];
  const textRecordCount = records.length - 1;
  // Calibre adds a record of zeros so the records after the text start on a four-byte boundary.
  const textSize = records.reduce((size, record) => size + record.length, 0);
  if (textSize % 4) records.push(new Uint8Array(4 - (textSize % 4)));
  const firstNonBook = records.length;
  for (const image of html.images) records.push(image.data);
  const lastContent = records.length - 1;
  const flis = records.length;
  const fcis = flis + 1;
  records.push(FLIS, fcisRecord(text.length), EOF);
  if (records.length > 0xffff) throw new ConversionError('This book is too large to save as MOBI.', 'too-large');

  records[0] = headerRecord(book, {
    textLength: text.length,
    textRecordCount,
    firstNonBook,
    firstImage: html.images.length ? firstNonBook : NONE,
    lastContent,
    flis,
    fcis,
    cover: html.cover,
    start: html.start,
  });
  return palmDatabase(book.title, records);
}

// ---------------------------------------------------------------------------
// The text

/** What each element becomes. Anything not listed is unwrapped: its contents stay, its tag goes. */
const TAGS: Record<string, string> = {
  ...Object.fromEntries(
    [
      'b',
      'big',
      'blockquote',
      'br',
      'code',
      'dd',
      'div',
      'dl',
      'dt',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'li',
      'ol',
      'p',
      'pre',
      's',
      'small',
      'span',
      'strong',
      'sub',
      'sup',
      'table',
      'td',
      'th',
      'tr',
      'u',
      'ul',
    ].map((tag) => [tag, tag]),
  ),
  // MOBI 6 predates HTML5, so its sectioning elements become plain blocks.
  ...Object.fromEntries(
    [
      'address',
      'article',
      'aside',
      'center',
      'details',
      'figcaption',
      'figure',
      'footer',
      'header',
      'hgroup',
      'main',
      'nav',
      'section',
      'summary',
    ].map((tag) => [tag, 'div']),
  ),
  cite: 'i',
  dfn: 'i',
  var: 'i',
  del: 's',
  strike: 's',
  ins: 'u',
  kbd: 'code',
  samp: 'code',
  tt: 'code',
};

/** Elements left out with their contents: scripts, metadata, media and forms a Kindle can't show. */
const DROPPED = new Set([
  'audio',
  'button',
  'canvas',
  'col',
  'colgroup',
  'embed',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'select',
  'style',
  'template',
  'textarea',
  'title',
  'video',
  'wbr',
]);

/** MOBI 6 has no CSS, so only presentational attributes survive; class, style and ids go. */
const KEPT_ATTRIBUTES = new Set(['align', 'valign', 'colspan', 'rowspan']);
const KEPT_BY_TAG: Record<string, string[]> = { img: ['alt'], li: ['value'], ol: ['start', 'type'], ul: ['type'] };

interface Link {
  /** "chapter.xhtml#id", or the chapter alone. */
  target: string;
  /** Where to go when the id isn't found: the chapter's start, as in Calibre. */
  chapter: string;
  /** Position of the link's ten-digit placeholder in the text. */
  at: number;
}

/**
 * Serialises the book as the one HTML document a MOBI 6 file holds: a contents page, then each
 * chapter after a page break. Links within the book become `filepos` attributes, the byte offset of
 * their target in this text, filled in once every chapter is written.
 */
class MobiHtml {
  /** The image records in order; `recindex` attributes count them from 1. */
  readonly images: Resource[] = [];
  /** The cover's index in `images`, if the book has one MOBI can hold. */
  readonly cover: number | undefined;
  /** Byte offset of the first chapter, where Kindles open the book. */
  start = 0;
  private readonly out = new Utf8Buffer();
  /** Byte offset of each chapter ("chapter.xhtml") and element with an id ("chapter.xhtml#id"). */
  private readonly targets = new Map<string, number>();
  private readonly links: Link[] = [];
  private readonly chapters: Set<string>;
  private readonly resources: Map<string, Resource>;
  private chapter = '';

  constructor(private readonly book: Book) {
    this.chapters = new Set(book.chapters.map((chapter) => chapter.href));
    this.resources = new Map(book.resources.map((resource) => [resource.href, resource]));
    // The cover is stored first whether or not the text shows it.
    const cover = book.coverId ? book.resources.find((resource) => resource.id === book.coverId) : undefined;
    this.cover = cover && STORED_TYPES.has(cover.type) ? this.recindex(cover) - 1 : undefined;
  }

  write(): Uint8Array {
    const { out } = this;
    const contents = tocOrChapters(this.book);
    out.write('<html><head><guide>');
    let guide = -1;
    if (contents.length) {
      // Kindles open "Go to > Table of Contents" here, and foliate reads the page it points to as the TOC.
      out.write('<reference type="toc" title="Table of Contents" filepos=');
      guide = out.placeholder();
      // Calibre found that Kindles need the space before "/>".
      out.write(' />');
    }
    // "Go to > Beginning", which is also where the book first opens.
    out.write('<reference type="text" title="Beginning" filepos=');
    const beginning = out.placeholder();
    out.write(' /></guide></head><body>');
    if (contents.length) {
      out.patch(guide, out.length);
      out.write('<h2>Contents</h2>');
      this.writeContents(contents);
    }
    for (const [i, chapter] of this.book.chapters.entries()) {
      if (i > 0 || contents.length) out.write('<mbp:pagebreak/>');
      if (i === 0) this.start = out.length;
      this.writeChapter(chapter);
    }
    out.patch(beginning, this.start);
    out.write('</body></html>');
    for (const link of this.links) {
      out.patch(link.at, this.targets.get(link.target) ?? this.targets.get(link.chapter) ?? 0);
    }
    return out.bytes();
  }

  /** One line per entry; children go in a blockquote, which readers like foliate take as nesting. */
  private writeContents(entries: TocEntry[]): void {
    for (const entry of entries) {
      const target = this.target(entry.href, '');
      this.out.write('<p>');
      if (target) this.writeLinkStart(target);
      this.out.write(escapeText(entry.title));
      if (target) this.out.write('</a>');
      this.out.write('</p>');
      if (entry.children.length) {
        this.out.write('<blockquote>');
        this.writeContents(entry.children);
        this.out.write('</blockquote>');
      }
    }
  }

  private writeChapter(chapter: Chapter): void {
    this.chapter = chapter.href;
    this.targets.set(chapter.href, this.out.length);
    this.writeChildren(parseChapter(chapter.html).body);
  }

  private writeChildren(parent: Node): void {
    for (let node = parent.firstChild; node; node = node.nextSibling) this.writeNode(node);
  }

  private writeNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      this.out.write(escapeText(node.nodeValue ?? ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const name = element.localName.toLowerCase();
    // An id only matters as a link target, so it's recorded here and not written.
    const id = element.getAttribute('id') || (name === 'a' ? element.getAttribute('name') : null);
    if (id && !this.targets.has(`${this.chapter}#${id}`)) this.targets.set(`${this.chapter}#${id}`, this.out.length);

    if (name === 'a') this.writeAnchor(element);
    else if (name === 'img') this.writeImage(element, element.getAttribute('src'));
    else if (name === 'svg') {
      // EPUBs often wrap the cover picture in SVG.
      for (const image of Array.from(element.getElementsByTagName('image'))) {
        this.writeImage(image, image.getAttribute('href') ?? image.getAttribute('xlink:href'));
      }
    } else if (!DROPPED.has(name)) this.writeElement(element, name);
  }

  private writeElement(element: Element, name: string): void {
    const tag = TAGS[name];
    if (!tag) {
      this.writeChildren(element);
      return;
    }
    const attributes = name === 'center' ? ' align="center"' : keptAttributes(element, tag);
    if (tag === 'br' || tag === 'hr') {
      this.out.write(`<${tag}${attributes}/>`);
      return;
    }
    this.out.write(`<${tag}${attributes}>`);
    this.writeChildren(element);
    this.out.write(`</${tag}>`);
  }

  /** Links within the book become filepos links, web and mail links stay, and any other keeps only its text. */
  private writeAnchor(element: Element): void {
    const href = element.getAttribute('href') ?? '';
    const external = EXTERNAL.test(href);
    const target = href && !external ? this.target(href, this.chapter) : undefined;
    if (external) this.out.write(`<a href="${escapeAttribute(href)}">`);
    if (target) this.writeLinkStart(target);
    this.writeChildren(element);
    if (external || target) this.out.write('</a>');
  }

  /** Where `href` (a chapter, maybe with "#id", or just "#id" within `from`) points, if the chapter exists. */
  private target(href: string, from: string): Omit<Link, 'at'> | undefined {
    const hash = href.indexOf('#');
    const chapter = (hash < 0 ? href : href.slice(0, hash)) || from;
    if (!this.chapters.has(chapter)) return undefined;
    const id = hash < 0 ? '' : href.slice(hash + 1);
    return { target: id ? `${chapter}#${id}` : chapter, chapter };
  }

  private writeLinkStart(target: Omit<Link, 'at'>): void {
    this.out.write('<a filepos=');
    this.links.push({ ...target, at: this.out.placeholder() });
    this.out.write('>');
  }

  private writeImage(element: Element, src: string | null): void {
    const resource = src ? this.resources.get(src) : undefined;
    if (!resource || !STORED_TYPES.has(resource.type)) return;
    const recindex = String(this.recindex(resource)).padStart(5, '0');
    this.out.write(`<img recindex="${recindex}"${keptAttributes(element, 'img')} />`);
  }

  /** The image's number in `recindex` attributes, counted from 1. */
  private recindex(resource: Resource): number {
    const index = this.images.indexOf(resource);
    return index < 0 ? this.images.push(resource) : index + 1;
  }
}

function keptAttributes(element: Element, tag: string): string {
  let out = '';
  for (const { name, value } of Array.from(element.attributes)) {
    if (KEPT_ATTRIBUTES.has(name) || KEPT_BY_TAG[tag]?.includes(name)) out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

/** Like Calibre, uses precomposed characters (NFC) and drops soft hyphens. */
function escapeText(text: string): string {
  return text.normalize('NFC').replace(/\xad/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** UTF-8 text that grows as it's written, since links need the byte offset of what comes later. */
class Utf8Buffer {
  length = 0;
  private data = new Uint8Array(1 << 16);
  private readonly encoder = new TextEncoder();

  write(text: string): void {
    // UTF-8 takes at most three bytes per UTF-16 code unit.
    const needed = this.length + text.length * 3;
    if (needed > this.data.length) {
      const grown = new Uint8Array(Math.max(needed, this.data.length * 2));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    this.length += this.encoder.encodeInto(text, this.data.subarray(this.length)).written;
  }

  /** Writes ten zeros to be replaced by a byte offset once it's known; returns where they are. */
  placeholder(): number {
    const at = this.length;
    this.write('0000000000');
    return at;
  }

  patch(at: number, offset: number): void {
    const digits = String(offset).padStart(10, '0');
    for (let i = 0; i < 10; i++) this.data[at + i] = digits.charCodeAt(i);
  }

  bytes(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * Cuts the text into 4096-byte records and compresses each. A record that ends partway through a
 * character also carries the character's remaining bytes and then their count, the "multibyte"
 * trailing entry (extra data flag 1), so each record decodes on its own. Readers strip it before
 * decompressing; the next record still starts with those bytes.
 */
function textRecords(text: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  for (let start = 0; start < text.length; start += RECORD_SIZE) {
    const end = Math.min(start + RECORD_SIZE, text.length);
    let overlap = 0;
    while (overlap < 3 && ((text[end + overlap] ?? 0) & 0xc0) === 0x80) overlap++;
    const compressed = compressPalmDoc(text.subarray(start, end));
    const record = new Uint8Array(compressed.length + overlap + 1);
    record.set(compressed);
    record.set(text.subarray(end, end + overlap), compressed.length);
    record[record.length - 1] = overlap;
    records.push(record);
  }
  return records;
}

// ---------------------------------------------------------------------------
// Headers and records

interface Layout {
  textLength: number;
  textRecordCount: number;
  firstNonBook: number;
  firstImage: number;
  lastContent: number;
  flis: number;
  fcis: number;
  cover: number | undefined;
  start: number;
}

/**
 * Record 0: the PalmDOC header, the MOBI header, the EXTH metadata and the full title. Offsets are
 * from the start of the record, as on the MobileRead wiki; fields not set here are 0.
 */
function headerRecord(book: Book, layout: Layout): Uint8Array {
  const exth = exthBlock(book, layout.cover, layout.start);
  const title = new TextEncoder().encode(book.title);
  const titleOffset = 16 + MOBI_HEADER_LENGTH + exth.length;
  // Calibre follows the title with 8 KB of zeros, room for Amazon's tools to add DRM details in place.
  const record = new Uint8Array(Math.ceil((titleOffset + title.length + 8192) / 4) * 4);
  const view = new DataView(record.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value);

  u16(0, 2); // PalmDOC compression
  u32(4, layout.textLength);
  u16(8, layout.textRecordCount);
  u16(10, RECORD_SIZE);

  setAscii(record, 16, 'MOBI');
  u32(20, MOBI_HEADER_LENGTH);
  u32(24, 2); // a book, not a periodical
  u32(28, 65001); // UTF-8
  u32(32, uniqueId(book));
  u32(36, 6); // format version
  for (let offset = 40; offset < 80; offset += 4) u32(offset, NONE); // dictionary and other indexes
  u32(80, layout.firstNonBook);
  u32(84, titleOffset);
  u32(88, title.length);
  u32(92, mobiLocale(book.language));
  u32(104, 6); // the minimum reader version
  u32(108, layout.firstImage);
  u32(128, 0x50); // EXTH follows
  u32(164, NONE);
  u32(168, NONE); // no DRM; its count and size stay 0
  u16(192, 1); // first and last content records
  u16(194, layout.lastContent);
  u32(196, 1);
  u32(200, layout.fcis);
  u32(204, 1);
  u32(208, layout.flis);
  u32(212, 1);
  u32(224, NONE);
  u32(232, NONE);
  u32(236, NONE);
  u32(240, 1); // extra record data: the multibyte trailing entry
  u32(244, NONE); // no NCX index
  record.set(exth, 16 + MOBI_HEADER_LENGTH);
  record.set(title, titleOffset);
  return record;
}

/** EXTH, the metadata Kindles show: entries of a 4-byte type, a 4-byte length and the data. */
function exthBlock(book: Book, cover: number | undefined, start: number): Uint8Array {
  const encoder = new TextEncoder();
  const entries: Uint8Array[] = [];
  const add = (type: number, data: Uint8Array) => {
    const entry = new Uint8Array(8 + data.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, type);
    view.setUint32(4, entry.length);
    entry.set(data, 8);
    entries.push(entry);
  };
  const text = (type: number, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) add(type, encoder.encode(trimmed));
  };
  const number = (type: number, value: number) => {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, value);
    add(type, data);
  };

  for (const author of book.authors) text(100, author);
  text(101, book.publisher);
  text(103, book.description);
  text(104, isbn(book.identifier));
  text(106, book.date);
  text(113, asin(book.identifier));
  number(116, start); // where reading starts
  text(501, 'EBOK'); // a book, so Kindles list it under Books rather than Docs
  text(503, book.title);
  text(524, book.language);
  if (cover !== undefined) {
    number(201, cover);
    number(202, cover); // the thumbnail is the same picture
    number(203, 0); // a real cover, not a generated one
  }

  const length = entries.reduce((sum, entry) => sum + entry.length, 12);
  // Padding to a multiple of four isn't counted in the length. Calibre always adds at least one byte.
  const block = new Uint8Array(length + 4 - (length % 4));
  const view = new DataView(block.buffer);
  setAscii(block, 0, 'EXTH');
  view.setUint32(4, length);
  view.setUint32(8, entries.length);
  let offset = 12;
  for (const entry of entries) {
    block.set(entry, offset);
    offset += entry.length;
  }
  return block;
}

/** The ISBN in identifiers like "urn:isbn:978-0-14-044913-6". */
function isbn(identifier = ''): string | undefined {
  const value = identifier.replace(/^(?:urn:)?isbn:/i, '').replace(/[\s-]/g, '');
  return /^(?:\d{9}[\dX]|\d{13})$/i.test(value) ? value.toUpperCase() : undefined;
}

/** The Amazon ASIN in identifiers like "B00EXAMPLE" or "urn:asin:B00EXAMPLE". */
function asin(identifier = ''): string | undefined {
  const value = identifier.replace(/^(?:urn:)?(?:asin|amazon|mobi-asin):/i, '');
  return /^B0[0-9A-Z]{8}$/.test(value) ? value : undefined;
}

/** The header's 32-bit id. A MOBI's own id (what readers give as its identifier) is kept; anything else is hashed. */
function uniqueId(book: Book): number {
  const identifier = book.identifier || fallbackIdentifier(book);
  if (/^\d{1,10}$/.test(identifier) && Number(identifier) <= NONE) return Number(identifier);
  let hash = 0x811c9dc5;
  for (const char of identifier) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * MOBI locale codes (as in foliate-js and Calibre): a language's number, then its regions in order.
 * "-" marks unused slots.
 */
const LOCALES: Record<number, string> = {
  1: 'ar ar-SA ar-IQ ar-EG ar-LY ar-DZ ar-MA ar-TN ar-OM ar-YE ar-SY ar-JO ar-LB ar-KW ar-AE ar-BH ar-QA',
  2: 'bg',
  3: 'ca',
  4: 'zh zh-TW zh-CN zh-HK zh-SG',
  5: 'cs',
  6: 'da',
  7: 'de de-DE de-CH de-AT de-LU de-LI',
  8: 'el',
  9: 'en en-US en-GB en-AU en-CA en-NZ en-IE en-ZA en-JM - en-BZ en-TT en-ZW en-PH',
  10: 'es es-ES es-MX - es-GT es-CR es-PA es-DO es-VE es-CO es-PE es-AR es-EC es-CL es-UY es-PY es-BO es-SV es-HN es-NI es-PR',
  11: 'fi',
  12: 'fr fr-FR fr-BE fr-CA fr-CH fr-LU fr-MC',
  13: 'he',
  14: 'hu',
  15: 'is',
  16: 'it it-IT it-CH',
  17: 'ja',
  18: 'ko',
  19: 'nl nl-NL nl-BE',
  20: 'no nb nn',
  21: 'pl',
  22: 'pt pt-BR pt-PT',
  23: 'rm',
  24: 'ro',
  25: 'ru',
  26: 'hr - sr',
  27: 'sk',
  28: 'sq',
  29: 'sv sv-SE sv-FI',
  30: 'th',
  31: 'tr',
  32: 'ur',
  33: 'id',
  34: 'uk',
  35: 'be',
  36: 'sl',
  37: 'et',
  38: 'lv',
  39: 'lt',
  41: 'fa',
  42: 'vi',
  43: 'hy',
  44: 'az',
  45: 'eu',
  46: 'hsb',
  47: 'mk',
  48: 'st',
  49: 'ts',
  50: 'tn',
  52: 'xh',
  53: 'zu',
  54: 'af',
  55: 'ka',
  56: 'fo',
  57: 'hi',
  58: 'mt',
  59: 'se',
  62: 'ms',
  63: 'kk',
  65: 'sw',
  67: 'uz - uz-UZ',
  68: 'tt',
  69: 'bn',
  70: 'pa',
  71: 'gu',
  72: 'or',
  73: 'ta',
  74: 'te',
  75: 'kn',
  76: 'ml',
  77: 'as',
  78: 'mr',
  79: 'sa',
  82: 'cy cy-GB',
  83: 'gl gl-ES',
  87: 'kok',
  97: 'ne',
  98: 'fy',
};

/**
 * The header's locale for a BCP 47 tag: the language number in the low byte and the region's place in
 * its list, times four, in the byte above. 0 when the language has no code.
 */
function mobiLocale(language: string): number {
  const tag = language.trim().toLowerCase().replace(/_/g, '-');
  const primary = tag.split('-')[0] ?? '';
  let fallback = 0;
  for (const [code, list] of Object.entries(LOCALES)) {
    const tags = list.toLowerCase().split(' ');
    const exact = tags.indexOf(tag);
    if (exact >= 0) return (exact << 10) | Number(code);
    const base = tags.indexOf(primary);
    if (base >= 0 && !fallback) fallback = (base << 10) | Number(code);
  }
  return fallback;
}

// FLIS and FCIS hold nothing readers are known to use, but KindleGen and Calibre always write them.
// These are Calibre's.
const FLIS = hex('464c4953 00000008 00410000 00000000 ffffffff 00010003 00000003 00000001 ffffffff');
const EOF = hex('e98e0d0a');

function fcisRecord(textLength: number): Uint8Array {
  const record = hex(
    '46434953 00000014 00000010 00000001 00000000 00000000 00000000 00000020 00000008 00010001 00000000',
  );
  new DataView(record.buffer).setUint32(20, textLength);
  return record;
}

/**
 * The Palm database around the records: a 78-byte header, an 8-byte entry per record (its offset,
 * attributes 0 and a 3-byte unique id), two bytes of padding, then the records themselves.
 */
function palmDatabase(title: string, records: Uint8Array[]): Uint8Array {
  const headerSize = 78 + records.length * 8 + 2;
  const file = new Uint8Array(records.reduce((size, record) => size + record.length, headerSize));
  const view = new DataView(file.buffer);
  file.set(databaseName(title));
  const now = Math.floor(Date.now() / 1000);
  view.setUint32(36, now); // created
  view.setUint32(40, now); // modified
  setAscii(file, 60, 'BOOKMOBI');
  view.setUint32(68, records.length * 2 - 1); // the next unique id, as Calibre sets it
  view.setUint16(76, records.length);
  let offset = headerSize;
  for (const [i, record] of records.entries()) {
    view.setUint32(78 + i * 8, offset);
    view.setUint32(82 + i * 8, i * 2);
    file.set(record, offset);
    offset += record.length;
  }
  return file;
}

/** The database name: the title in ASCII letters and digits (others become "_"), at most 31 bytes and a NUL. */
function databaseName(title: string): Uint8Array {
  const ascii = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]/gu, '_')
    .slice(0, 31);
  const name = new Uint8Array(32);
  setAscii(name, 0, ascii || 'Untitled');
  return name;
}

function setAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}

function hex(text: string): Uint8Array {
  const digits = text.replace(/ /g, '');
  return Uint8Array.from({ length: digits.length / 2 }, (_, i) => Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16));
}
