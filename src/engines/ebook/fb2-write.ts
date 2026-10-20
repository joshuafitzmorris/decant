import { type Book, EXTENSION_FOR_TYPE, escapeXml, fallbackIdentifier, parseChapter } from './book';
import { splitHref } from './clean';

const ITALIC = new Set(['em', 'i', 'cite', 'var', 'dfn']);
const BOLD = new Set(['strong', 'b']);
const STRIKE = new Set(['s', 'del', 'strike']);
const CODE = new Set(['code', 'kbd', 'samp', 'tt']);
const BLOCK = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'hr',
  'table',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
  'caption',
]);

/** Writes FictionBook 2.0. Images must already be JPEG or PNG, the two types FB2 readers support. */
export function writeFb2(book: Book): Uint8Array {
  const binaryId = new Map<string, string>();
  for (const resource of book.resources) {
    if (resource.type === 'image/jpeg' || resource.type === 'image/png') {
      binaryId.set(resource.href, `${resource.id}.${EXTENSION_FOR_TYPE[resource.type]}`);
    }
  }
  const chapterIndex = new Map(book.chapters.map((chapter, i) => [chapter.href, i + 1]));
  /** FB2 ids are global, so each chapter's ids get its number as a prefix. */
  const linkTarget = (href: string): string | null => {
    if (/^(https?|mailto):/i.test(href)) return href;
    const [path, fragment] = splitHref(href);
    const n = chapterIndex.get(path);
    if (!n) return null;
    return fragment ? `#c${n}-${fragment}` : `#c${n}`;
  };

  const sections = book.chapters.map((chapter, i) => {
    const writer = new SectionWriter(i + 1, binaryId, linkTarget);
    const body = parseChapter(chapter.html).body;
    writer.blocks(body, chapter.title);
    const title = chapter.title ? `<title><p>${escapeXml(chapter.title)}</p></title>` : '';
    return `<section id="c${i + 1}">${title}${writer.output() || '<empty-line/>'}</section>`;
  });

  const cover = book.resources.find((r) => r.id === book.coverId);
  const coverId = cover ? binaryId.get(cover.href) : undefined;
  const authors = (book.authors.length ? book.authors : ['Unknown']).map(authorXml).join('');
  const today = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>antique</genre>
${authors}
<book-title>${escapeXml(book.title || 'Untitled')}</book-title>
${book.description ? `<annotation><p>${escapeXml(book.description)}</p></annotation>` : ''}
${book.date ? `<date>${escapeXml(book.date)}</date>` : ''}
${coverId ? `<coverpage><image l:href="#${escapeXml(coverId)}"/></coverpage>` : ''}
<lang>${escapeXml(book.language || 'en')}</lang>
</title-info>
<document-info>
<author><nickname>Decant</nickname></author>
<program-used>Decant</program-used>
<date value="${today}">${today}</date>
<id>${escapeXml(book.identifier ?? fallbackIdentifier(book))}</id>
<version>1.0</version>
</document-info>
${book.publisher ? `<publish-info><publisher>${escapeXml(book.publisher)}</publisher></publish-info>` : ''}
</description>
<body>
<title><p>${escapeXml(book.title || 'Untitled')}</p>${book.authors.map((a) => `<p>${escapeXml(a)}</p>`).join('')}</title>
${sections.join('\n')}
</body>
${book.resources
  .filter((r) => binaryId.has(r.href))
  .map(
    (r) =>
      `<binary id="${escapeXml(binaryId.get(r.href) as string)}" content-type="${r.type}">${base64(r.data)}</binary>`,
  )
  .join('\n')}
</FictionBook>
`;
  return new TextEncoder().encode(xml.replace(/\n{2,}/g, '\n'));
}

function authorXml(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return `<author><nickname>${escapeXml(name)}</nickname></author>`;
  const last = parts.pop() as string;
  return `<author><first-name>${escapeXml(parts.join(' '))}</first-name><last-name>${escapeXml(last)}</last-name></author>`;
}

/** Collects one chapter's FB2 blocks; inline text accumulates until a block boundary flushes it into a <p>. */
class SectionWriter {
  private out = '';
  private line = '';
  private pendingId: string | null = null;
  private skippedTitle = false;

  constructor(
    private readonly chapter: number,
    private readonly images: Map<string, string>,
    private readonly link: (href: string) => string | null,
  ) {}

  output(): string {
    this.flush();
    return this.out;
  }

  blocks(parent: Element, title?: string, quote = false) {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        this.line += escapeXml((node.nodeValue ?? '').replace(/\s+/g, ' '));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      const tag = el.localName;
      if (!BLOCK.has(tag) && tag !== 'img' && tag !== 'br') {
        this.line += this.inline(el);
        continue;
      }
      this.flush();
      this.claimId(el);
      if (/^h[1-6]$/.test(tag)) {
        const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        // The chapter's own heading is already its <title>.
        if (!this.skippedTitle && title && text === title.replace(/\s+/g, ' ').trim()) {
          this.skippedTitle = true;
          continue;
        }
        this.emit(`<subtitle${this.idAttr()}>${this.inlineChildren(el)}</subtitle>`);
      } else if (tag === 'hr') {
        this.emit('<subtitle>* * *</subtitle>');
      } else if (tag === 'img') {
        this.image(el);
      } else if (tag === 'br') {
        // A line break inside running text: FB2 paragraphs can't hold one, so start a new paragraph.
      } else if (tag === 'blockquote') {
        const inner = new SectionWriter(this.chapter, this.images, this.link);
        inner.blocks(el, undefined, true);
        const content = inner.output();
        if (content) this.emit(quote ? content : `<cite>${content}</cite>`);
      } else if (tag === 'ul' || tag === 'ol') {
        this.list(el, 0);
      } else if (tag === 'pre') {
        for (const text of (el.textContent ?? '').replace(/\n$/, '').split('\n')) {
          this.emit(text.trim() ? `<p><code>${escapeXml(text)}</code></p>` : '<empty-line/>');
        }
      } else if (tag === 'table') {
        const rows = Array.from(el.querySelectorAll('tr')).map(
          (row) =>
            `<tr>${Array.from(row.children)
              .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
              .map((cell) => `<${cell.localName}>${this.inlineChildren(cell)}</${cell.localName}>`)
              .join('')}</tr>`,
        );
        if (rows.length) this.emit(`<table>${rows.join('')}</table>`);
      } else {
        this.blocks(el, title, quote);
        this.flush();
      }
    }
  }

  private list(list: Element, depth: number) {
    let n = Number(list.getAttribute('start') ?? 1) || 1;
    for (const item of Array.from(list.children).filter((el) => el.localName === 'li')) {
      const marker = list.localName === 'ol' ? `${n++}. ` : depth ? '– ' : '• ';
      const nested = Array.from(item.children).filter((el) => el.localName === 'ul' || el.localName === 'ol');
      const clone = item.cloneNode(true) as Element;
      for (const sub of Array.from(clone.children)) {
        if (sub.localName === 'ul' || sub.localName === 'ol') sub.remove();
        // Loose lists wrap items in paragraphs; keep the text on the marker's line.
        else if (sub.localName === 'p') sub.replaceWith(...Array.from(sub.childNodes), ' ');
      }
      this.claimId(item);
      this.line = ' '.repeat(depth * 4) + marker;
      this.blocks(clone);
      this.flush();
      for (const sub of nested) this.list(sub, depth + 1);
    }
  }

  private image(el: Element) {
    const id = this.images.get(el.getAttribute('src') ?? '');
    if (id) this.emit(`<image l:href="#${escapeXml(id)}"/>`);
  }

  private inlineChildren(el: Element): string {
    let out = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) out += escapeXml((node.nodeValue ?? '').replace(/\s+/g, ' '));
      else if (node.nodeType === Node.ELEMENT_NODE) out += this.inline(node as Element);
    }
    return out;
  }

  private inline(el: Element): string {
    const tag = el.localName;
    if (el.id && !this.pendingId) this.pendingId = `c${this.chapter}-${el.id}`;
    if (tag === 'img') {
      // Pictures can't sit inside an FB2 paragraph; break the paragraph around them.
      this.flush();
      this.image(el);
      return '';
    }
    if (tag === 'br') {
      this.flush();
      return '';
    }
    const inner = this.inlineChildren(el);
    if (ITALIC.has(tag)) return `<emphasis>${inner}</emphasis>`;
    if (BOLD.has(tag)) return `<strong>${inner}</strong>`;
    if (STRIKE.has(tag)) return `<strikethrough>${inner}</strikethrough>`;
    if (CODE.has(tag)) return `<code>${inner}</code>`;
    if (tag === 'sup' || tag === 'sub') return `<${tag}>${inner}</${tag}>`;
    if (tag === 'a') {
      const href = el.getAttribute('href');
      const target = href ? this.link(href) : null;
      return target ? `<a l:href="${escapeXml(target)}">${inner}</a>` : inner;
    }
    return inner;
  }

  private claimId(el: Element) {
    if (el.id && !this.pendingId) this.pendingId = `c${this.chapter}-${el.id}`;
  }

  private idAttr(): string {
    const id = this.pendingId;
    this.pendingId = null;
    return id ? ` id="${escapeXml(id)}"` : '';
  }

  private flush() {
    const text = this.line.replace(/^ +| +$/g, '');
    this.line = '';
    if (text.replace(/ /g, '').trim()) this.emit(`<p${this.idAttr()}>${text}</p>`);
  }

  private emit(xml: string) {
    this.out += xml;
  }
}

function base64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
