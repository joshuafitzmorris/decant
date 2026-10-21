import fontkit, { type Font } from '@pdf-lib/fontkit';
import {
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  type PDFImage,
  PDFName,
  type PDFPage,
  type PDFRef,
  StandardFonts,
} from 'pdf-lib';
import { ConversionError } from '../../types';
import type {
  Align,
  Block,
  CaptionBlock,
  HeadingBlock,
  Nesting,
  PrintBook,
  PrintChapter,
  PrintImage,
  Run,
} from './blocks';

export type PageSize = 'a5' | 'a4' | 'letter' | '6x9';

export interface BookFonts {
  regular: Uint8Array;
  italic: Uint8Array;
  bold: Uint8Array;
  boldItalic: Uint8Array;
}

interface PageSpec {
  width: number;
  height: number;
  /** Margins. The foot is deeper than the head, as in printed books, and holds the page number. */
  side: number;
  top: number;
  bottom: number;
  /** Body text size: lines of 60–70 characters. */
  size: number;
}

const PAGES: Record<PageSize, PageSpec> = {
  a5: { width: 419.53, height: 595.28, side: 54, top: 54, bottom: 72, size: 10.5 },
  '6x9': { width: 432, height: 648, side: 54, top: 58, bottom: 76, size: 11 },
  a4: { width: 595.28, height: 841.89, side: 96, top: 84, bottom: 108, size: 12 },
  letter: { width: 612, height: 792, side: 100, top: 80, bottom: 104, size: 12 },
};

/** Baseline to baseline, as a multiple of the type size. */
const LEADING = 1.4;
/** First-line indent of paragraphs that follow another, in ems. */
const INDENT = 1.2;
/** Blockquotes come in this far on both sides, in ems, and are set slightly smaller. */
const QUOTE_INDENT = 1.6;
const QUOTE_SIZE = 0.94;
/** Each list level indents by this much, in ems; markers hang to the left of the text. */
const LIST_INDENT = 1.7;
const SMALL = 0.85;
/** Courier's letters are wide and tall beside Literata's. */
const MONO = 0.86;
/** Body pictures are never enlarged past this many points per pixel. */
const MAX_PICTURE_SCALE = 1.5;
/** The chapter title sits this far down the text block. */
const SINK = 0.2;
/** Lines of space around blocks: [above, below]. */
const SPACE: Record<FlowKind, [number, number]> = {
  text: [0, 0],
  verse: [1, 1],
  item: [0.5, 0.5],
  row: [0.6, 0.6],
  pre: [0.6, 0.6],
  image: [0.8, 0.8],
  caption: [0.8, 0.8],
  heading: [1.5, 0.5],
  break: [0.5, 0.5],
};
/** Lines of space between two blocks of the same kind: list items, table rows, stanzas. */
const BETWEEN: Partial<Record<FlowKind, number>> = { text: 0, verse: 1, item: 0.25, row: 0.25 };
/** Verse lines too long for the page wrap with this much indent, in ems. */
const TURNOVER = 1.5;
/** Lines set apart by <br> that average at most this many characters are verse, not prose. */
const VERSE_LINE = 100;
/** Sizes of headings within chapters, relative to the body, by level. */
const HEADING_SCALE = [1.4, 1.25, 1.12, 1.04, 1, 1];
/** Progress counts characters; a picture counts as this many. */
const PICTURE_WEIGHT = 400;

/**
 * Sets a PrintBook as a printed book: Literata in justified paragraphs broken
 * Knuth–Plass style, chapters opening on new pages, page numbers, a cover, a
 * title page and bookmarks. It has no DOM, so it runs in a worker (and in Node
 * for tests).
 */
export async function typeset(
  print: PrintBook,
  options: { page: PageSize },
  fonts: BookFonts,
  onProgress?: (value: number) => void,
): Promise<Uint8Array> {
  const spec = PAGES[options.page] ?? PAGES.a5;
  const doc = await PDFDocument.create();
  const faces = await embedFaces(doc, fonts);
  checkCoverage(print, faces.regular);
  const pictures = await embedPictures(doc, print);
  const setter = new Typesetter(doc, spec, faces, pictures, print, onProgress);
  if (print.cover) setter.coverPage(print.cover);
  setter.titlePage(print);
  print.chapters.forEach((chapter, i) => {
    setter.chapter(chapter, i);
  });
  setter.finish();
  if (!doc.getPageCount()) doc.addPage([spec.width, spec.height]);

  const bookmarks = print.chapters.flatMap((chapter, i) => {
    const title = chapter.title?.replace(/\s+/g, ' ').trim();
    const page = setter.openings.get(i);
    return title && page ? [{ title, page }] : [];
  });
  addOutline(doc, bookmarks);
  if (print.title) doc.setTitle(print.title, { showInWindowTitleBar: true });
  if (print.authors.length) doc.setAuthor(print.authors.join(', '));
  if (print.language) doc.setLanguage(print.language);
  doc.setCreator('Decant');
  doc.setProducer('Decant');
  const bytes = await doc.save();
  onProgress?.(1);
  return bytes;
}

// ---------------------------------------------------------------------------
// Fonts

interface Shaped {
  /** Advance in thousandths of an em, kerning included. */
  width: number;
  glyphs: number;
  /** TJ operands: glyph codes, with the font's kerning as adjustments between them. */
  tj: string;
}

class Face {
  private readonly shapes = new Map<string, Shaped>();
  private readonly coverage = new Map<number, boolean>();

  constructor(
    /** Resource name on every page. */
    readonly name: string,
    readonly pdf: PDFFont,
    /** Shaping data; the built-in Courier has none and no kerning. */
    private readonly kit: Font | null,
  ) {}

  /** Literata's x-height, used to centre lines in their leading. */
  get xHeight(): number {
    return this.kit ? this.kit.xHeight / this.kit.unitsPerEm : 0.43;
  }

  has(code: number): boolean {
    let known = this.coverage.get(code);
    if (known === undefined) {
      known = this.kit ? this.kit.hasGlyphForCodePoint(code) : this.pdf.getCharacterSet().includes(code);
      this.coverage.set(code, known);
    }
    return known;
  }

  shape(text: string): Shaped {
    let shaped = this.shapes.get(text);
    if (!shaped) {
      shaped = this.kit ? this.kerned(this.kit, text) : this.plain(text);
      this.shapes.set(text, shaped);
    }
    return shaped;
  }

  private plain(text: string): Shaped {
    return {
      width: this.pdf.widthOfTextAtSize(text, 1000),
      glyphs: text.length,
      tj: `<${this.pdf.encodeText(text).asString()}>`,
    };
  }

  /**
   * pdf-lib draws glyphs at their plain advance widths (with ligatures, but no
   * kerning), so the font's kerning goes into the TJ array here.
   */
  private kerned(kit: Font, text: string): Shaped {
    const { glyphs, positions } = kit.layout(text);
    // pdf-lib shapes text the same way, so its codes (four hex digits each) line up with fontkit's glyphs.
    const codes = this.pdf.encodeText(text).asString();
    if (codes.length !== glyphs.length * 4) return { ...this.plain(text), tj: `<${codes}>` };
    const scale = 1000 / kit.unitsPerEm;
    let width = 0;
    let tj = '';
    let run = '';
    glyphs.forEach((glyph, i) => {
      const kern = Math.round(((positions[i]?.xAdvance ?? glyph.advanceWidth) - glyph.advanceWidth) * scale);
      width += glyph.advanceWidth * scale + kern;
      run += codes.slice(i * 4, i * 4 + 4);
      if (kern) {
        // TJ numbers move the pen back, so tightening a pair is a positive number.
        tj += `<${run}> ${-kern} `;
        run = '';
      }
    });
    return { width, glyphs: glyphs.length, tj: run ? `${tj}<${run}>` : tj.trimEnd() };
  }
}

interface Faces {
  regular: Face;
  italic: Face;
  bold: Face;
  boldItalic: Face;
  mono: Face;
}

async function embedFaces(doc: PDFDocument, fonts: BookFonts): Promise<Faces> {
  doc.registerFontkit(fontkit);
  const face = async (name: string, bytes: Uint8Array) =>
    new Face(name, await doc.embedFont(bytes, { subset: true }), fontkit.create(bytes));
  return {
    regular: await face('F1', fonts.regular),
    italic: await face('F2', fonts.italic),
    bold: await face('F3', fonts.bold),
    boldItalic: await face('F4', fonts.boldItalic),
    // Literata has no monospaced cut. Courier is built into every PDF reader, so it costs nothing to use.
    mono: new Face('F5', await doc.embedFont(StandardFonts.Courier), null),
  };
}

/**
 * Characters Literata lacks are left out. That's harmless for the odd emoji,
 * but a book in a script it doesn't cover would come out blank.
 */
function checkCoverage(print: PrintBook, face: Face) {
  let letters = 0;
  let missing = 0;
  for (const chapter of print.chapters) {
    for (const block of chapter.blocks) {
      if (!('runs' in block)) continue;
      for (const run of block.runs) {
        for (const char of run.text) {
          const code = char.codePointAt(0) as number;
          if (code < 0x80) {
            if ((code | 0x20) >= 0x61 && (code | 0x20) <= 0x7a) letters++;
          } else if (/\p{L}/u.test(char)) {
            letters++;
            if (!face.has(code)) missing++;
          }
        }
      }
    }
  }
  if (missing > letters * 0.02) {
    throw new ConversionError(
      'This book uses characters the PDF font can’t show, such as Chinese or Arabic. Convert it to EPUB or HTML instead.',
      'unsupported-script',
    );
  }
}

interface Picture {
  pdf: PDFImage;
  /** Resource name on the pages that show it. */
  name: string;
  width: number;
  height: number;
}

/** Each distinct picture is embedded once, however often it appears. */
async function embedPictures(doc: PDFDocument, print: PrintBook): Promise<Map<PrintImage, Picture>> {
  const images = new Set<PrintImage>(print.cover ? [print.cover] : []);
  for (const chapter of print.chapters) {
    for (const block of chapter.blocks) if (block.kind === 'image') images.add(block.image);
  }
  const pictures = new Map<PrintImage, Picture>();
  for (const image of images) {
    try {
      const pdf = image.type === 'jpg' ? await doc.embedJpg(image.data) : await doc.embedPng(image.data);
      const name = `Im${pictures.size + 1}`;
      pictures.set(image, { pdf, name, width: image.width || pdf.width, height: image.height || pdf.height });
    } catch {
      // A damaged picture is left out rather than failing the whole book.
    }
  }
  return pictures;
}

// ---------------------------------------------------------------------------
// Line breaking. Pure functions: the typesetter measures with Literata, tests with anything.

export interface TextPiece<S> {
  text: string;
  style: S;
}

export interface Metrics<S> {
  /** Advance width of text in a style, in points. */
  width(text: string, style: S): number;
  /** The style's type size, which scales how much word spaces may stretch. */
  size(style: S): number;
}

export interface SetOptions {
  width: number;
  align: Align;
  /** First-line indent, in points. */
  indent?: number;
  /** Evens out the lines of a centred heading instead of filling the first ones. */
  balance?: boolean;
  /** Indent of turnovers: lines that continue one too long for the measure, rather than follow a forced break. */
  turnover?: number;
}

export interface SetBox<S> {
  text: string;
  style: S;
  /** From the start of the line. */
  x: number;
  width: number;
  /** Whether a word space comes before it on this line. */
  space: boolean;
}

export interface SetLine<S> {
  boxes: SetBox<S>[];
  /** Where the last box ends: the full width on justified lines. */
  end: number;
  /** Horizontal scale of the glyphs: justified lines widen or narrow them very slightly. */
  scale: number;
  /** It continues a verse line too long for the measure, so a page shouldn't end before it. */
  turnover: boolean;
}

/** Boxes may stretch and shrink too, when glyphs can be scaled. */
export type BreakItem =
  | { type: 'box'; width: number; stretch?: number; shrink?: number }
  | { type: 'glue'; width: number; stretch: number; shrink: number }
  | { type: 'penalty'; width: number; cost: number; flagged: boolean };

export interface BrokenLine {
  /** The line holds items[start] up to items[end], where it breaks. */
  start: number;
  end: number;
  /** How far its glue stretches (as a fraction of its stretch) or, when negative, shrinks. */
  ratio: number;
  /** Its measure: the full width, or less for a turnover. */
  width: number;
}

type TextItem<S> =
  | { type: 'box'; width: number; text: string; style: S | null; stretch?: number; shrink?: number }
  | { type: 'glue'; width: number; stretch: number; shrink: number }
  | { type: 'penalty'; width: number; cost: number; flagged: boolean; hyphen: S | null };

/** A penalty at or below FORCED must break; one at or above NEVER can't. */
export const FORCED = -10000;
const NEVER = 10000;
/**
 * Word spaces are at least a quarter of an em, the book standard (Literata's
 * own is a screen-tight 0.2 em). They may stretch this much at ratio 1 and
 * shrink this much at -1, in ems.
 */
const WORD_SPACE = 0.25;
const STRETCH = 0.16;
const SHRINK = 0.06;
/** Justified lines stop stretching here and end short, rather than open rivers of space. */
const MAX_STRETCH = 3;
/**
 * Glyphs on justified lines may be widened or narrowed this much (pdfTeX's
 * font expansion), so the slack of a line without hyphenation isn't all
 * dumped into its word spaces. Two percent doesn't show.
 */
const EXPAND = 0.02;
const CONDENSE = 0.015;
/** Stretch at the end of a ragged line, in ems. */
const RAG = 3;
const HYPHEN_COST = 50;
const SLASH_COST = 100;
/** Breaking inside a word too long for any line. */
const EMERGENCY_COST = 1000;
const LINE_PENALTY = 10;
const FLAGGED_DEMERITS = 3000;
const FITNESS_DEMERITS = 3000;
const MAX_BADNESS = 1e6;
const OVERFULL_DEMERITS = 1e14;
const TOKENS = / +|\n|\u00ad|\u200b|[^ \n\u00ad\u200b]+/g;
const GRAPHEMES = /\P{M}\p{M}*|\p{M}+/gu;

/** Breaks styled text into lines of a given width and places every word on them. */
export function setText<S>(pieces: readonly TextPiece<S>[], metrics: Metrics<S>, options: SetOptions): SetLine<S>[] {
  const box = boxMaker(metrics, options.align === 'justify');
  const items = splitOverwide(textItems(pieces, metrics, options), options.width, box);
  let lines = breakLines(items, options.width, options.turnover);
  if (options.balance && lines.length > 1) lines = balance(items, options.width, lines.length) ?? lines;
  return lines.map((line) => placeLine(items, line, options));
}

/** Words become boxes, spaces glue, and soft hyphens, dashes and line breaks penalties. */
function textItems<S>(pieces: readonly TextPiece<S>[], metrics: Metrics<S>, options: SetOptions): TextItem<S>[] {
  const items: TextItem<S>[] = [];
  const forced: TextItem<S> = { type: 'penalty', width: 0, cost: FORCED, flagged: false, hyphen: null };
  const ragged = options.align !== 'justify';
  const box = boxMaker(metrics, !ragged);
  if (options.indent) items.push({ type: 'box', width: options.indent, text: '', style: null });
  // A space is only set once the next word arrives, so runs of spaces collapse and none ends a line.
  let space: S | null = null;
  let lineStart = true;
  for (const { text, style } of pieces) {
    for (const token of text.match(TOKENS) ?? []) {
      if (token.startsWith(' ')) {
        if (!lineStart) space ??= style;
        continue;
      }
      if (token === '\n') {
        items.push(forced);
        space = null;
        lineStart = true;
        continue;
      }
      if (space !== null) items.push(...wordSpace(space, metrics, ragged));
      space = null;
      if (token === '\u00ad') {
        items.push({
          type: 'penalty',
          width: metrics.width('-', style),
          cost: HYPHEN_COST,
          flagged: true,
          hyphen: style,
        });
      } else if (token === '\u200b') {
        items.push({ type: 'penalty', width: 0, cost: 0, flagged: false, hyphen: null });
      } else {
        wordItems(items, token, style, box);
        lineStart = false;
      }
    }
  }
  items.push(forced);
  return items;
}

function wordSpace<S>(style: S, metrics: Metrics<S>, ragged: boolean): TextItem<S>[] {
  const size = metrics.size(style);
  const width = Math.max(metrics.width(' ', style), WORD_SPACE * size);
  if (!ragged) return [{ type: 'glue', width, stretch: STRETCH * size, shrink: SHRINK * size }];
  // Ragged text keeps its spaces natural; the stretch only counts where a line ends (Knuth and Plass's ragged setting).
  return [
    { type: 'glue', width: 0, stretch: RAG * size, shrink: 0 },
    { type: 'penalty', width: 0, cost: 0, flagged: false, hyphen: null },
    { type: 'glue', width, stretch: -RAG * size, shrink: 0 },
  ];
}

type BoxMaker<S> = (text: string, style: S) => TextItem<S>;

function boxMaker<S>(metrics: Metrics<S>, elastic: boolean): BoxMaker<S> {
  return (text, style) => {
    const width = metrics.width(text, style);
    return elastic
      ? { type: 'box', width, text, style, stretch: width * EXPAND, shrink: width * CONDENSE }
      : { type: 'box', width, text, style };
  };
}

/** A word, with places it may break: after hyphens and dashes, and slashes between words. */
function wordItems<S>(items: TextItem<S>[], word: string, style: S, box: BoxMaker<S>) {
  if (!/[-\u2010–—/]/.test(word)) {
    items.push(box(word, style));
    return;
  }
  const chars = Array.from(word);
  let start = 0;
  for (let i = 1; i < chars.length - 1; i++) {
    const cost = breakAfter(chars[i - 1] as string, chars[i] as string, chars[i + 1] as string);
    if (cost === null) continue;
    items.push(box(chars.slice(start, i + 1).join(''), style), {
      type: 'penalty',
      width: 0,
      cost,
      flagged: cost === HYPHEN_COST,
      hyphen: null,
    });
    start = i + 1;
  }
  items.push(box(chars.slice(start).join(''), style));
}

function breakAfter(before: string, char: string, after: string): number | null {
  const letter = (c: string) => /\p{L}/u.test(c);
  if (char === '-' || char === '\u2010') return /[\p{L}\p{N}]/u.test(before) && letter(after) ? HYPHEN_COST : null;
  if (char === '–' || char === '—') return /[\p{L}\p{N}“‘"'(]/u.test(after) ? HYPHEN_COST : null;
  if (char === '/') return letter(before) && letter(after) ? SLASH_COST : null;
  return null;
}

/** A word wider than the line (a long URL, say) may break between any two characters, as a last resort. */
function splitOverwide<S>(items: TextItem<S>[], width: number, box: BoxMaker<S>): TextItem<S>[] {
  const out: TextItem<S>[] = [];
  for (let i = 0; i < items.length; ) {
    let j = i;
    let chunk = 0;
    for (let item = items[j]; item?.type === 'box'; item = items[++j]) chunk += item.width;
    if (j === i) {
      out.push(items[i++] as TextItem<S>);
      continue;
    }
    for (let k = i; k < j; k++) {
      const word = items[k] as Extract<TextItem<S>, { type: 'box' }>;
      if (chunk <= width || word.style === null) {
        out.push(word);
        continue;
      }
      for (const text of word.text.match(GRAPHEMES) ?? []) {
        const last = out.at(-1);
        if (last?.type === 'box' && last.style !== null) {
          out.push({ type: 'penalty', width: 0, cost: EMERGENCY_COST, flagged: false, hyphen: null });
        }
        out.push(box(text, word.style));
      }
    }
    i = j;
  }
  return out;
}

/**
 * Knuth and Plass's total-fit line breaking. Of all the ways to break a
 * paragraph, it picks the one whose lines are, taken together, closest to
 * their natural spacing, instead of filling each line greedily and leaving
 * the slack wherever it falls. Without hyphenation some lines must be loose,
 * so looseness is costed rather than ruled out. Items end with a forced break.
 */
export function breakLines(items: readonly BreakItem[], width: number, turnover = 0): BrokenLine[] {
  const count = items.length;
  const widths = [0];
  const stretches = [0];
  const shrinks = [0];
  for (const item of items) {
    widths.push((widths.at(-1) as number) + (item.type === 'penalty' ? 0 : item.width));
    stretches.push((stretches.at(-1) as number) + (item.type === 'penalty' ? 0 : (item.stretch ?? 0)));
    shrinks.push((shrinks.at(-1) as number) + (item.type === 'penalty' ? 0 : (item.shrink ?? 0)));
  }
  const total = (sums: number[], from: number, to: number) => (sums[to] as number) - (sums[from] as number);
  // A line starts at the first box after a break: the glue and penalties there are discarded.
  const forcedAt = (position: number) => {
    const item = items[position];
    return item?.type === 'penalty' && item.cost <= FORCED;
  };
  const startAfter = (position: number) => {
    let i = position + 1;
    for (let item = items[i]; item && item.type !== 'box' && !forcedAt(i); ) item = items[++i];
    return i;
  };
  // Only a line that starts the paragraph or follows a forced break gets the full measure.
  const measure = (position: number) => (position < 0 || forcedAt(position) ? width : width - turnover);

  interface Node {
    position: number;
    start: number;
    line: number;
    fitness: number;
    demerits: number;
    ratio: number;
    previous: Node | null;
  }
  let active: Node[] = [{ position: -1, start: 0, line: 0, fitness: 1, demerits: 0, ratio: 0, previous: null }];

  for (let b = 0; b < count; b++) {
    const item = items[b] as BreakItem;
    if (item.type === 'penalty' ? item.cost >= NEVER : item.type !== 'glue' || items[b - 1]?.type !== 'box') continue;
    const penalty = item.type === 'penalty' ? item : null;
    const forced = penalty !== null && penalty.cost <= FORCED;
    const best: (Node | undefined)[] = [];
    const survivors: Node[] = [];
    let dropped: { node: Node; ratio: number } | undefined;
    for (const node of active) {
      // Back-to-back break points (as in ragged text) would make an empty line.
      if (node.start > b) {
        survivors.push(node);
        continue;
      }
      const length = total(widths, node.start, b) + (penalty?.width ?? 0);
      const available = measure(node.position);
      const ratio = adjustment(
        length,
        available,
        total(stretches, node.start, b),
        total(shrinks, node.start, b),
        forced,
      );
      // A node whose line is already overfull here can only get worse further on.
      if (ratio < -1 || forced) {
        if (!dropped || node.position > dropped.node.position) dropped = { node, ratio };
      } else survivors.push(node);
      if (ratio < -1) continue;
      const fitness = fitnessOf(ratio);
      const previousItem = items[node.position];
      let demerits = node.demerits + lineDemerits(ratio, penalty?.cost ?? 0);
      if (penalty?.flagged && previousItem?.type === 'penalty' && previousItem.flagged) demerits += FLAGGED_DEMERITS;
      if (Math.abs(fitness - node.fitness) > 1) demerits += FITNESS_DEMERITS;
      const current = best[fitness];
      if (!current || demerits < current.demerits) {
        best[fitness] = {
          position: b,
          start: startAfter(b),
          line: node.line + 1,
          fitness,
          demerits,
          ratio,
          previous: node,
        };
      }
    }
    active = survivors;
    for (const node of best) if (node) active.push(node);
    if (!active.length && dropped) {
      // Nothing fits, so take the least overfull line rather than fail.
      const { node, ratio } = dropped;
      active.push({
        position: b,
        start: startAfter(b),
        line: node.line + 1,
        fitness: 0,
        demerits: node.demerits + OVERFULL_DEMERITS,
        ratio,
        previous: node,
      });
    }
  }

  let last: Node | undefined;
  for (const node of active) if (!last || node.demerits < last.demerits) last = node;
  const lines: BrokenLine[] = [];
  for (let node = last; node?.previous; node = node.previous) {
    lines.push({
      start: node.previous.start,
      end: node.position,
      ratio: node.ratio,
      width: measure(node.previous.position),
    });
  }
  return lines.reverse();
}

function adjustment(length: number, width: number, stretch: number, shrink: number, forced: boolean): number {
  if (length < width) {
    // The last line of a paragraph, or one ended by <br>, keeps its natural spacing.
    if (forced) return 0;
    return stretch > 0 ? (width - length) / stretch : Number.POSITIVE_INFINITY;
  }
  if (length > width) return shrink > 0 ? (width - length) / shrink : Number.NEGATIVE_INFINITY;
  return 0;
}

function lineDemerits(ratio: number, cost: number): number {
  const badness = Number.isFinite(ratio) ? Math.min(MAX_BADNESS, 100 * Math.abs(ratio) ** 3) : MAX_BADNESS;
  const demerits = (LINE_PENALTY + badness) ** 2;
  if (cost > 0) return demerits + cost * cost;
  if (cost > FORCED) return demerits - cost * cost;
  return demerits;
}

/** Tight, decent, loose or very loose: neighbouring lines more than one class apart cost extra. */
function fitnessOf(ratio: number): number {
  if (ratio < -0.5) return 0;
  if (ratio <= 0.5) return 1;
  if (ratio <= 1) return 2;
  return 3;
}

/** Breaks at the narrowest measure that needs no more lines, found by bisection, to set at the full one. */
function balance<S>(items: TextItem<S>[], width: number, count: number): BrokenLine[] | null {
  let low = 0;
  let high = width;
  let best: BrokenLine[] | null = null;
  for (let step = 0; step < 10; step++) {
    const mid = (low + high) / 2;
    const lines = breakLines(items, mid);
    if (lines.length <= count && lines.every((line) => line.ratio >= -1)) {
      best = lines;
      high = mid;
    } else low = mid;
  }
  return best?.map((line) => ({ ...line, width })) ?? null;
}

function placeLine<S>(items: readonly TextItem<S>[], line: BrokenLine, options: SetOptions): SetLine<S> {
  const breakItem = items[line.end];
  const hyphen = breakItem?.type === 'penalty' ? breakItem.hyphen : null;
  const hyphenWidth = hyphen !== null && breakItem ? breakItem.width : 0;
  const { scale, ratio } = justification(items, line, options, hyphenWidth);
  const boxes: SetBox<S>[] = [];
  let x = 0;
  let end = 0;
  let space = false;
  for (let i = line.start; i < line.end; i++) {
    const item = items[i] as TextItem<S>;
    if (item.type === 'box') {
      const width = item.style === null ? item.width : item.width * scale;
      if (item.style !== null) boxes.push({ text: item.text, style: item.style, x, width, space });
      x += width;
      end = x;
      space = false;
    } else if (item.type === 'glue') {
      x += item.width + (ratio < 0 ? ratio * item.shrink : ratio * item.stretch);
      space ||= item.width > 0;
    }
  }
  if (hyphen !== null) {
    boxes.push({ text: '-', style: hyphen, x, width: hyphenWidth * scale, space: false });
    end = x + hyphenWidth * scale;
  }
  const indent = options.width - line.width;
  const offset =
    indent + (options.align === 'center' ? (line.width - end) / 2 : options.align === 'right' ? line.width - end : 0);
  if (offset) for (const box of boxes) box.x += offset;
  return { boxes, end: end + offset, scale, turnover: indent > 0 };
}

/**
 * How a justified line meets the measure: its glyphs scale first, as far as
 * the line's ratio asks and their limit allows, and the word spaces take the
 * rest. The last line of a paragraph keeps its natural spacing.
 */
function justification<S>(
  items: readonly TextItem<S>[],
  line: BrokenLine,
  options: SetOptions,
  hyphenWidth: number,
): { scale: number; ratio: number } {
  const breakItem = items[line.end];
  const last = breakItem?.type === 'penalty' && breakItem.cost <= FORCED;
  if (options.align !== 'justify' || (last && line.ratio >= 0)) return { scale: 1, ratio: 0 };
  let natural = hyphenWidth;
  let glyphs = hyphenWidth;
  let stretch = 0;
  let shrink = 0;
  for (let i = line.start; i < line.end; i++) {
    const item = items[i] as TextItem<S>;
    if (item.type === 'penalty') continue;
    natural += item.width;
    if (item.type === 'box' && item.style !== null) glyphs += item.width;
    if (item.type === 'glue') {
      stretch += item.stretch;
      shrink += item.shrink;
    }
  }
  const scale = line.ratio < 0 ? 1 + Math.max(line.ratio, -1) * CONDENSE : 1 + Math.min(line.ratio, 1) * EXPAND;
  const left = line.width - natural - glyphs * (scale - 1);
  if (left >= 0) return { scale, ratio: stretch > 0 ? Math.min(left / stretch, MAX_STRETCH) : 0 };
  return { scale, ratio: shrink > 0 ? Math.max(left / shrink, -1) : 0 };
}

/**
 * Preformatted text keeps every space. A line too long for the page wraps
 * after its last space that fits, or mid-word when it has none.
 */
export function setPreformatted<S>(pieces: readonly TextPiece<S>[], metrics: Metrics<S>, width: number): SetLine<S>[] {
  const lines: SetLine<S>[] = [];
  let chars: { text: string; style: S; width: number }[] = [];
  let x = 0;
  let column = 0;
  const endLine = (count: number) => {
    lines.push(preformattedLine(chars.slice(0, count), metrics));
    chars = chars.slice(count);
    x = chars.reduce((sum, char) => sum + char.width, 0);
  };
  for (const { text, style } of pieces) {
    for (const char of text) {
      if (char === '\n') {
        endLine(chars.length);
        column = 0;
        continue;
      }
      // Tab stops every four columns.
      const chunk = char === '\t' ? ' '.repeat(4 - (column % 4)) : char;
      column += chunk.length;
      const advance = metrics.width(chunk, style);
      while (chars.length && x + advance > width) endLine(wrapAt(chars));
      chars.push({ text: chunk, style, width: advance });
      x += advance;
    }
  }
  endLine(chars.length);
  return lines;
}

/** How many characters stay on a full line: up to its last space after the indentation, or all of them. */
function wrapAt(chars: { text: string }[]): number {
  const indent = chars.findIndex((char) => char.text !== ' ');
  for (let i = chars.length - 1; indent >= 0 && i > indent; i--) if (chars[i]?.text === ' ') return i + 1;
  return chars.length;
}

function preformattedLine<S>(chars: { text: string; style: S; width: number }[], metrics: Metrics<S>): SetLine<S> {
  const boxes: SetBox<S>[] = [];
  let x = 0;
  for (const { text, style, width } of chars) {
    const last = boxes.at(-1);
    if (last && last.style === style) last.text += text;
    else boxes.push({ text, style, x, width: 0, space: false });
    x += width;
  }
  for (const box of boxes) box.width = metrics.width(box.text, box.style);
  return { boxes, end: x, scale: 1, turnover: false };
}

// ---------------------------------------------------------------------------
// Pages

interface Style {
  face: Face;
  size: number;
  /** Baseline shift: up for superscripts, down for subscripts. */
  rise: number;
  /** Extra space after every character, in points: spaced capitals. */
  tracking: number;
}

const metrics: Metrics<Style> = {
  width: (text, style) => advance(style.face.shape(text), style),
  size: (style) => style.size,
};

function advance(shaped: Shaped, style: Style): number {
  return (shaped.width * style.size) / 1000 + style.tracking * shaped.glyphs;
}

type FlowKind = 'text' | 'verse' | 'item' | 'row' | 'pre' | 'image' | 'caption' | 'heading' | 'break';

/** What the last block was, which decides the space and indent of the next. */
interface Flow {
  kind: FlowKind;
  quote: number;
  /** Space it wants below, in points. */
  after: number;
  /** A justified or flush-left paragraph, so one after it is indented. */
  indentable: boolean;
}

/** One unbreakable strip of a page: a line of text, a picture. */
interface Piece {
  height: number;
  /** Space above it, dropped at the top of a page unless sticky. */
  space: number;
  sticky?: boolean;
  /** Whether a page may end just before it. */
  breakBefore: 'allow' | 'avoid' | 'force';
  draw?: (canvas: Canvas, top: number) => void;
  /** Opens chapter n: its page gets no number and the chapter's bookmark. */
  chapter?: number;
  /** Progress made once it is on a page. */
  weight?: number;
}

/** A block set and ready to place. */
interface Laid {
  pieces: Piece[];
  flow: Flow;
  /** Space it wants above, in points. */
  before: number;
  keepWithNext?: boolean;
}

/**
 * Fills pages one piece at a time. When a piece doesn't fit, the page ends at
 * the last place it may break, carrying what follows to the next page: that
 * keeps headings with their text and avoids single lines at a page's head or foot.
 */
class Paginator {
  private pieces: Piece[] = [];
  private used = 0;

  constructor(
    private readonly height: number,
    private readonly onPage: (pieces: Piece[]) => void,
  ) {}

  add(piece: Piece) {
    if (piece.breakBefore === 'force' && this.pieces.length) this.endPage(this.pieces.length);
    while (this.pieces.length && this.used + this.gap(piece) + piece.height > this.height + 0.01) {
      let at = piece.breakBefore === 'allow' ? this.pieces.length : this.lastBreak();
      // Nowhere is allowed (a heading and its text filling a page), so break here anyway.
      if (at === 0) at = this.pieces.length;
      this.endPage(at);
    }
    this.used += this.gap(piece) + piece.height;
    this.pieces.push(piece);
  }

  finish() {
    if (this.pieces.length) this.endPage(this.pieces.length);
  }

  private gap(piece: Piece): number {
    return this.pieces.length || piece.sticky ? piece.space : 0;
  }

  private lastBreak(): number {
    for (let i = this.pieces.length - 1; i > 0; i--) if (this.pieces[i]?.breakBefore === 'allow') return i;
    return 0;
  }

  private endPage(at: number) {
    const page = this.pieces.slice(0, at);
    const carried = this.pieces.slice(at);
    this.pieces = [];
    this.used = 0;
    this.onPage(page);
    for (const piece of carried) this.add(piece);
  }
}

class Typesetter {
  /** The page each chapter opens on. */
  readonly openings = new Map<number, PDFPage>();
  private readonly size: number;
  private readonly lead: number;
  private readonly measure: number;
  private readonly textHeight: number;
  private readonly pages: Paginator;
  private readonly styles = new Map<string, Style>();
  private readonly totalWeight: number;
  private weight = 0;
  private flow: Flow | null = null;
  /** Space owed to the next block by blank lines in the source. */
  private extra = 0;
  private keep = false;
  private force = false;
  private chapterIndex: number | undefined;
  private captionHeight = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly page: PageSpec,
    private readonly faces: Faces,
    private readonly pictures: Map<PrintImage, Picture>,
    print: PrintBook,
    private readonly onProgress?: (value: number) => void,
  ) {
    this.size = page.size;
    this.lead = page.size * LEADING;
    this.measure = page.width - page.side * 2;
    this.textHeight = page.height - page.top - page.bottom;
    this.pages = new Paginator(this.textHeight, (pieces) => this.render(pieces));
    this.totalWeight = print.chapters.reduce(
      (sum, chapter) => sum + chapter.blocks.reduce((n, b) => n + weightOf(b), 0),
      0,
    );
  }

  /**
   * A cover close to the page's proportions (most are 2:3) gets a page of its
   * own shape, as tall as the others, so it fills it edge to edge with nothing
   * cropped. Any other cover is shown whole, centred on a standard page.
   */
  coverPage(image: PrintImage) {
    const picture = this.pictures.get(image);
    if (!picture) return;
    const { width, height } = this.page;
    const shape = picture.width / picture.height;
    const canvas = new Canvas();
    if (Math.abs(shape / (width / height) - 1) <= 0.12) {
      canvas.picture(picture, 0, 0, height * shape, height);
      this.write(canvas, height * shape);
      return;
    }
    const scale = Math.min(width / picture.width, height / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    canvas.picture(picture, (width - w) / 2, (height - h) / 2, w, h);
    this.write(canvas);
  }

  /** The title a third of the way down, the authors below in spaced capitals. */
  titlePage(print: PrintBook) {
    const title = print.title.trim();
    const byline = print.authors.join(', ').trim();
    if (!title && !byline) return;
    const canvas = new Canvas();
    let top = this.page.height - this.page.top - this.textHeight * 0.22;
    if (title) {
      const size = this.size * 2.3;
      top = this.setLines(canvas, this.pieces([{ text: title }], { size }), size, size * 1.2, top);
      top -= this.lead * 1.5;
    }
    if (byline) {
      let caps: string;
      try {
        caps = byline.toLocaleUpperCase(print.language || undefined);
      } catch {
        caps = byline.toUpperCase();
      }
      const size = this.size * 1.05;
      // Spaced capitals, kept under the 0.1 em gap at which PDF readers start inferring word spaces.
      this.setLines(canvas, this.pieces([{ text: caps }], { size, tracking: size * 0.08 }), size, this.lead * 1.2, top);
    }
    this.write(canvas);
  }

  chapter(chapter: PrintChapter, index: number) {
    this.chapterIndex = index;
    this.flow = null;
    this.extra = 0;
    this.keep = false;
    // Headings before any text are the chapter's title (and subtitle), set as its opening.
    let opening = 0;
    const blocks = chapter.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as Block;
      if (block.kind === 'heading' && opening >= 0) {
        this.emit(this.openingHeading(block, opening++ === 0), weightOf(block));
        continue;
      }
      opening = -1;
      switch (block.kind) {
        case 'heading':
          this.emit(this.heading(block), weightOf(block));
          break;
        case 'paragraph':
        case 'item':
          this.emit(this.paragraph(block), weightOf(block));
          break;
        case 'pre':
          this.emit(this.preformatted(block), weightOf(block));
          break;
        case 'image': {
          const next = blocks[i + 1];
          const caption = next?.kind === 'caption' ? this.caption(next) : null;
          const above = this.lastKind() === 'caption' ? this.captionHeight : 0;
          const reserve = caption ? height(caption) + this.lead * 0.4 : above;
          const laid = this.picture(block.image, block, reserve);
          if (laid) {
            laid.keepWithNext = caption !== null;
            this.emit(laid, PICTURE_WEIGHT);
          }
          if (caption && next) {
            this.emit(caption, weightOf(next));
            i++;
          }
          break;
        }
        case 'caption': {
          const laid = this.caption(block);
          laid.keepWithNext = blocks[i + 1]?.kind === 'image';
          this.captionHeight = height(laid) + this.lead * 0.4;
          this.emit(laid, weightOf(block));
          break;
        }
        case 'break':
          if (!block.blank) this.emit(this.ornament(), 0);
          // A blank line after a heading or another break is only spacing in the source.
          else if (this.lastKind() !== 'heading' && this.lastKind() !== 'break' && this.lastKind() !== undefined) {
            this.extra = this.lead;
            this.flow = null;
          }
          break;
        case 'page-break':
          this.force = true;
          this.flow = null;
          break;
      }
    }
  }

  finish() {
    this.pages.finish();
  }

  /** Read through a method: the chapter loop changes the flow by calling methods, which TypeScript can't see. */
  private lastKind(): FlowKind | undefined {
    return this.flow?.kind;
  }

  // Blocks

  private openingHeading(block: HeadingBlock, first: boolean): Laid {
    const size = this.size * (first ? 1.75 : 1.2);
    const align = block.align === 'left' || block.align === 'right' ? block.align : 'center';
    const lines = setText(this.pieces(block.runs, { size, italic: !first }), metrics, {
      width: this.measure,
      align,
      balance: align === 'center',
    });
    const pieces = this.linePieces(lines, this.page.side, size * 1.3, size);
    for (const piece of pieces.slice(1)) piece.breakBefore = 'avoid';
    const [firstPiece] = pieces;
    if (firstPiece && first) firstPiece.sticky = true;
    return {
      pieces,
      flow: { kind: 'heading', quote: 0, after: this.lead * 2.5, indentable: false },
      before: first ? this.textHeight * SINK : this.lead * 0.6,
      keepWithNext: true,
    };
  }

  private heading(block: HeadingBlock): Laid {
    const size = this.size * (HEADING_SCALE[block.level - 1] ?? 1);
    const align = !block.align || block.align === 'justify' ? 'left' : block.align;
    const lines = setText(this.pieces(block.runs, { size, bold: true, italic: block.level >= 5 }), metrics, {
      width: this.measure,
      align,
      balance: align === 'center',
    });
    const pieces = this.linePieces(lines, this.page.side, size * 1.25, size);
    for (const piece of pieces.slice(1)) piece.breakBefore = 'avoid';
    const [above, below] = SPACE.heading;
    return {
      pieces,
      flow: { kind: 'heading', quote: 0, after: this.lead * below, indentable: false },
      before: this.lead * (block.level <= 2 ? above : above * 0.8),
      keepWithNext: true,
    };
  }

  private paragraph(block: Extract<Block, { kind: 'paragraph' | 'item' }>): Laid {
    const row = block.kind === 'paragraph' && block.row === true;
    const verse = block.kind === 'paragraph' && !row && isVerse(block.runs);
    const kind: FlowKind = row ? 'row' : verse ? 'verse' : block.kind === 'item' || block.list > 0 ? 'item' : 'text';
    const { left, width } = this.indented(block);
    const size = block.quote ? this.size * QUOTE_SIZE : this.size;
    const leading = block.quote ? this.lead * QUOTE_SIZE : this.lead;
    const align =
      verse && (!block.align || block.align === 'justify') ? 'left' : (block.align ?? (row ? 'left' : 'justify'));
    const indentable = kind === 'text' && (align === 'justify' || align === 'left');
    const previous = this.flow;
    const indent = indentable && previous?.indentable && previous.quote === block.quote ? size * INDENT : 0;
    const turnover = verse && align === 'left' ? size * TURNOVER : 0;
    const lines = setText(this.pieces(block.runs, { size }), metrics, { width, align, indent, turnover });
    const x = this.page.side + left;
    const pieces = this.linePieces(lines, x, leading, size);
    const [first] = pieces;
    if (block.kind === 'item' && first) {
      const style = this.style(this.faces.regular, size);
      const marker = block.marker;
      const markerWidth = metrics.width(marker, style);
      const draw = first.draw;
      const baseline = this.baseline(leading, size);
      first.draw = (canvas, top) => {
        draw?.(canvas, top);
        // The marker hangs in the indent, right-aligned so the dots of "9." and "10." line up.
        canvas.text(
          [{ text: marker, style, x: 0, width: markerWidth, space: false }],
          x - size * 0.5 - markerWidth,
          top - baseline,
        );
      };
    }
    return { pieces, flow: this.flowOf(kind, block.quote, indentable), before: this.lead * SPACE[kind][0] };
  }

  private preformatted(block: Extract<Block, { kind: 'pre' }>): Laid {
    const { left, width } = this.indented(block);
    const size = this.size * 0.92;
    const lines = setPreformatted(this.pieces(block.runs, { size }, true), metrics, width);
    const pieces = this.linePieces(lines, this.page.side + left, size * MONO * 1.4, size * MONO);
    return { pieces, flow: this.flowOf('pre', block.quote, false), before: this.lead * SPACE.pre[0] };
  }

  private picture(image: PrintImage, nesting: Nesting, reserve: number): Laid | null {
    const picture = this.pictures.get(image);
    if (!picture) return null;
    const { left, width } = this.indented(nesting);
    // Fit the text block, leaving room for a caption, and never enlarge a small picture too far.
    const scale = Math.min(
      width / picture.width,
      Math.max(this.textHeight * 0.5, this.textHeight - reserve) / picture.height,
      MAX_PICTURE_SCALE,
    );
    const w = picture.width * scale;
    const h = picture.height * scale;
    const x = this.page.side + left + (width - w) / 2;
    const piece: Piece = {
      height: h,
      space: 0,
      breakBefore: 'allow',
      draw: (canvas, top) => canvas.picture(picture, x, top - h, w, h),
    };
    return { pieces: [piece], flow: this.flowOf('image', nesting.quote, false), before: this.lead * SPACE.image[0] };
  }

  private caption(block: CaptionBlock): Laid {
    const { left, width } = this.indented(block);
    const size = this.size * 0.9;
    const align = block.align ?? 'center';
    const lines = setText(this.pieces(block.runs, { size, italic: true }), metrics, {
      width,
      align,
      balance: align === 'center',
    });
    const pieces = this.linePieces(lines, this.page.side + left, size * 1.35, size);
    return { pieces, flow: this.flowOf('caption', block.quote, false), before: this.lead * SPACE.caption[0] };
  }

  /** A scene break: an asterism centred in a line of its own. */
  private ornament(): Laid {
    const style = this.style(this.faces.regular, this.size * 1.15);
    const text = '⁂';
    const width = metrics.width(text, style);
    const x = this.page.side + (this.measure - width) / 2;
    const baseline = this.baseline(this.lead, this.size);
    const piece: Piece = {
      height: this.lead,
      space: 0,
      breakBefore: 'allow',
      draw: (canvas, top) => canvas.text([{ text, style, x: 0, width, space: false }], x, top - baseline),
    };
    return {
      pieces: [piece],
      flow: this.flowOf('break', 0, false),
      before: this.lead * SPACE.break[0],
      keepWithNext: true,
    };
  }

  // Placing

  private emit(laid: Laid, weight: number) {
    const first = laid.pieces[0];
    const last = laid.pieces.at(-1);
    if (!first || !last) return;
    first.space = this.spaceBefore(laid);
    if (this.chapterIndex !== undefined) {
      first.chapter = this.chapterIndex;
      first.breakBefore = 'force';
      this.chapterIndex = undefined;
    } else if (this.force) first.breakBefore = 'force';
    else if (this.keep) first.breakBefore = 'avoid';
    last.weight = weight;
    for (const piece of laid.pieces) this.pages.add(piece);
    this.flow = laid.flow;
    this.extra = 0;
    this.keep = laid.keepWithNext === true;
    this.force = false;
  }

  private spaceBefore(laid: Laid): number {
    const previous = this.flow;
    const next = laid.flow;
    if (!previous) return Math.max(laid.before, this.extra);
    let space: number;
    const between = BETWEEN[next.kind];
    if (previous.kind === next.kind && previous.quote === next.quote && between !== undefined)
      space = this.lead * between;
    else if (previous.kind === 'heading' && next.kind === 'heading') space = laid.before;
    else if (
      (previous.kind === 'image' && next.kind === 'caption') ||
      (previous.kind === 'caption' && next.kind === 'image')
    ) {
      space = this.lead * 0.4;
    } else space = Math.max(previous.after, laid.before);
    if (previous.quote !== next.quote) space = Math.max(space, this.lead * 0.6);
    return Math.max(space, this.extra);
  }

  private flowOf(kind: FlowKind, quote: number, indentable: boolean): Flow {
    return { kind, quote, after: this.lead * SPACE[kind][1], indentable };
  }

  private linePieces(lines: SetLine<Style>[], x: number, leading: number, size: number): Piece[] {
    const baseline = this.baseline(leading, size);
    const last = lines.length - 1;
    return lines.map((line, i) => ({
      height: leading,
      space: 0,
      // A paragraph never leaves one line alone at the foot of a page, or carries one over to the next.
      breakBefore: line.turnover || i === 1 || (i > 0 && i === last) ? 'avoid' : 'allow',
      draw: (canvas: Canvas, top: number) => canvas.text(line.boxes, x, top - baseline, line.scale),
    }));
  }

  /** Where the baseline sits below the top of a line: the x-height centred in the leading. */
  private baseline(leading: number, size: number): number {
    return leading / 2 + (size * this.faces.regular.xHeight) / 2;
  }

  private indented(nesting: Nesting): { left: number; width: number } {
    const quote = nesting.quote * QUOTE_INDENT * this.size;
    const left = Math.min(quote + nesting.list * LIST_INDENT * this.size, this.measure / 2);
    const right = Math.min(quote, this.measure / 4);
    return { left, width: this.measure - left - right };
  }

  /** Sets lines centred on the page from `top` down, returning where they end. */
  private setLines(canvas: Canvas, pieces: TextPiece<Style>[], size: number, leading: number, top: number): number {
    const lines = setText(pieces, metrics, { width: this.measure, align: 'center', balance: true });
    let y = top;
    for (const line of lines) {
      canvas.text(line.boxes, this.page.side, y - this.baseline(leading, size));
      y -= leading;
    }
    return y;
  }

  // Text

  /** Runs as pieces of text in a face that can show them. */
  private pieces(
    runs: Run[],
    base: { size: number; bold?: boolean; italic?: boolean; tracking?: number },
    pre = false,
  ) {
    const out: TextPiece<Style>[] = [];
    for (const run of runs) {
      const bold = Boolean(base.bold || run.bold);
      // Emphasis inside italic text (a caption, a subtitle) turns roman, so it still stands out.
      const italic = base.italic ? !run.italic : Boolean(run.italic);
      let size = base.size * (run.small ? SMALL : 1) * (run.mono ? MONO : 1);
      let rise = 0;
      if (run.sup || run.sub) {
        rise = run.sup ? size * 0.33 : -size * 0.15;
        size *= 0.7;
      }
      const face = run.mono
        ? this.faces.mono
        : this.faces[bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular'];
      // Courier only has Western European characters; Literata stands in for the rest.
      const fallback = run.mono ? this.faces.regular : null;
      let current: Face | null = null;
      let text = '';
      const flush = () => {
        if (text && current) out.push({ text, style: this.style(current, size, rise, base.tracking) });
        text = '';
      };
      for (const char of run.text.normalize('NFC')) {
        const code = printable(char.codePointAt(0) as number, pre);
        if (code === null) continue;
        const shown = String.fromCodePoint(code);
        // Spaces and line-breaking marks are never drawn as glyphs, so they go with whatever face is current.
        const chosen: Face | null = BREAKS.has(code)
          ? (current ?? face)
          : face.has(code)
            ? face
            : fallback?.has(code)
              ? fallback
              : null;
        if (!chosen) continue;
        if (chosen !== current) {
          flush();
          current = chosen;
        }
        text += shown;
      }
      flush();
    }
    return out;
  }

  private style(face: Face, size: number, rise = 0, tracking = 0): Style {
    const key = `${face.name} ${size} ${rise} ${tracking}`;
    let style = this.styles.get(key);
    if (!style) {
      style = { face, size, rise, tracking };
      this.styles.set(key, style);
    }
    return style;
  }

  // Output

  private render(pieces: Piece[]) {
    const canvas = new Canvas();
    let top = this.page.height - this.page.top;
    pieces.forEach((piece, i) => {
      if (i > 0 || piece.sticky) top -= piece.space;
      piece.draw?.(canvas, top);
      top -= piece.height;
    });
    const chapter = pieces[0]?.chapter;
    // Chapter openings, like the cover and title page, go without a page number.
    if (chapter === undefined) this.folio(canvas, this.doc.getPageCount() + 1);
    const page = this.write(canvas);
    if (chapter !== undefined) this.openings.set(chapter, page);
    for (const piece of pieces) this.weight += piece.weight ?? 0;
    if (this.totalWeight) this.onProgress?.(Math.min(0.95, (this.weight / this.totalWeight) * 0.95));
  }

  private folio(canvas: Canvas, n: number) {
    const style = this.style(this.faces.regular, this.size * 0.85);
    const text = String(n);
    const width = metrics.width(text, style);
    canvas.text([{ text, style, x: 0, width, space: false }], (this.page.width - width) / 2, this.page.bottom * 0.45);
  }

  private write(canvas: Canvas, width = this.page.width): PDFPage {
    const page = this.doc.addPage([width, this.page.height]);
    for (const face of canvas.faces) page.node.setFontDictionary(PDFName.of(face.name), face.pdf.ref);
    for (const picture of canvas.pictures) page.node.setXObject(PDFName.of(picture.name), picture.pdf.ref);
    const { context } = this.doc;
    page.node.addContentStream(context.register(context.flateStream(canvas.content())));
    return page;
  }
}

/** Code points never drawn: spaces, newlines, soft hyphens and zero-width spaces only steer line breaking. */
const BREAKS = new Set([0x20, 0x0a, 0x09, 0xad, 0x200b]);

/** What a character becomes on the page: itself, a stand-in, or nothing (controls, invisible joiners). */
function printable(code: number, pre: boolean): number | null {
  if (code === 0x09) return pre ? code : 0x20;
  if (code < 0x20) return code === 0x0a ? code : null;
  if (code >= 0x7f && code < 0xa0) return null;
  if ((code >= 0x2000 && code <= 0x2008) || code === 0x205f || code === 0x3000) return 0x20;
  // Literata has no narrow no-break space; its thin space is the same width.
  if (code === 0x202f) return 0x2009;
  if (code === 0x200c || code === 0x200d || code === 0x2060 || code === 0xfeff) return null;
  if ((code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)) return null;
  return code;
}

/**
 * Short lines set apart by <br>: verse, an address, a letter's close. They are
 * set flush left and never stretched. Long ones are prose paragraphs that a
 * converter separated with <br> instead of <p>, and stay justified.
 */
function isVerse(runs: Run[]): boolean {
  const lines = runs
    .map((run) => run.text)
    .join('')
    .split('\n');
  return lines.length > 1 && lines.join('').length / lines.length <= VERSE_LINE;
}

function weightOf(block: Block): number {
  if (block.kind === 'image') return PICTURE_WEIGHT;
  return 'runs' in block ? block.runs.reduce((n, run) => n + run.text.length, 0) : 0;
}

function height(laid: Laid): number {
  return laid.pieces.reduce((sum, piece, i) => sum + piece.height + (i ? piece.space : 0), 0);
}

/** One page's content stream, plus the fonts and pictures it uses. */
class Canvas {
  readonly faces = new Set<Face>();
  readonly pictures = new Set<Picture>();
  private readonly ops: string[] = [];
  // Text state lasts for the whole content stream, across text objects.
  private face: Face | null = null;
  private size = 0;
  private rise = 0;
  private tracking = 0;
  private scale = 1;

  /** Sets a line of boxes as one text object. Word spaces are real space glyphs, so copied text reads normally. */
  text(boxes: readonly SetBox<Style>[], x: number, y: number, scale = 1) {
    const first = boxes[0];
    if (!first) return;
    const ops = [`BT 1 0 0 1 ${num(x + first.x)} ${num(y)} Tm`];
    if (scale !== this.scale) {
      ops.push(`${num(scale * 100)} Tz`);
      this.scale = scale;
    }
    let array: string[] = [];
    const close = () => {
      if (array.length) ops.push(`[${array.join(' ')}] TJ`);
      array = [];
    };
    let pen = first.x;
    for (const box of boxes) {
      const { face, size, rise, tracking } = box.style;
      if (face !== this.face || size !== this.size) {
        close();
        ops.push(`/${face.name} ${num(size)} Tf`);
        this.face = face;
        this.size = size;
        this.faces.add(face);
      }
      if (rise !== this.rise) {
        close();
        ops.push(`${num(rise)} Ts`);
        this.rise = rise;
      }
      if (tracking !== this.tracking) {
        close();
        ops.push(`${num(tracking)} Tc`);
        this.tracking = tracking;
      }
      if (box.space) {
        const space = face.shape(' ');
        array.push(space.tj);
        pen += advance(space, box.style) * scale;
      }
      // Justification and alignment move the pen to where the box belongs. TJ moves it back,
      // in thousandths of the scaled font size, so moving right is a negative number.
      const shift = box.x - pen;
      if (Math.abs(shift) > 0.01) array.push(String(Math.round((-shift * 1000) / (size * scale))));
      const shaped = face.shape(box.text);
      array.push(shaped.tj);
      pen = box.x + advance(shaped, box.style) * scale;
    }
    close();
    ops.push('ET');
    this.ops.push(ops.join(' '));
  }

  picture(picture: Picture, x: number, y: number, width: number, height: number) {
    this.pictures.add(picture);
    this.ops.push(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(y)} cm /${picture.name} Do Q`);
  }

  content(): string {
    return this.ops.join('\n');
  }
}

function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** pdf-lib has no API for bookmarks, so the outline dictionaries are built by hand: one entry per chapter. */
function addOutline(doc: PDFDocument, entries: { title: string; page: PDFPage }[]) {
  if (!entries.length) return;
  const { context } = doc;
  const root = context.nextRef();
  const refs = entries.map(() => context.nextRef());
  entries.forEach((entry, i) => {
    const item = PDFDict.withContext(context);
    item.set(PDFName.of('Title'), PDFHexString.fromText(entry.title));
    item.set(PDFName.of('Parent'), root);
    const previous = refs[i - 1];
    const next = refs[i + 1];
    if (previous) item.set(PDFName.of('Prev'), previous);
    if (next) item.set(PDFName.of('Next'), next);
    // Open at the top of the chapter's first page, keeping the reader's zoom.
    item.set(PDFName.of('Dest'), context.obj([entry.page.ref, 'XYZ', null, entry.page.getHeight(), null]));
    context.assign(refs[i] as PDFRef, item);
  });
  const outlines = { Type: 'Outlines', First: refs[0] as PDFRef, Last: refs.at(-1) as PDFRef, Count: refs.length };
  context.assign(root, context.obj(outlines));
  doc.catalog.set(PDFName.of('Outlines'), root);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
