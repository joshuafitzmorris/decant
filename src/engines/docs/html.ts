/** Wraps an HTML fragment in a standalone, readable page. */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; font: 1.0625rem/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 2em 0 0.6em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 1.25em 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid #8884; padding: 0.4em 0.7em; text-align: left; vertical-align: top; }
  pre { padding: 1em; overflow-x: auto; border-radius: 6px; background: #8881; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
  blockquote { margin: 1.25em 0; padding-left: 1em; border-left: 3px solid #8886; color: #8c8c8c; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Elements that end with a blank line in plain text. */
const PARAGRAPH_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'UL',
  'OL',
  'DL',
  'FIGURE',
  'HR',
]);
/** Elements that sit on their own line. */
const LINE_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'DD',
  'DIV',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FOOTER',
  'FORM',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'SECTION',
  'TR',
  'CAPTION',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'SVG', 'BUTTON', 'SELECT']);

/** Readable plain text from HTML: blocks become paragraphs, list items get bullets, table cells get tabs. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';

  /** Ensures the output ends with at least `count` line breaks (and never starts with any). */
  const breakLines = (count: number) => {
    if (!out) return;
    out = out.replace(/[ \t]+$/, '');
    const existing = /\n*$/.exec(out)?.[0].length ?? 0;
    if (existing < count) out += '\n'.repeat(count - existing);
  };

  const walk = (node: Node, inPre: boolean, inCell = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      if (inPre) out += value;
      else {
        const collapsed = value.replace(/\s+/g, ' ');
        // Never start a line, or follow existing whitespace, with a space.
        out += out === '' || /\s$/.test(out) ? collapsed.replace(/^ /, '') : collapsed;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') {
      out = out.replace(/ +$/, '');
      out += '\n';
      return;
    }
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt');
      if (alt) out += alt;
      return;
    }

    // Inside a table cell, paragraphs run together so each row stays on one line.
    const paragraph = PARAGRAPH_TAGS.has(tag) && !inCell;
    const line = LINE_TAGS.has(tag) && !inCell;
    const nestedList = (tag === 'UL' || tag === 'OL') && el.parentElement?.closest('li');
    if (paragraph && !nestedList) breakLines(2);
    else if (line || nestedList) breakLines(1);

    if (tag === 'LI') {
      const depth = Math.max(0, ancestorsMatching(el, 'UL, OL') - 1);
      const marker = el.parentElement?.tagName === 'OL' ? `${indexInList(el)}. ` : '• ';
      out += '  '.repeat(depth) + marker;
    }
    if ((tag === 'TD' || tag === 'TH') && el.previousElementSibling) {
      out = out.replace(/ +$/, '');
      out += '\t';
    }
    if (tag === 'HR') out += '———';

    const cell = inCell || tag === 'TD' || tag === 'TH';
    let first = true;
    for (const child of Array.from(el.childNodes)) {
      if (cell && !first && child.nodeType === Node.ELEMENT_NODE && PARAGRAPH_TAGS.has((child as Element).tagName)) {
        out += ' ';
      }
      walk(child, inPre || tag === 'PRE', cell);
      first = false;
    }

    if (paragraph && !nestedList) breakLines(2);
    else if (line || nestedList) breakLines(1);
  };

  walk(doc.body, false);
  return `${out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function ancestorsMatching(el: Element, selector: string): number {
  let count = 0;
  for (let node = el.parentElement; node; node = node.parentElement) if (node.matches(selector)) count++;
  return count;
}

function indexInList(item: Element): number {
  let index = Number((item.parentElement as HTMLOListElement | null)?.start ?? 1) || 1;
  let sibling = item.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === 'LI') index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
