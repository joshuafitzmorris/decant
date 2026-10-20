import type { FormatId } from '../../core/formats';
import { type Book, type Chapter, EXTENSION_FOR_TYPE, type Resource } from './book';
import { cleanBody, firstHeading, isExternal, splitHref } from './clean';
import { flattenStyles } from './styles';

/** Lines in plain text that start a new chapter. */
const TEXT_HEADING =
  /^(chapter|part|book|section)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+teen|twenty|thirty|forty|fifty)\b[^.!?]{0,60}$|^(prologue|epilogue|introduction|preface|foreword|afterword|acknowledg(e)?ments|appendix(\s+\w+)?)[.:]?$/i;

/** Word, Markdown, HTML and plain text become a book split into chapters at their headings. */
export async function documentToBook(file: File, from: FormatId, fallbackTitle: string): Promise<Book> {
  const { toHtml } = await import('../docs');
  const source = await toHtml(file, from, fallbackTitle);
  const doc = new DOMParser().parseFromString(
    from === 'html' ? source : `<!doctype html><html><head></head><body>${source}</body></html>`,
    'text/html',
  );
  const stylesheets = Array.from(doc.querySelectorAll('style')).map((style) => style.textContent ?? '');
  flattenStyles(doc, stylesheets);
  if (from === 'txt') promoteTextHeadings(doc);

  // Pictures embedded as data: URLs (how Word images arrive) become resources; linked files can't be reached.
  const resources: Resource[] = [];
  const dataImage = (src: string): string | null => {
    const match = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(src);
    const ext = match ? EXTENSION_FOR_TYPE[match[1] as string] : undefined;
    if (!match || !ext) return null;
    const binary = atob((match[2] as string).replace(/\s+/g, ''));
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    const n = resources.length + 1;
    resources.push({ id: `img${n}`, href: `images/image-${n}.${ext}`, type: match[1] as string, data });
    return `images/image-${n}.${ext}`;
  };

  const container = contentRoot(doc.body);
  const parts = splitAtHeadings(doc, container);
  const chapterOf = new Map<string, string>();
  parts.forEach((part, i) => {
    for (const el of part.querySelectorAll('[id]')) chapterOf.set(el.id, `chapter-${i + 1}.xhtml`);
  });

  const chapters: Chapter[] = [];
  for (const [i, part] of parts.entries()) {
    const href = `chapter-${i + 1}.xhtml`;
    const title = firstHeading(part);
    const html = await cleanBody(doc, part, {
      link: (target) => {
        if (isExternal(target)) return target;
        const [path, fragment] = splitHref(target);
        const chapter = !path && fragment ? chapterOf.get(fragment) : undefined;
        return chapter ? `${chapter}#${fragment}` : null;
      },
      image: dataImage,
    });
    chapters.push({ href, title, html });
  }

  const headingTitle = parts.length === 1 ? firstHeading(container) : undefined;
  return {
    title: doc.title.trim() || headingTitle || fallbackTitle,
    authors: [],
    language: doc.documentElement.getAttribute('lang') || 'en',
    chapters,
    resources,
    toc: [],
  };
}

/** Plain text has no markup; lines like "Chapter 3" or "PROLOGUE" become headings. */
function promoteTextHeadings(doc: Document) {
  for (const p of Array.from(doc.body.querySelectorAll('p'))) {
    const text = p.textContent?.trim() ?? '';
    if (text.includes('\n') || p.querySelector('br') || !TEXT_HEADING.test(text)) continue;
    const heading = doc.createElement('h2');
    heading.textContent = text;
    p.replaceWith(heading);
  }
}

/** Descends through lone wrapper elements (<main>, <article>, a single <div>) to where the content lives. */
function contentRoot(body: HTMLElement): HTMLElement {
  let root = body;
  for (;;) {
    const elements = Array.from(root.children).filter((el) => !/^(script|style|nav|header|footer)$/i.test(el.tagName));
    const text = Array.from(root.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (elements.length !== 1 || text || !/^(div|main|article|section)$/i.test(elements[0]?.tagName ?? '')) return root;
    root = elements[0] as HTMLElement;
  }
}

/** Splits at <h1> when there are several, otherwise at <h2>; a document with neither stays one chapter. */
function splitAtHeadings(doc: Document, root: HTMLElement): HTMLElement[] {
  const children = Array.from(root.childNodes);
  const level = ['H1', 'H2'].find((tag) => children.filter((n) => (n as Element).tagName === tag).length >= 2);
  if (!level) {
    const whole = doc.createElement('div');
    whole.append(...children);
    return [whole];
  }
  const parts: HTMLElement[] = [];
  let current = doc.createElement('div');
  for (const node of children) {
    if ((node as Element).tagName === level && current.childNodes.length) {
      if (current.textContent?.trim() || current.querySelector('img')) parts.push(current);
      current = doc.createElement('div');
    }
    current.append(node);
  }
  if (current.textContent?.trim() || current.querySelector('img')) parts.push(current);
  return parts;
}
