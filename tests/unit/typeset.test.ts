import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Block, ParagraphBlock, PrintBook, PrintImage, Run } from '../../src/engines/ebook/pdf/blocks';
import {
  type BookFonts,
  breakLines,
  FORCED,
  type Metrics,
  type PageSize,
  type SetLine,
  setText,
  typeset,
} from '../../src/engines/ebook/pdf/typeset';
import { ConversionError } from '../../src/engines/types';

const fontFile = (style: string) =>
  new Uint8Array(readFileSync(resolve('public/vendor/literata-3.103', `Literata-${style}.ttf`)));
const fonts: BookFonts = {
  regular: fontFile('Regular'),
  italic: fontFile('Italic'),
  bold: fontFile('Bold'),
  boldItalic: fontFile('BoldItalic'),
};
const fixture = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures', name)));

const SENTENCES = [
  'The keeper climbed the hundred and twelve steps every evening with a can of paraffin and a clean cloth.',
  'He trimmed the wick, polished the great lens until it threw his face back a dozen times, and sat by the window.',
  'Letters came on Tuesdays, carried along the causeway by a boy who waited at the foot of the tower.',
  'Nobody in the village could say who wrote them, though everyone had a theory and most people had two.',
  'The handwriting was small and upright, the ink a faded violet, and none of the letters was ever signed.',
];
/** A paragraph of plain prose that starts with a word the test can find. */
const prose = (marker: string, sentences = 5): ParagraphBlock => ({
  kind: 'paragraph',
  quote: 0,
  list: 0,
  runs: [{ text: `${marker} ${Array.from({ length: sentences }, (_, i) => SENTENCES[i % 5]).join(' ')}` }],
});
const heading = (text: string, level: 1 | 2 | 3 = 1): Block => ({ kind: 'heading', level, runs: [{ text }] });
const runs = (...parts: (string | Run)[]): Run[] =>
  parts.map((part) => (typeof part === 'string' ? { text: part } : part));

function sampleBook(): PrintBook {
  const cover: PrintImage = { type: 'jpg', data: fixture('sample.jpg'), width: 96, height: 64 };
  const picture: PrintImage = { type: 'png', data: fixture('sample.png'), width: 96, height: 64 };
  return {
    title: 'The Lantern Keeper',
    authors: ['Ada Lovelace', 'Mary Somerville'],
    language: 'en',
    cover,
    chapters: [
      {
        title: 'One: The Tower',
        blocks: [
          heading('Chapter One'),
          heading('The Tower', 2),
          ...['Alpha01', 'Alpha02', 'Alpha03', 'Alpha04', 'Alpha05', 'Alpha06'].map((marker) => prose(marker)),
          {
            kind: 'paragraph',
            quote: 0,
            list: 0,
            runs: runs(
              'Alpha07 He kept a ',
              { text: 'logbook', italic: true },
              ' in a ',
              { text: 'locked drawer', bold: true },
              ', wrote café and naïve with care, quoted Ελληνικά and Кириллица from memory, and drew 🙂 in the margins.',
            ),
          },
          ...['Alpha08', 'Alpha09', 'Alpha10', 'Alpha11', 'Alpha12'].map((marker) => prose(marker)),
        ],
      },
      {
        title: 'Two: The Letters',
        blocks: [
          heading('Chapter Two'),
          prose('Bravo01'),
          {
            kind: 'item',
            marker: '1.',
            runs: runs('Bravo02 paraffin, forty gallons, stored in the shed.'),
            quote: 0,
            list: 1,
          },
          { kind: 'item', marker: '–', runs: runs('Bravo03 wicks, two dozen.'), quote: 0, list: 2 },
          { kind: 'item', marker: '–', runs: runs('Bravo04 cloths, as many as could be found.'), quote: 0, list: 2 },
          { kind: 'item', marker: '2.', runs: runs('Bravo05 letters, thirty-one by the spring.'), quote: 0, list: 1 },
          { ...prose('Bravo06', 2), quote: 1 },
          { ...prose('Bravo07', 1), quote: 1 },
          { kind: 'break' },
          prose('Bravo08'),
          { kind: 'image', image: picture, quote: 0, list: 0 },
          { kind: 'caption', runs: runs('Bravo09 the tower from the causeway.'), quote: 0, list: 0 },
          ...['Bravo10', 'Bravo11', 'Bravo12'].map((marker) => prose(marker)),
        ],
      },
      {
        title: 'Three: Tea',
        blocks: [
          heading('Chapter Three'),
          ...['Charlie01', 'Charlie02', 'Charlie03', 'Charlie04'].map((m) => prose(m)),
        ],
      },
    ],
  };
}

const SIZES: Record<PageSize, [number, number]> = {
  a5: [419.53, 595.28],
  a4: [595.28, 841.89],
  letter: [612, 792],
  '6x9': [432, 648],
};

interface PageText {
  /** Text items with their baseline position and width. */
  items: { str: string; x: number; y: number; width: number }[];
  text: string;
}

/** Extracts each page's text with pdf.js, which is what readers use to copy and search. */
async function readPages(bytes: Uint8Array): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: 0,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items.flatMap((item) =>
      'str' in item && item.str.trim()
        ? [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width }]
        : [],
    );
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? ' ' : '') : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ items, text });
  }
  await pdf.loadingTask.destroy();
  return pages;
}

/** The outline's entries, in order: their titles and the index of the page each opens. */
function outline(doc: PDFDocument): { title: string; page: number }[] {
  const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const pageRefs = doc.getPages().map((page) => page.ref.toString());
  const entries: { title: string; page: number }[] = [];
  for (let item = root.lookupMaybe(PDFName.of('First'), PDFDict); item; ) {
    const title = item.lookup(PDFName.of('Title'), PDFHexString).decodeText();
    const target = item.lookup(PDFName.of('Dest'), PDFArray).get(0);
    entries.push({ title, page: pageRefs.indexOf(String(target)) });
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return entries;
}

describe('typeset', () => {
  it.each(Object.keys(SIZES) as PageSize[])('sets a book on %s pages', async (size) => {
    const book = sampleBook();
    const progress: number[] = [];
    const bytes = await typeset(book, { page: size }, fonts, (value) => progress.push(value));

    // Loading would otherwise stamp pdf-lib as the producer.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pageCount = doc.getPageCount();
    expect(pageCount).toBeGreaterThanOrEqual(8);
    expect(pageCount).toBeLessThan(30);
    const [width, height] = SIZES[size];
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(width, 1);
      expect(page.getHeight()).toBeCloseTo(height, 1);
    }
    expect(doc.getTitle()).toBe('The Lantern Keeper');
    expect(doc.getAuthor()).toBe('Ada Lovelace, Mary Somerville');
    expect(doc.getCreator()).toBe('Decant');
    expect(doc.getProducer()).toBe('Decant');
    expect(String(doc.catalog.get(PDFName.of('Lang')))).toBe('(en)');
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const bookmarks = outline(doc);
    expect(bookmarks.map((entry) => entry.title)).toEqual(['One: The Tower', 'Two: The Letters', 'Three: Tea']);

    const pages = await readPages(bytes);
    // The cover is a picture, the title page has the title and the authors in capitals.
    expect(pages[0]?.items).toEqual([]);
    expect(pages[1]?.text).toBe('The Lantern Keeper ADA LOVELACE, MARY SOMERVILLE');

    // Each bookmark opens the page its chapter starts on, with the title at the top and no page number.
    const openings = bookmarks.map((entry) => entry.page);
    expect(openings[0]).toBe(2);
    for (const [i, title] of ['Chapter One', 'Chapter Two', 'Chapter Three'].entries()) {
      const page = pages[openings[i] as number] as PageText;
      expect(page.text.startsWith(title)).toBe(true);
      expect(page.items.some((item) => /^\d+$/.test(item.str))).toBe(false);
    }

    // Every other page past the title page carries its number, centred in the foot.
    for (let n = 2; n < pages.length; n++) {
      if (openings.includes(n)) continue;
      const folio = pages[n]?.items.find((item) => item.str === String(n + 1));
      expect(folio, `page ${n + 1} number`).toBeDefined();
      expect(folio?.y).toBeLessThan(60);
      expect(Math.abs((folio?.x ?? 0) - width / 2)).toBeLessThan(15);
    }

    // The words come out whole and in order, each chapter on its own pages.
    const all = pages.map((page) => page.text).join(' ');
    const markers = [
      ...Array.from({ length: 12 }, (_, i) => `Alpha${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 12 }, (_, i) => `Bravo${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 4 }, (_, i) => `Charlie${String(i + 1).padStart(2, '0')}`),
    ];
    const positions = markers.map((marker) => all.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const pageOf = (word: string) => pages.findIndex((page) => page.text.includes(word));
    expect(pageOf('Alpha12')).toBeLessThan(openings[1] as number);
    expect(pageOf('Bravo01')).toBe(openings[1]);
    expect(pageOf('Bravo12')).toBeLessThan(openings[2] as number);
    expect(pageOf('Charlie01')).toBe(openings[2]);
    expect(all).toContain(SENTENCES[1]);

    // Accents, Greek and Cyrillic survive; the emoji Literata lacks is dropped.
    expect(all).toContain('wrote café and naïve with care, quoted Ελληνικά and Кириллица from memory');
    expect(all).not.toContain('🙂');
    expect(all).toContain('and drew in the margins.');
  });

  it('puts the pictures in: the cover on the first page and the plate in chapter two', async () => {
    const bytes = await typeset(sampleBook(), { page: 'a5' }, fonts);
    const doc = await PDFDocument.load(bytes);
    const pages = await readPages(bytes);
    const pictures = doc.getPages().map((page) => page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict));
    expect(pictures[0]?.keys().length).toBe(1);
    const plate = pages.findIndex((page) => page.text.includes('Bravo09'));
    expect(pictures[plate]?.keys().length).toBe(1);
    expect(pictures.filter((dict) => dict?.keys().length).length).toBe(2);
  });

  it('gives a cover of about the page’s proportions a page of its own shape, so nothing is cropped', async () => {
    const book = sampleBook();
    // The layout follows the picture's stated size; a 2:3 cover is the usual shape.
    book.cover = { ...(book.cover as PrintImage), width: 600, height: 900 };
    const doc = await PDFDocument.load(await typeset(book, { page: 'a5' }, fonts));
    const [cover, title] = doc.getPages();
    expect(cover?.getHeight()).toBeCloseTo(595.28, 1);
    expect(cover?.getWidth()).toBeCloseTo((595.28 * 2) / 3, 1);
    expect(title?.getWidth()).toBeCloseTo(419.53, 1);
  });

  it('justifies prose to a common right edge, and sets verse ragged with indented turnovers', async () => {
    const verse = [
      'Once upon a midnight dreary, while I pondered, weak and weary, over many a volume of forgotten lore',
      'While I nodded, nearly napping,',
      'Suddenly there came a tapping, as of someone gently rapping, rapping at my chamber door',
    ].join('\n');
    const book: PrintBook = {
      title: 'Lines',
      authors: [],
      language: 'en',
      chapters: [{ blocks: [prose('Prose01'), { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: verse }] }] }],
    };
    const pages = await readPages(await typeset(book, { page: 'a5' }, fonts));
    // Lines of the chapter's page, in reading order, with where their ink starts and ends.
    const byLine = new Map<number, { left: number; right: number; text: string }>();
    for (const item of pages[1]?.items ?? []) {
      const y = Math.round(item.y);
      const line = byLine.get(y) ?? { left: Number.POSITIVE_INFINITY, right: 0, text: '' };
      byLine.set(y, {
        left: Math.min(line.left, item.x),
        right: Math.max(line.right, item.x + item.width),
        text: line.text + item.str,
      });
    }
    const lines = [...byLine.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line);
    const start = lines.findIndex((line) => line.text.startsWith('Once'));
    const justified = lines.slice(0, start - 1);
    // An opening page has no number, so the poem runs to the last line.
    const poem = lines.slice(start);
    // A5: 54 pt margins, so the measure ends at 365.53; Literata kerns and scales, so allow a hair.
    for (const line of justified) expect(line.right).toBeCloseTo(365.53, 0);
    expect(poem.map((line) => Math.round(line.left))).toEqual([54, 70, 54, 54, 70]);
    // Wrapped or short, verse lines keep their natural spacing instead of being stretched to the measure.
    expect(poem[0]?.right).toBeLessThan(360);
    expect(poem[2]?.right).toBeLessThan(250);
  });

  it('refuses a book mostly in a script the font lacks', async () => {
    const book: PrintBook = {
      title: '书',
      authors: [],
      language: 'zh',
      chapters: [{ blocks: [heading('第一章'), prose('这是一本用中文写的书，里面几乎没有拉丁字母。'.repeat(20), 1)] }],
    };
    const result = typeset(book, { page: 'a5' }, fonts);
    await expect(result).rejects.toBeInstanceOf(ConversionError);
    await expect(result).rejects.toThrow(
      "This book uses characters the PDF font can't show, such as Chinese or Arabic. Convert it to EPUB or HTML instead.",
    );
  });
});

describe('line breaking', () => {
  // Every character is 6 points wide at a size of 10, so word spaces are a quarter em (2.5 pt) or 6 pt.
  const mono: Metrics<string> = { width: (text) => Array.from(text).length * 6, size: () => 10 };
  const words = (line: SetLine<string>) => line.boxes.map((box) => box.text).join('');
  const lastEnd = (line: SetLine<string>) => {
    const box = line.boxes.at(-1);
    return box ? box.x + box.width : 0;
  };
  const text =
    'Knuth and Plass break a whole paragraph at once, so that no line is much looser than its neighbours and the ' +
    'last line keeps the natural spacing that every other line only approximates.';

  it('justifies every line to the measure except the last', () => {
    const lines = setText([{ text, style: 'body' }], mono, { width: 250, align: 'justify' });
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines.slice(0, -1)) expect(lastEnd(line)).toBeCloseTo(250, 6);
    const last = lines.at(-1) as SetLine<string>;
    expect(last.scale).toBe(1);
    expect(lastEnd(last)).toBeLessThan(250);
    // The last line's words sit at their natural spacing: one 6 pt space between them.
    last.boxes.slice(1).forEach((box, i) => {
      const before = last.boxes[i] as SetLine<string>['boxes'][number];
      expect(box.x - (before.x + before.width)).toBeCloseTo(6, 6);
    });
  });

  it('keeps every word, in order, with spaces flagged for copying', () => {
    const lines = setText([{ text, style: 'body' }], mono, { width: 250, align: 'justify' });
    const rebuilt = lines.map((line) => line.boxes.map((box) => (box.space ? ' ' : '') + box.text).join('')).join(' ');
    expect(rebuilt).toBe(text);
  });

  it('breaks a word wider than the line between characters', () => {
    const url = `https://example.com/${'x'.repeat(70)}`;
    const lines = setText([{ text: `See ${url} today`, style: 'body' }], mono, { width: 120, align: 'justify' });
    for (const line of lines) expect(lastEnd(line)).toBeLessThanOrEqual(120 + 1e-6);
    expect(lines.map(words).join('').replace('See', '').replace('today', '')).toBe(url);
  });

  it('breaks at soft hyphens and shows the hyphen', () => {
    const lines = setText([{ text: 'an extra­ordinarily long­winded sentence', style: 'body' }], mono, {
      width: 80,
      align: 'left',
    });
    expect(lines.map(words)).toEqual(['anextra-', 'ordinarily', 'longwinded', 'sentence']);
  });

  it('breaks after dashes and at forced line breaks, which are not justified', () => {
    const lines = setText([{ text: 'one two—three four\nfive six', style: 'body' }], mono, {
      width: 70,
      align: 'justify',
    });
    expect(lines.map(words)).toEqual(['onetwo—', 'threefour', 'fivesix']);
    expect(lines[1]?.boxes[1]?.x).toBeCloseTo(36, 6);
  });

  it('indents the turnovers of verse lines too long for the measure', () => {
    const lines = setText([{ text: 'short line\na much longer line that wraps around', style: 'body' }], mono, {
      width: 120,
      align: 'left',
      turnover: 12,
    });
    expect(lines.map(words)).toEqual(['shortline', 'amuchlongerline', 'thatwrapsaround']);
    expect(lines.map((line) => line.boxes[0]?.x)).toEqual([0, 0, 12]);
  });

  it('centres and balances ragged lines', () => {
    const lines = setText([{ text: 'The Strange Case of the Lantern Keeper', style: 'title' }], mono, {
      width: 200,
      align: 'center',
      balance: true,
    });
    expect(lines.map(words)).toEqual(['TheStrangeCaseof', 'theLanternKeeper']);
    for (const line of lines)
      expect(line.boxes[0]?.x).toBeCloseTo((200 - lastEnd(line) + (line.boxes[0]?.x ?? 0)) / 2, 6);
  });

  it('finds breaks over the whole paragraph rather than line by line', () => {
    // Filling each line in turn sets "a bbbbb c" exactly, then strands "ddddd" alone on a line no space can
    // justify. Looking at the paragraph as a whole, two evenly loose lines are better.
    const box = (width: number) => ({ type: 'box' as const, width });
    const glue = { type: 'glue' as const, width: 1, stretch: 1, shrink: 0 };
    const end = { type: 'penalty' as const, width: 0, cost: FORCED, flagged: false };
    const lines = breakLines([box(1), glue, box(5), glue, box(1), glue, box(5), glue, box(5), end], 9);
    expect(lines).toEqual([
      { start: 0, end: 3, ratio: 2, width: 9 },
      { start: 4, end: 7, ratio: 2, width: 9 },
      { start: 8, end: 9, ratio: 0, width: 9 },
    ]);
  });
});
