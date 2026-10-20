import { ConversionError } from '../types';
import { type Book, type Chapter, EXTENSION_FOR_TYPE, imageTypeFromBytes, type Resource, type TocEntry } from './book';
import { cleanBody, firstHeading, isExternal, unlinkMissing } from './clean';
import { flattenStyles } from './styles';
import type { MobiBook, MobiTocItem } from './vendor/foliate-mobi.js';

const DRM_MESSAGE =
  "This Kindle book is protected with DRM, so it can't be converted. Only DRM-free books, such as those from Project Gutenberg or your own documents, can be converted.";
const NONE = 0xffffffff;

/** Reads MOBI and KF8 (AZW3) books with foliate-js's parser, which Decant wraps for conversion. */
export async function readMobi(file: Blob): Promise<Book> {
  await checkDrm(file);
  const [{ MOBI }, { unzlibSync }] = await Promise.all([import('./vendor/foliate-mobi.js'), import('fflate')]);
  let book: MobiBook;
  try {
    book = await new MOBI({ unzlib: unzlibSync }).open(file);
  } catch {
    throw new ConversionError("This Kindle book couldn't be opened. It may be damaged.");
  }
  try {
    // Combined MOBI/KF8 files have a second header for the KF8 half.
    if (book.mobi.headers.palmdoc.encryption !== 0) throw new ConversionError(DRM_MESSAGE, 'drm');
    return await toBook(book);
  } finally {
    book.destroy();
  }
}

/** PalmDOC's encryption field is non-zero for Amazon's DRM; decrypting it isn't something Decant does. */
async function checkDrm(file: Blob) {
  const head = new DataView(await file.slice(0, 96).arrayBuffer());
  if (head.byteLength < 82) throw new ConversionError("This Kindle book couldn't be opened. It may be damaged.");
  const firstRecord = head.getUint32(78);
  const record = new DataView(await file.slice(firstRecord, firstRecord + 16).arrayBuffer());
  if (record.byteLength >= 14 && record.getUint16(12) !== 0) throw new ConversionError(DRM_MESSAGE, 'drm');
}

async function toBook(book: MobiBook): Promise<Book> {
  const kf8 = typeof book.loadFlow === 'function';
  const decode = (data: ArrayBuffer | Uint8Array) =>
    book.mobi.decode(data instanceof Uint8Array ? data : new Uint8Array(data));

  // Every section's document, parsed once, so links can point into any of them.
  const docs: (Document | null)[] = [];
  for (const section of book.sections) {
    let doc = section.createDocument ? await section.createDocument() : null;
    if (doc?.getElementsByTagName('parsererror').length && section.load) {
      // Not valid XHTML: let foliate rebuild it as HTML (its images become blob: URLs).
      const html = await (await fetch(await section.load())).text();
      doc = new DOMParser().parseFromString(html, 'text/html');
    }
    docs.push(doc?.body ? doc : null);
  }
  const hrefs = docs.map((doc, i) => (doc ? `chapter-${i + 1}.xhtml` : null));

  let anchorCount = 0;
  /** A chapter href (with fragment) for a "filepos:" or "kindle:pos:" target. */
  const resolve = async (href: string): Promise<string | null> => {
    if (href.startsWith('filepos:')) {
      const [index] = book.splitTOCHref(href);
      const chapter = hrefs[index as number];
      return chapter ? `${chapter}#filepos${href.slice(8)}` : null;
    }
    if (href.startsWith('kindle:pos:')) {
      const target = await book.resolveHref(href);
      const doc = target ? docs[target.index] : null;
      const chapter = target ? hrefs[target.index] : null;
      if (!target || !doc || !chapter) return null;
      const element = target.anchor(doc);
      if (!element || element === doc.body) return chapter;
      if (!element.id) element.id = `pos-${++anchorCount}`;
      return `${chapter}#${element.id}`;
    }
    return isExternal(href) ? href : null;
  };

  // Links are resolved before any chapter is cleaned, since resolving may add ids to the target.
  for (const doc of docs) {
    if (!doc) continue;
    for (const a of Array.from(doc.body.querySelectorAll('a'))) {
      const filepos = a.getAttribute('filepos');
      const href = filepos ? `filepos:${filepos}` : a.getAttribute('href');
      const target = href ? await resolve(href) : null;
      if (target) a.setAttribute('href', target);
      else a.removeAttribute('href');
    }
  }

  // Images: MOBI 6 uses recindex attributes, KF8 kindle:embed URIs (or SVG flows wrapping one).
  const resources: Resource[] = [];
  const byIndex = new Map<number, Resource | null>();
  const resourceAt = async (index: number): Promise<Resource | null> => {
    if (byIndex.has(index)) return byIndex.get(index) ?? null;
    let resource: Resource | null = null;
    try {
      const raw = await book.mobi.loadResource(index);
      const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const type = imageTypeFromBytes(data);
      if (type) {
        resource = { id: `img${index + 1}`, href: `images/image-${index + 1}.${EXTENSION_FOR_TYPE[type]}`, type, data };
        resources.push(resource);
      }
    } catch {
      // A missing or unreadable record; the image is dropped.
    }
    byIndex.set(index, resource);
    return resource;
  };
  const blobResources = new Map<string, Resource | null>();
  const image = async (src: string): Promise<string | null> => {
    const recindex = /^recindex:(\d+)$/.exec(src);
    if (recindex) return (await resourceAt(Number(recindex[1]) - 1))?.href ?? null;
    const embed = /kindle:embed:(\w+)/.exec(src);
    if (embed?.[1] && !src.includes('kindle:flow:'))
      return (await resourceAt(Number.parseInt(embed[1], 32) - 1))?.href ?? null;
    const flow = /kindle:flow:(\w+)/.exec(src);
    if (flow?.[1] && book.loadFlow) {
      // An SVG wrapper around a picture, the way Calibre and KindleGen store covers.
      const svg = decode((await book.loadFlow(Number.parseInt(flow[1], 32))) ?? new Uint8Array());
      const inner = /kindle:embed:(\w+)/.exec(svg);
      return inner?.[1] ? ((await resourceAt(Number.parseInt(inner[1], 32) - 1))?.href ?? null) : null;
    }
    if (src.startsWith('blob:')) {
      if (!blobResources.has(src)) {
        const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
        const type = imageTypeFromBytes(data);
        const n = resources.length + 1;
        const resource = type
          ? { id: `blob${n}`, href: `images/picture-${n}.${EXTENSION_FOR_TYPE[type]}`, type, data }
          : null;
        if (resource) resources.push(resource);
        blobResources.set(src, resource);
      }
      return blobResources.get(src)?.href ?? null;
    }
    return null;
  };

  const tocTitles = new Map<string, string>();
  const toc = await mapToc(book.toc ?? [], resolve);
  for (const entry of toc) {
    const chapter = entry.href.split('#')[0] as string;
    if (!tocTitles.has(chapter)) tocTitles.set(chapter, entry.title);
  }

  // The book's own contents page is left out: every writer makes a fresh one, and keeping it would add
  // another copy with each round trip.
  const contentsHref = book.landmarks?.find((landmark) => landmark.type?.includes('toc'))?.href;
  let contentsIndex: number | undefined;
  if (contentsHref?.startsWith('filepos:')) contentsIndex = book.splitTOCHref(contentsHref)[0] as number;
  else if (contentsHref?.startsWith('kindle:pos:')) contentsIndex = (await book.resolveHref(contentsHref))?.index;

  const chapters: Chapter[] = [];
  for (const [i, doc] of docs.entries()) {
    const href = hrefs[i];
    if (!doc || !href) continue;
    if (i === contentsIndex && mostlyLinks(doc.body)) continue;
    const stylesheets: string[] = [];
    if (kf8 && book.loadFlow) {
      for (const link of Array.from(doc.getElementsByTagName('link'))) {
        const flow = /kindle:flow:(\w+)/.exec(link.getAttribute('href') ?? '');
        const css = flow?.[1] ? await book.loadFlow(Number.parseInt(flow[1], 32)) : undefined;
        if (css) stylesheets.push(decode(css));
      }
    }
    for (const style of Array.from(doc.getElementsByTagName('style'))) stylesheets.push(style.textContent ?? '');
    flattenStyles(doc, stylesheets);
    for (const img of Array.from(doc.body.querySelectorAll('img[recindex]'))) {
      img.setAttribute('src', `recindex:${img.getAttribute('recindex')}`);
    }
    // Links were resolved above, so they pass through as they are.
    const html = await cleanBody(doc, doc.body, { link: (target) => target, image });
    const empty = !doc.body.textContent?.trim() && !doc.body.querySelector('img');
    if (empty) continue;
    chapters.push({ href, title: tocTitles.get(href) ?? firstHeading(doc.body), html });
  }
  if (!chapters.length) throw new ConversionError('This Kindle book has no readable text.');
  const kept = new Set(chapters.map((chapter) => chapter.href));
  for (const chapter of chapters) chapter.html = unlinkMissing(chapter.html, kept);

  const exth = (book.mobi.headers.exth ?? {}) as { coverOffset?: number; thumbnailOffset?: number };
  const coverIndex =
    exth.coverOffset !== undefined && exth.coverOffset < NONE
      ? exth.coverOffset
      : exth.thumbnailOffset !== undefined && exth.thumbnailOffset < NONE
        ? exth.thumbnailOffset
        : undefined;
  const cover = coverIndex !== undefined ? await resourceAt(coverIndex) : null;

  const { metadata } = book;
  return {
    title: metadata.title?.trim() ?? '',
    authors: (metadata.author ?? []).map((a) => a.trim()).filter(Boolean),
    // EXTH can repeat the language record, so foliate returns a list.
    language: [metadata.language].flat()[0] || 'en',
    publisher: metadata.publisher || undefined,
    description:
      metadata.description
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || undefined,
    date: metadata.published || undefined,
    identifier: metadata.identifier || undefined,
    coverId: cover?.id,
    chapters,
    resources,
    toc: toc.filter((entry) => chapters.some((c) => entry.href.startsWith(c.href))),
  };
}

/** A contents page is mostly link text. */
function mostlyLinks(body: Element): boolean {
  const all = body.textContent?.replace(/\s+/g, '').length ?? 0;
  const linked = Array.from(body.querySelectorAll('a[href]')).reduce(
    (sum, a) => sum + (a.textContent?.replace(/\s+/g, '').length ?? 0),
    0,
  );
  return all > 0 && linked / all > 0.5;
}

async function mapToc(items: MobiTocItem[], resolve: (href: string) => Promise<string | null>): Promise<TocEntry[]> {
  const entries: TocEntry[] = [];
  for (const item of items) {
    const href = await resolve(item.href);
    const children = await mapToc(item.subitems ?? [], resolve);
    const title = item.label.replace(/\s+/g, ' ').trim();
    if (href && title) entries.push({ title, href, children });
    else entries.push(...children);
  }
  return entries;
}
