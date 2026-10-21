import { ConversionError } from '../types';
import { type Book, type Chapter, EXTENSION_FOR_TYPE, escapeXml, imageTypeFromBytes, type Resource } from './book';

const XLINK = 'http://www.w3.org/1999/xlink';

/** Reads FictionBook 2 (.fb2, or zipped as .fb2.zip). */
export async function readFb2(file: Blob): Promise<Book> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { unzipSync } = await import('fflate');
    const entry = Object.entries(unzipSync(bytes)).find(([name]) => name.toLowerCase().endsWith('.fb2'));
    if (!entry) throw new ConversionError('This archive doesn’t contain a FictionBook file.');
    bytes = entry[1];
  }
  const doc = new DOMParser().parseFromString(decodeXml(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'FictionBook') {
    throw new ConversionError('This FB2 file couldn’t be read. It may be damaged.');
  }
  const root = doc.documentElement;

  // Images are base64 <binary> elements, referenced as "#id".
  const resources: Resource[] = [];
  const imageHref = new Map<string, string>();
  for (const binary of children(root, 'binary')) {
    const id = binary.getAttribute('id');
    if (!id) continue;
    const data = decodeBase64(binary.textContent ?? '');
    const type = imageTypeFromBytes(data) ?? binary.getAttribute('content-type') ?? '';
    const ext = EXTENSION_FOR_TYPE[type];
    if (!ext || !data.length) continue;
    const href = `images/${id.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-') || 'image'}-${resources.length + 1}.${ext}`;
    resources.push({ id: `img${resources.length + 1}`, href, type, data });
    imageHref.set(id, href);
  }

  const titleInfo = first(first(root, 'description'), 'title-info');
  const publishInfo = first(first(root, 'description'), 'publish-info');
  const documentInfo = first(first(root, 'description'), 'document-info');
  const text = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
  const authors = children(titleInfo, 'author')
    .map((author) => {
      const parts = ['first-name', 'middle-name', 'last-name'].map((name) => text(first(author, name))).filter(Boolean);
      return parts.length ? parts.join(' ') : (text(first(author, 'nickname')) ?? '');
    })
    .filter(Boolean);
  const coverRef = first(first(titleInfo, 'coverpage'), 'image');
  const coverHref = coverRef ? imageHref.get(refId(coverRef)) : undefined;

  const bodies = children(root, 'body');
  const main = bodies.find((body) => !body.getAttribute('name')) ?? bodies[0];
  if (!main) throw new ConversionError('This FB2 file has no text.');

  const chapters: { title?: string; html: string }[] = [];
  const converter = new Converter(imageHref);
  const front: Element[] = [];
  const sections = children(main, 'section');
  for (const child of Array.from(main.children)) if (child.localName !== 'section') front.push(child);
  if (front.some((el) => el.localName !== 'title') || !sections.length) {
    chapters.push({ html: front.map((el) => converter.block(el, 1)).join('') });
  }
  for (const section of sections) {
    chapters.push({ title: text(first(section, 'title')), html: converter.block(section, 0) });
  }
  // Footnotes and comments live in extra bodies; they become a chapter at the end.
  for (const extra of bodies.filter((body) => body !== main)) {
    const title = text(first(extra, 'title')) ?? 'Notes';
    chapters.push({
      title,
      html: Array.from(extra.children)
        .map((el) => converter.block(el, 1))
        .join(''),
    });
  }

  // FB2 ids are unique across the book; point each "#id" link at the chapter that holds it.
  const named: Chapter[] = chapters.map((chapter, i) => ({ ...chapter, href: `chapter-${i + 1}.xhtml` }));
  const home = new Map<string, string>();
  for (const chapter of named)
    for (const [, id] of chapter.html.matchAll(/ id="([^"]+)"/g)) home.set(id as string, chapter.href);
  for (const chapter of named) {
    chapter.html = chapter.html.replace(/href="#([^"]*)"/g, (_, id: string) => {
      const target = home.get(id);
      return target ? `href="${target}#${id}"` : 'href="#"';
    });
  }

  return {
    title: text(first(titleInfo, 'book-title')) ?? '',
    authors,
    language: text(first(titleInfo, 'lang')) ?? 'en',
    publisher: text(first(publishInfo, 'publisher')),
    description: text(first(titleInfo, 'annotation')),
    date: first(titleInfo, 'date')?.getAttribute('value') ?? text(first(titleInfo, 'date')),
    identifier: text(first(publishInfo, 'isbn')) ?? text(first(documentInfo, 'id')),
    coverId: resources.find((r) => r.href === coverHref)?.id,
    chapters: named.map((chapter) => ({ ...chapter, html: chapter.html.replace(/ href="#"/g, '') })),
    resources,
    toc: named
      .filter((chapter) => chapter.title)
      .map((chapter) => ({ title: chapter.title as string, href: chapter.href, children: [] })),
  };
}

/** Turns FictionBook markup into the simplified XHTML chapters use. */
class Converter {
  constructor(private readonly images: Map<string, string>) {}

  block(el: Element, depth: number): string {
    const id = el.getAttribute('id');
    const idAttr = id ? ` id="${escapeXml(id)}"` : '';
    switch (el.localName) {
      case 'section': {
        const parts = Array.from(el.children).map((child) =>
          child.localName === 'title' ? this.title(child, depth + 1) : this.block(child, depth + 1),
        );
        return `<div${idAttr}>${parts.join('')}</div>`;
      }
      case 'title':
        return this.title(el, depth);
      case 'p':
        return `<p${idAttr}>${this.inline(el)}</p>`;
      case 'subtitle':
        return `<h4${idAttr} align="center">${this.inline(el)}</h4>`;
      case 'empty-line':
        return '<p> </p>';
      case 'epigraph':
      case 'cite':
        return `<blockquote${idAttr}>${Array.from(el.children)
          .map((child) => this.block(child, depth))
          .join('')}</blockquote>`;
      case 'text-author':
        return `<p align="right"><em>${this.inline(el)}</em></p>`;
      case 'poem':
        return `<div${idAttr}>${Array.from(el.children)
          .map((child) => this.block(child, depth))
          .join('')}</div>`;
      case 'stanza': {
        const lines = Array.from(el.children).filter((child) => child.localName === 'v');
        const heading = first(el, 'title');
        return `${heading ? this.title(heading, 5) : ''}<p>${lines.map((v) => this.inline(v)).join('<br/>')}</p>`;
      }
      case 'v':
        return `<p>${this.inline(el)}</p>`;
      case 'date':
        return `<p align="right">${this.inline(el)}</p>`;
      case 'image': {
        const src = this.images.get(refId(el));
        return src ? `<p align="center"${idAttr}><img src="${escapeXml(src)}" alt=""/></p>` : '';
      }
      case 'table':
        return `<table${idAttr}>${Array.from(el.children)
          .filter((row) => row.localName === 'tr')
          .map(
            (row) =>
              `<tr>${Array.from(row.children)
                .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
                .map((cell) => `<${cell.localName}>${this.inline(cell)}</${cell.localName}>`)
                .join('')}</tr>`,
          )
          .join('')}</table>`;
      case 'annotation':
        return `<div${idAttr}>${Array.from(el.children)
          .map((child) => this.block(child, depth))
          .join('')}</div>`;
      default:
        return el.children.length
          ? Array.from(el.children)
              .map((child) => this.block(child, depth))
              .join('')
          : `<p>${this.inline(el)}</p>`;
    }
  }

  private title(el: Element, depth: number): string {
    const level = Math.min(6, Math.max(1, depth));
    const lines = Array.from(el.children).map((p) => this.inline(p));
    const content = lines.length ? lines.join('<br/>') : this.inline(el);
    return `<h${level}>${content}</h${level}>`;
  }

  private inline(el: Element): string {
    let out = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        out += escapeXml(node.nodeValue ?? '');
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const child = node as Element;
      const inner = this.inline(child);
      switch (child.localName) {
        case 'emphasis':
          out += `<em>${inner}</em>`;
          break;
        case 'strong':
          out += `<strong>${inner}</strong>`;
          break;
        case 'strikethrough':
          out += `<s>${inner}</s>`;
          break;
        case 'sub':
        case 'sup':
        case 'code':
          out += `<${child.localName}>${inner}</${child.localName}>`;
          break;
        case 'a': {
          const href = child.getAttributeNS(XLINK, 'href') ?? child.getAttribute('l:href') ?? '';
          const target = href.startsWith('#') ? href : /^(https?|mailto):/i.test(href) ? href : '';
          // Footnote references read better raised, as they look in FB2 readers.
          const body = child.getAttribute('type') === 'note' ? `<sup>${inner}</sup>` : inner;
          out += target ? `<a href="${escapeXml(target)}">${body}</a>` : body;
          break;
        }
        case 'image': {
          const src = this.images.get(refId(child));
          if (src) out += `<img src="${escapeXml(src)}" alt=""/>`;
          break;
        }
        default:
          out += inner;
      }
    }
    return out;
  }
}

function refId(image: Element): string {
  const href =
    image.getAttributeNS(XLINK, 'href') ?? image.getAttribute('l:href') ?? image.getAttribute('xlink:href') ?? '';
  return href.replace(/^#/, '');
}

function children(parent: Element | undefined, name: string): Element[] {
  return parent ? Array.from(parent.children).filter((el) => el.localName === name) : [];
}

function first(parent: Element | undefined, name: string): Element | undefined {
  return children(parent, name)[0];
}

/** Honours the XML declaration's encoding; Russian FB2 files are often Windows-1251. */
function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200));
  const declared = /encoding=["']([\w.:-]+)["']/i.exec(head)?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}
