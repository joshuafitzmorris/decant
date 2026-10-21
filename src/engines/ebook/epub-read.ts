import { ConversionError } from '../types';
import { type Book, type Chapter, EXTENSION_FOR_TYPE, imageTypeFromBytes, type Resource, type TocEntry } from './book';
import { cleanBody, firstHeading, isExternal, resolvePath, splitHref, unlinkMissing } from './clean';
import { flattenStyles } from './styles';

const DC = 'http://purl.org/dc/elements/1.1/';
const CONTENT_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/x-dtbook+xml']);
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

interface Item {
  id: string;
  path: string;
  type: string;
  properties: string[];
}

export async function readEpub(file: Blob): Promise<Book> {
  const { unzipSync } = await import('fflate');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ConversionError('This EPUB couldn’t be opened. It may be damaged.');
  }
  const text = (path: string) => {
    const data = files[path];
    return data ? new TextDecoder().decode(data) : null;
  };
  const xml = (path: string) => {
    const source = text(path);
    if (source === null) return null;
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  };

  checkDrm(files, text('META-INF/encryption.xml'));

  const container = xml('META-INF/container.xml');
  const opfPath =
    container?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ??
    Object.keys(files).find((name) => name.toLowerCase().endsWith('.opf'));
  const opf = opfPath ? xml(opfPath) : null;
  if (!opfPath || !opf) throw new ConversionError('This EPUB’s package file is missing or damaged.');

  // Manifest and spine
  const items = new Map<string, Item>();
  for (const el of Array.from(opf.getElementsByTagName('item'))) {
    const id = el.getAttribute('id');
    const href = el.getAttribute('href');
    if (!id || !href) continue;
    items.set(id, {
      id,
      path: resolvePath(opfPath, href),
      type: el.getAttribute('media-type') ?? '',
      properties: (el.getAttribute('properties') ?? '').split(/\s+/),
    });
  }
  const spine = Array.from(opf.getElementsByTagName('itemref'))
    .map((ref) => items.get(ref.getAttribute('idref') ?? ''))
    .filter((item): item is Item => !!item && CONTENT_TYPES.has(item.type) && !!files[item.path]);
  if (!spine.length) throw new ConversionError('This EPUB has no readable chapters.');

  const chapterHref = new Map<string, string>(spine.map((item, i) => [item.path, `chapter-${i + 1}.xhtml`]));

  // Images, collected as chapters use them
  const resources: Resource[] = [];
  const resourceFor = new Map<string, Resource>();
  const addResource = (path: string): Resource | null => {
    const existing = resourceFor.get(path);
    if (existing) return existing;
    const data = files[path];
    const type = data && imageTypeFromBytes(data);
    if (!data || !type) return null;
    const base = (path.split('/').pop() ?? 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-') || 'image';
    let href = `images/${base}.${EXTENSION_FOR_TYPE[type] ?? 'img'}`;
    for (let n = 2; resources.some((r) => r.href === href); n++)
      href = `images/${base}-${n}.${EXTENSION_FOR_TYPE[type]}`;
    const resource = { id: `img${resources.length + 1}`, href, type, data };
    resources.push(resource);
    resourceFor.set(path, resource);
    return resource;
  };

  const toc = readToc(opf, items, xml, chapterHref);
  const tocTitles = new Map<string, string>();
  for (const entry of flatten(toc)) {
    const [href, fragment] = splitHref(entry.href);
    if (!fragment && !tocTitles.has(href)) tocTitles.set(href, entry.title);
  }

  const chapters: Chapter[] = [];
  for (const item of spine) {
    const source = text(item.path) ?? '';
    const doc = parseContent(source);
    const body = doc.body ?? doc.getElementsByTagName('body')[0];
    if (!body) continue;
    const stylesheets: string[] = [];
    for (const link of Array.from(doc.getElementsByTagName('link'))) {
      if (!/stylesheet/i.test(link.getAttribute('rel') ?? '')) continue;
      const css = text(resolvePath(item.path, link.getAttribute('href') ?? ''));
      if (css) stylesheets.push(css);
    }
    for (const style of Array.from(doc.getElementsByTagName('style'))) stylesheets.push(style.textContent ?? '');
    flattenStyles(doc, stylesheets);

    const href = chapterHref.get(item.path) as string;
    const html = await cleanBody(doc, body, {
      link: (target) => {
        if (isExternal(target)) return target;
        const [path, fragment] = splitHref(target);
        const destination = path ? chapterHref.get(resolvePath(item.path, path)) : href;
        return destination ? destination + (fragment ? `#${fragment}` : '') : null;
      },
      image: (src) => (src.startsWith('data:') ? null : (addResource(resolvePath(item.path, src))?.href ?? null)),
    });
    const title = tocTitles.get(href) ?? firstHeading(body) ?? (doc.title?.trim() || undefined);
    chapters.push({ href, title, html });
  }

  const kept = new Set(chapters.map((chapter) => chapter.href));
  for (const chapter of chapters) chapter.html = unlinkMissing(chapter.html, kept);

  // Metadata
  const meta = opf.getElementsByTagName('metadata')[0] ?? opf.documentElement;
  const dc = (name: string) =>
    Array.from(meta.getElementsByTagName('*'))
      .filter(
        (el) => el.localName === name && (el.namespaceURI === DC || el.prefix === 'dc' || el.tagName === `dc:${name}`),
      )
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);
  const coverItem =
    Array.from(items.values()).find((item) => item.properties.includes('cover-image')) ??
    items.get(
      Array.from(meta.getElementsByTagName('meta'))
        .find((m) => m.getAttribute('name') === 'cover')
        ?.getAttribute('content') ?? '',
    );
  const cover = coverItem ? addResource(coverItem.path) : null;

  return {
    title: dc('title')[0] ?? '',
    authors: dc('creator'),
    language: dc('language')[0] ?? 'en',
    publisher: dc('publisher')[0],
    description: dc('description')[0]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    date: dc('date')[0],
    identifier: dc('identifier')[0],
    coverId: cover?.id,
    chapters,
    resources,
    toc,
  };
}

/** Adobe and Readium DRM encrypt the chapters themselves; font obfuscation alone is fine. */
function checkDrm(files: Record<string, Uint8Array>, encryption: string | null) {
  const locked = new ConversionError(
    'This book is protected with DRM, so Decant can’t convert it. Books without DRM, such as those from Project Gutenberg, convert normally.',
    'drm',
  );
  if (files['META-INF/rights.xml'] || files['META-INF/license.lcpl']) throw locked;
  if (!encryption) return;
  const doc = new DOMParser().parseFromString(encryption, 'application/xml');
  for (const data of Array.from(doc.getElementsByTagName('*')).filter((el) => el.localName === 'EncryptedData')) {
    const method = Array.from(data.getElementsByTagName('*')).find((el) => el.localName === 'EncryptionMethod');
    const algorithm = method?.getAttribute('Algorithm') ?? '';
    if (!FONT_OBFUSCATION.has(algorithm)) throw locked;
  }
}

function parseContent(source: string): Document {
  const parser = new DOMParser();
  const xhtml = parser.parseFromString(source, 'application/xhtml+xml');
  if (!xhtml.getElementsByTagName('parsererror').length && xhtml.getElementsByTagName('body').length) return xhtml;
  return parser.parseFromString(source, 'text/html');
}

/** The EPUB 3 navigation document, or the EPUB 2 NCX. */
function readToc(
  opf: Document,
  items: Map<string, Item>,
  xml: (path: string) => Document | null,
  chapterHref: Map<string, string>,
): TocEntry[] {
  const target = (base: string, href: string) => {
    const [path, fragment] = splitHref(href);
    const chapter = chapterHref.get(resolvePath(base, path));
    return chapter ? chapter + (fragment ? `#${fragment}` : '') : null;
  };

  const navItem = Array.from(items.values()).find((item) => item.properties.includes('nav'));
  const nav = navItem ? xml(navItem.path) : null;
  if (nav && navItem) {
    const tocNav =
      Array.from(nav.getElementsByTagName('nav')).find((el) =>
        Array.from(el.attributes).some((a) => a.localName === 'type' && a.value.split(/\s+/).includes('toc')),
      ) ?? nav.getElementsByTagName('nav')[0];
    const list = tocNav ? Array.from(tocNav.children).find((el) => el.localName === 'ol') : undefined;
    if (list) {
      const entries = (ol: Element): TocEntry[] =>
        Array.from(ol.children)
          .filter((li) => li.localName === 'li')
          .flatMap((li) => {
            const link = Array.from(li.children).find((el) => el.localName === 'a' || el.localName === 'span');
            const sub = Array.from(li.children).find((el) => el.localName === 'ol');
            const children = sub ? entries(sub) : [];
            const href = link?.getAttribute('href');
            const resolved = href ? target(navItem.path, href) : null;
            const title = link?.textContent?.replace(/\s+/g, ' ').trim();
            return resolved && title ? [{ title, href: resolved, children }] : children;
          });
      const result = entries(list);
      if (result.length) return result;
    }
  }

  const ncxId = opf.getElementsByTagName('spine')[0]?.getAttribute('toc');
  const ncxItem =
    (ncxId && items.get(ncxId)) || Array.from(items.values()).find((item) => item.type === 'application/x-dtbncx+xml');
  const ncx = ncxItem ? xml(ncxItem.path) : null;
  if (!ncx || !ncxItem) return [];
  const points = (parent: Element): TocEntry[] =>
    Array.from(parent.children)
      .filter((el) => el.localName === 'navPoint')
      .flatMap((point) => {
        const label = Array.from(point.getElementsByTagName('text'))[0]?.textContent?.replace(/\s+/g, ' ').trim();
        const src = Array.from(point.children)
          .find((el) => el.localName === 'content')
          ?.getAttribute('src');
        const children = points(point);
        const resolved = src ? target(ncxItem.path, src) : null;
        return resolved && label ? [{ title: label, href: resolved, children }] : children;
      });
  const navMap = Array.from(ncx.getElementsByTagName('navMap'))[0];
  return navMap ? points(navMap) : [];
}

export function* flatten(entries: TocEntry[]): Generator<TocEntry> {
  for (const entry of entries) {
    yield entry;
    yield* flatten(entry.children);
  }
}
