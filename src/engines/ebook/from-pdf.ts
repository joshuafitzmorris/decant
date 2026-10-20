import { abortError, ConversionError, type ProgressFn } from '../types';
import { type Book, type Chapter, escapeXml, type Resource } from './book';

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  page: number;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
    getViewport(options: { scale: number }): { width: number; height: number };
    cleanup(): void;
  }>;
  getOutline(): Promise<{ title: string; dest: unknown }[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
}

/**
 * Rebuilds a book's text from a PDF: lines are regrouped into paragraphs, running
 * heads and page numbers are dropped, larger lines become headings, and the PDF's
 * bookmarks (when it has them) mark the chapters. Pictures are not carried over.
 */
export async function pdfToBook(
  file: Blob,
  fallbackTitle: string,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<Book> {
  const { openPdf } = await import('../pdf');
  const pdf = (await openPdf(file)) as unknown as PdfDocument & { loadingTask: { destroy(): Promise<void> } };
  try {
    const pages: Line[][] = [];
    const heights: number[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (signal.aborted) throw abortError();
      onProgress((n - 1) / pdf.numPages, `Reading page ${n} of ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      heights.push(page.getViewport({ scale: 1 }).height);
      pages.push(linesOf((await page.getTextContent()).items as TextItem[], n));
      page.cleanup();
    }
    if (!pages.some((lines) => lines.length)) {
      throw new ConversionError(
        'This PDF has no selectable text. It is probably a scan, so there is no text to turn into an ebook.',
        'no-text',
      );
    }
    const lines = dropRunningLines(pages, heights);
    const starts = await chapterStarts(pdf);
    const info: Record<string, unknown> = (await pdf.getMetadata().catch(() => ({ info: {} }))).info;
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : fallbackTitle;
    const author = typeof info.Author === 'string' ? info.Author.trim() : '';

    const chapters = toChapters(lines, starts);
    const cover = await renderCover(file, signal).catch(() => null);
    const resources: Resource[] = cover ? [cover] : [];
    return {
      title,
      authors: author ? author.split(/\s*[;&]\s*|\s+and\s+/).filter(Boolean) : [],
      language: typeof info.Language === 'string' && info.Language ? info.Language : 'en',
      coverId: cover?.id,
      chapters,
      resources,
      toc: [],
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Groups positioned text runs into lines, top to bottom. */
function linesOf(items: TextItem[], page: number): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let lastEnd = 0;
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL && current) current = null;
      continue;
    }
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const size = Math.abs(item.transform[3] ?? 0) || item.height || 10;
    if (!current || Math.abs(current.y - y) > size * 0.4) {
      current = { text: '', x, y, size, page };
      lines.push(current);
      lastEnd = x;
    }
    // Runs are often split mid-word; only a visible gap means a space.
    const gap = x - lastEnd;
    if (current.text && gap > size * 0.15 && !current.text.endsWith(' ') && !item.str.startsWith(' '))
      current.text += ' ';
    current.text += item.str;
    current.size = Math.max(current.size, size);
    lastEnd = x + item.width;
    if (item.hasEOL) current = null;
  }
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text)
    .sort((a, b) => b.y - a.y || a.x - b.x);
}

/** Removes page numbers and running heads: short lines near the page edge that repeat across pages. */
function dropRunningLines(pages: Line[][], heights: number[]): Line[] {
  const key = (line: Line) => line.text.toLowerCase().replace(/\d+/g, '#');
  const counts = new Map<string, number>();
  const edge = (line: Line) => {
    const height = heights[line.page - 1] ?? 792;
    return line.y > height * 0.9 || line.y < height * 0.1;
  };
  for (const lines of pages) {
    for (const k of new Set(lines.filter(edge).map(key))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, pages.length * 0.3);
  return pages.flatMap((lines) =>
    lines.filter((line) => {
      if (!edge(line)) return true;
      if (/^(page\s*)?[\divxlc]+(\s*(of|\/)\s*\d+)?$/i.test(line.text)) return false;
      return (counts.get(key(line)) ?? 0) < threshold;
    }),
  );
}

/** Pages where top-level bookmarks point, each starting a chapter. */
async function chapterStarts(pdf: PdfDocument): Promise<{ page: number; title: string }[]> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const starts: { page: number; title: string }[] = [];
  for (const item of outline) {
    try {
      const dest =
        typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : (item.dest as unknown[] | null);
      const ref = dest?.[0];
      if (ref === undefined || ref === null) continue;
      const page = (typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)) + 1;
      starts.push({ page, title: item.title.replace(/\s+/g, ' ').trim() });
    } catch {
      // A bookmark pointing nowhere useful.
    }
  }
  return starts.sort((a, b) => a.page - b.page);
}

function toChapters(lines: Line[], starts: { page: number; title: string }[]): Chapter[] {
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 10;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1] as Line;
    const b = lines[i] as Line;
    if (a.page === b.page && Math.abs(a.size - body) < 0.5 && Math.abs(b.size - body) < 0.5) gaps.push(a.y - b.y);
  }
  gaps.sort((a, b) => a - b);
  const leading = gaps[Math.floor(gaps.length / 2)] ?? body * 1.2;
  const left = Math.min(
    ...lines.filter((l) => Math.abs(l.size - body) < 0.5).map((l) => l.x),
    Number.POSITIVE_INFINITY,
  );

  const chapters: { title?: string; parts: string[] }[] = [];
  let chapter: { title?: string; parts: string[] } = { parts: [] };
  let paragraph = '';
  let heading: { level: number; text: string } | null = null;
  let previous: Line | null = null;
  let nextStart = 0;

  const flushParagraph = () => {
    if (paragraph) chapter.parts.push(`<p>${escapeXml(paragraph)}</p>`);
    paragraph = '';
  };
  const flushHeading = () => {
    if (!heading) return;
    chapter.parts.push(`<h${heading.level}>${escapeXml(heading.text)}</h${heading.level}>`);
    if (!chapter.title) chapter.title = heading.text;
    heading = null;
  };
  const startChapter = (title?: string) => {
    flushParagraph();
    flushHeading();
    if (chapter.parts.length) chapters.push(chapter);
    chapter = { title, parts: title ? [`<h1>${escapeXml(title)}</h1>`] : [] };
  };

  for (const line of lines) {
    while (nextStart < starts.length && (starts[nextStart] as { page: number }).page <= line.page) {
      startChapter((starts[nextStart] as { title: string }).title);
      nextStart++;
      previous = null;
    }
    const level = line.size >= body * 1.5 ? 2 : line.size >= body * 1.2 ? 3 : 0;
    if (level) {
      flushParagraph();
      if (heading && heading.level === level && previous && previous.page === line.page)
        heading.text += ` ${line.text}`;
      else {
        flushHeading();
        heading = { level, text: line.text };
      }
      previous = line;
      continue;
    }
    flushHeading();
    const gap = previous && previous.page === line.page ? previous.y - line.y : 0;
    const indented = line.x > left + body * 0.8;
    const endedSentence = /[.!?:"”’)]$/.test(previous?.text ?? '');
    const newParagraph = !paragraph || gap > leading * 1.45 || (indented && endedSentence);
    if (newParagraph) {
      flushParagraph();
      paragraph = line.text;
    } else if (/[A-Za-z]-$/.test(paragraph) && /^[a-z]/.test(line.text)) {
      // A word hyphenated across the line break.
      paragraph = paragraph.slice(0, -1) + line.text;
    } else {
      paragraph += ` ${line.text}`;
    }
    previous = line;
  }
  flushParagraph();
  flushHeading();
  if (chapter.parts.length) chapters.push(chapter);

  return chapters.map((c, i) => ({ href: `chapter-${i + 1}.xhtml`, title: c.title, html: c.parts.join('\n') }));
}

/** The first page, rendered as the ebook's cover. */
async function renderCover(file: Blob, signal: AbortSignal): Promise<Resource | null> {
  const { pdfToImages } = await import('../pdf');
  const [page] = await pdfToImages({
    file: file as File,
    from: 'pdf',
    to: 'jpg',
    options: { dpi: 110, pages: 'first', quality: 85 },
    signal,
    onProgress: () => {},
  });
  if (!page) return null;
  return {
    id: 'cover',
    href: 'images/cover.jpg',
    type: 'image/jpeg',
    data: new Uint8Array(await page.blob.arrayBuffer()),
  };
}
