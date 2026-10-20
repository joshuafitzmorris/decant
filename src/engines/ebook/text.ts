import { htmlDocument, htmlToText } from '../docs/html';
import { type Book, escapeXml, parseChapter, serializeChildren, tocOrChapters } from './book';
import { splitHref } from './clean';

const byline = (book: Book) => book.authors.join(', ');

/** The whole book as plain text, chapters separated by blank lines. */
export function bookToText(book: Book): string {
  const header = [book.title, byline(book)].filter(Boolean).join('\n');
  const chapters = book.chapters.map((chapter) => htmlToText(chapter.html).trim()).filter(Boolean);
  return `${[header, ...chapters].filter(Boolean).join('\n\n\n')}\n`;
}

/**
 * The whole book as Markdown. Pictures become their descriptions and links
 * between chapters become plain text, since there are no separate files to point at.
 */
export async function bookToMarkdown(book: Book): Promise<string> {
  const { htmlToMarkdown } = await import('../docs');
  const parts = [`# ${book.title}`];
  if (book.authors.length) parts.push(`*${byline(book)}*`);
  for (const chapter of book.chapters) {
    const body = parseChapter(chapter.html).body;
    for (const img of Array.from(body.querySelectorAll('img'))) img.replaceWith(img.getAttribute('alt') ?? '');
    for (const a of Array.from(body.querySelectorAll('a[href]'))) {
      if (!/^(https?|mailto):/i.test(a.getAttribute('href') ?? '')) a.replaceWith(...Array.from(a.childNodes));
    }
    const markdown = (await htmlToMarkdown(serializeChildren(body))).trim();
    if (markdown) parts.push(markdown);
  }
  return `${parts.join('\n\n')}\n`;
}

/** The whole book as one web page: pictures are embedded and the contents link to each chapter. */
export function bookToHtml(book: Book): string {
  const index = new Map(book.chapters.map((chapter, i) => [chapter.href, i + 1]));
  const anchor = (href: string): string | null => {
    const [path, fragment] = splitHref(href);
    const n = index.get(path);
    return n ? (fragment ? `#c${n}-${fragment}` : `#c${n}`) : null;
  };
  const images = new Map(book.resources.map((r) => [r.href, `data:${r.type};base64,${base64(r.data)}`]));

  const sections = book.chapters.map((chapter, i) => {
    const body = parseChapter(chapter.html).body;
    for (const el of Array.from(body.querySelectorAll('[id]'))) el.id = `c${i + 1}-${el.id}`;
    for (const a of Array.from(body.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      if (/^(https?|mailto):/i.test(href)) continue;
      const target = anchor(href);
      if (target) a.setAttribute('href', target);
      else a.removeAttribute('href');
    }
    for (const img of Array.from(body.querySelectorAll('img'))) {
      const src = images.get(img.getAttribute('src') ?? '');
      if (src) img.setAttribute('src', src);
      else img.remove();
    }
    return `<section id="c${i + 1}">\n${serializeChildren(body)}\n</section>`;
  });

  const toc = tocOrChapters(book);
  const list = (entries: typeof toc): string =>
    `<ul>${entries
      .map((e) => {
        const href = anchor(e.href);
        const label = escapeXml(e.title);
        return `<li>${href ? `<a href="${href}">${label}</a>` : label}${e.children.length ? list(e.children) : ''}</li>`;
      })
      .join('')}</ul>`;
  const cover = book.resources.find((r) => r.id === book.coverId);
  const front = [
    cover ? `<p><img src="${images.get(cover.href)}" alt="Cover"></p>` : '',
    `<h1>${escapeXml(book.title)}</h1>`,
    book.authors.length ? `<p><em>${escapeXml(byline(book))}</em></p>` : '',
    toc.length > 1 ? `<nav><h2>Contents</h2>${list(toc)}</nav>` : '',
  ].join('\n');
  return htmlDocument(book.title, `${front}\n${sections.join('\n')}`);
}

function base64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}
