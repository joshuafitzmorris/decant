import { ConversionError, type ConvertedFile, type ConvertRequest } from '../types';
import { htmlDocument, htmlToText } from './html';

/**
 * Text documents: Word, Markdown, HTML and plain text. These run on the page
 * because Turndown and the HTML-to-text pass need a real DOM parser.
 */
export async function convert({ file, from, to, onProgress }: ConvertRequest): Promise<ConvertedFile[]> {
  onProgress(null, 'Converting');
  const title = file.name.replace(/\.[^.]+$/, '');
  const html = await toHtml(file, from, title);

  switch (to) {
    case 'html':
      return [text(from === 'html' ? html : htmlDocument(title, html), 'text/html')];
    case 'md':
      return [text(await htmlToMarkdown(html), 'text/markdown')];
    case 'txt':
      return [text(from === 'txt' ? await file.text() : htmlToText(html), 'text/plain')];
    default:
      throw new ConversionError(`Decant can't write ${to.toUpperCase()} from this file yet.`);
  }
}

/** Every source is normalised to an HTML fragment first; each target is produced from that. */
async function toHtml(file: File, from: string, title: string): Promise<string> {
  switch (from) {
    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth
        .convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { includeDefaultStyleMap: true })
        .catch(() => {
          throw new ConversionError("This Word document couldn't be read. It may be damaged or password-protected.");
        });
      return result.value;
    }
    case 'md': {
      const { marked } = await import('marked');
      return marked.parse(await file.text(), { gfm: true, async: false });
    }
    case 'html':
      return file.text();
    case 'txt': {
      const paragraphs = (await file.text()).replace(/\r\n?/g, '\n').split(/\n{2,}/);
      return paragraphs
        .filter((p) => p.trim())
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
    }
    default:
      throw new ConversionError(`Decant can't read ${title} as a document.`);
  }
}

export async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import('turndown'),
    import('@joplin/turndown-plugin-gfm'),
  ]);
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  turndown.remove(['script', 'style', 'noscript', 'iframe', 'title']);
  // Turndown pads list markers to four columns ("-   item"); use the common single space.
  turndown.addRule('listItem', {
    filter: 'li',
    replacement(content, node) {
      const parent = node.parentNode as HTMLElement | null;
      let marker = '- ';
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1) || 1;
        marker = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const indent = ' '.repeat(marker.length);
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n(?!$)/g, `\n${indent}`);
      return marker + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '');
    },
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  promoteHeaderRows(doc);
  return `${turndown.turndown(doc.body).trim()}\n`;
}

/**
 * Markdown tables need a header row, but Word and many HTML tables only use
 * plain cells. Treat the first row as the header, as a person reading it would.
 */
function promoteHeaderRows(doc: Document) {
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const firstRow = table.querySelector('tr');
    if (!firstRow || firstRow.querySelector('th')) continue;
    for (const cell of Array.from(firstRow.children)) {
      if (cell.tagName !== 'TD') continue;
      const th = doc.createElement('th');
      // Header cells are bold already; drop a wrapper that only adds bold.
      const only = cell.children.length === 1 ? cell.firstElementChild : null;
      const inner = only?.tagName === 'P' && only.children.length === 1 ? only.firstElementChild : only;
      th.innerHTML =
        inner && /^(STRONG|B)$/.test(inner.tagName) && inner.textContent === cell.textContent
          ? inner.innerHTML
          : cell.innerHTML;
      for (const attr of Array.from(cell.attributes)) th.setAttribute(attr.name, attr.value);
      cell.replaceWith(th);
    }
    // GFM's table rule only recognises a header inside <thead> or as the first row.
    if (!table.querySelector('thead') && firstRow.parentElement) {
      const thead = doc.createElement('thead');
      firstRow.parentElement.insertBefore(thead, firstRow);
      thead.append(firstRow);
      table.insertBefore(thead, table.firstChild);
    }
  }
}

function text(content: string, type: string): ConvertedFile {
  return { blob: new Blob([content], { type: `${type};charset=utf-8` }) };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
