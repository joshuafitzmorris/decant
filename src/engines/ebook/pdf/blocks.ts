import { type Book, parseChapter, type Resource, type TocEntry, tocOrChapters } from '../book';

/**
 * A book reduced to what a printed page needs: chapters of blocks holding
 * styled runs of text. It is plain data, so it can be posted to the
 * typesetting worker with its image bytes transferred.
 */
export interface PrintBook {
  title: string;
  authors: string[];
  /** BCP 47 language tag. */
  language: string;
  cover?: PrintImage;
  chapters: PrintChapter[];
}

export interface PrintChapter {
  /** The chapter's name in the book's contents, used for the PDF's bookmarks. */
  title?: string;
  blocks: Block[];
}

/** A picture PDF can hold: JPEG bytes are embedded as they are, PNG is decoded by the PDF writer. */
export interface PrintImage {
  type: 'jpg' | 'png';
  data: Uint8Array;
  /** Size in pixels. */
  width: number;
  height: number;
}

export interface Run {
  /** Spaces are collapsed as a browser would and "\n" is a forced line break; preformatted text keeps everything. */
  text: string;
  bold?: boolean;
  italic?: boolean;
  small?: boolean;
  sup?: boolean;
  sub?: boolean;
  mono?: boolean;
}

export type Align = 'justify' | 'left' | 'center' | 'right';

/** How deep a block sits: blockquotes narrow it from both sides, lists indent it from the left. */
export interface Nesting {
  quote: number;
  list: number;
}

export interface HeadingBlock {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  runs: Run[];
  align?: Align;
}

export interface ParagraphBlock extends Nesting {
  kind: 'paragraph';
  runs: Run[];
  align?: Align;
  /** A table row, its cells joined by a separator. */
  row?: boolean;
}

export interface ItemBlock extends Nesting {
  kind: 'item';
  /** "•", "3.", "iv."... */
  marker: string;
  runs: Run[];
  align?: Align;
}

export interface PreBlock extends Nesting {
  kind: 'pre';
  runs: Run[];
}

export interface ImageBlock extends Nesting {
  kind: 'image';
  image: PrintImage;
}

export interface CaptionBlock extends Nesting {
  kind: 'caption';
  runs: Run[];
  align?: Align;
}

/** A scene break (<hr>), or with `blank` a skipped line where the source has an empty paragraph. */
export interface BreakBlock {
  kind: 'break';
  blank?: boolean;
}

export interface PageBreakBlock {
  kind: 'page-break';
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ItemBlock
  | PreBlock
  | ImageBlock
  | CaptionBlock
  | BreakBlock
  | PageBreakBlock;

/** Reads every chapter into blocks. Pictures go through `prepareImage` once each; those it rejects are left out. */
export async function bookToPrint(
  book: Book,
  prepareImage: (resource: Resource) => Promise<PrintImage | null>,
): Promise<PrintBook> {
  const byHref = new Map(book.resources.map((resource) => [resource.href, resource]));
  const prepared = new Map<Resource, Promise<PrintImage | null>>();
  const picture = (resource: Resource) => {
    let image = prepared.get(resource);
    if (!image) {
      image = prepareImage(resource).catch(() => null);
      prepared.set(resource, image);
    }
    return image;
  };
  const pictureAt = (src: string) => {
    const resource = byHref.get(src) ?? byHref.get(decode(src));
    return resource ? picture(resource) : null;
  };

  const coverResource = book.resources.find((resource) => resource.id === book.coverId);
  const coverImage = coverResource ? picture(coverResource) : Promise.resolve(null);
  const titles = chapterTitles(tocOrChapters(book));
  // Every chapter is read before any picture is awaited, so conversions run side by side.
  const drafts = book.chapters.map((chapter) => {
    const doc = parseChapter(chapter.html);
    return {
      title: titles.get(chapter.href),
      blocks: new BlockReader(pictureAt).read(doc.body ?? doc.documentElement),
    };
  });

  const cover = (await coverImage) ?? undefined;
  const chapters: PrintChapter[] = [];
  for (const draft of drafts) {
    const blocks = tidy(await settle(draft.blocks));
    // EPUBs often open with a page holding just the cover, which the PDF already has.
    const only = blocks.length === 1 ? blocks[0] : undefined;
    if (!blocks.length || (cover && only?.kind === 'image' && only.image === cover)) continue;
    chapters.push({ title: draft.title, blocks });
  }
  return { title: book.title, authors: book.authors, language: book.language, cover, chapters };
}

/** Each chapter's name in the contents: the first entry, in reading order, that points into it. */
function chapterTitles(entries: TocEntry[], titles = new Map<string, string>()): Map<string, string> {
  for (const entry of entries) {
    const path = entry.href.split('#')[0] ?? '';
    if (!titles.has(path)) titles.set(path, entry.title);
    chapterTitles(entry.children, titles);
  }
  return titles;
}

function decode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

// ---------------------------------------------------------------------------
// HTML to blocks

type Style = Omit<Run, 'text'>;
type Target = { kind: 'paragraph' } | { kind: 'heading'; level: HeadingBlock['level'] } | { kind: 'pre' | 'caption' };

interface Context extends Nesting {
  target: Target;
  align?: Align;
}

/** A block whose picture may still be converting. */
type Draft = Exclude<Block, ImageBlock> | (Nesting & { kind: 'image'; image: Promise<PrintImage | null> });

const PARAGRAPH: Target = { kind: 'paragraph' };
const ROOT: Context = { quote: 0, list: 0, target: PARAGRAPH };
const SKIPPED = new Set(['script', 'style', 'template', 'head', 'title', 'noscript', 'rt', 'rp', 'svg']);
const CONTAINERS = new Set([
  'p',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'address',
  'center',
  'figure',
  'details',
  'summary',
  'hgroup',
  'fieldset',
  'legend',
  'dl',
  'body',
]);
const ITALIC = new Set(['em', 'i', 'cite', 'var', 'dfn']);
const MONO = new Set(['code', 'kbd', 'samp', 'tt']);
const ALIGNS = new Set<string>(['justify', 'left', 'center', 'right']);
/** Between table cells, which have no columns once a row is set as a line of text. */
const CELL_SEPARATOR = ' | ';
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/**
 * Walks a chapter's body the way a browser lays it out: inline content
 * gathers into the current block until a block element ends it.
 */
class BlockReader {
  private readonly blocks: Draft[] = [];
  private runs: Run[] = [];
  /** Where the pending inline content goes; null when there is none. */
  private context: Context | null = null;
  /** Whether a space here would start a line or follow another, so it collapses. */
  private collapse = true;
  /** A list marker waiting for the item's first block. */
  private marker: { text: string; nesting: Nesting } | null = null;

  constructor(private readonly picture: (src: string) => Promise<PrintImage | null> | null) {}

  read(body: Element): Draft[] {
    this.children(body, ROOT, {});
    this.flush();
    return this.blocks;
  }

  private children(parent: Node, context: Context, style: Style) {
    for (const node of Array.from(parent.childNodes)) this.node(node, context, style);
  }

  private node(node: Node, context: Context, style: Style) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE)
      this.text(node.nodeValue ?? '', context, style);
    else if (node.nodeType === ELEMENT_NODE) this.element(node as Element, context, style);
  }

  private element(element: Element, context: Context, style: Style) {
    const tag = element.localName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (tag === 'pagebreak' || tag === 'mbp:pagebreak') return this.pageBreak();
    const css = element.getAttribute('style') ?? '';
    if (/(page-)?break-before\s*:\s*(always|page)/i.test(css)) this.pageBreak();
    const align = alignOf(element) ?? context.align;
    const inner: Context = { ...context, align };

    if (tag === 'br') this.lineBreak(context, style);
    else if (tag === 'img') this.image(element.getAttribute('src'), context);
    else if (tag === 'hr') {
      this.flush();
      this.push({ kind: 'break' });
    } else if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]) as HeadingBlock['level'];
      this.block(element, { ...inner, target: { kind: 'heading', level } }, style);
    } else if (tag === 'ul' || tag === 'ol') this.list(element, inner, style);
    else if (tag === 'li') this.item(element, { ...inner, list: inner.list + 1 }, style, bullet(inner.list + 1));
    else if (tag === 'blockquote') this.block(element, { ...inner, quote: inner.quote + 1 }, style);
    else if (tag === 'dd') this.block(element, { ...inner, list: inner.list + 1 }, style);
    else if (tag === 'dt') this.block(element, inner, { ...style, bold: true });
    else if (tag === 'pre') this.block(element, { ...inner, target: { kind: 'pre' } }, { ...style, mono: true });
    else if (tag === 'figcaption' || tag === 'caption')
      this.block(element, { ...inner, target: { kind: 'caption' } }, style);
    else if (tag === 'table') this.table(element, inner, style);
    else if (CONTAINERS.has(tag)) this.block(element, inner, style);
    else if (tag === 'q') {
      this.text('“', inner, style);
      this.children(element, inner, style);
      this.text('”', inner, style);
    } else this.children(element, inner, inlineStyle(tag, style));

    if (/(page-)?break-after\s*:\s*(always|page)/i.test(css)) this.pageBreak();
  }

  /** A block element: whatever came before it is finished, and so is its own content. */
  private block(element: Element, context: Context, style: Style) {
    this.flush();
    this.children(element, context, style);
    this.flush();
  }

  private text(raw: string, context: Context, style: Style) {
    let text: string;
    if (context.target.kind === 'pre') text = raw.replace(/\r\n?/g, '\n');
    else {
      text = raw.replace(/[ \t\n\r\f]+/g, ' ');
      if (this.collapse && text.startsWith(' ')) text = text.slice(1);
      this.collapse = text ? text.endsWith(' ') : this.collapse;
    }
    if (text) this.append(text, context, style);
  }

  private lineBreak(context: Context, style: Style) {
    // Spaces at the end of a line are dropped, as they are at the end of any line.
    const last = this.runs.at(-1);
    if (last && context.target.kind !== 'pre') last.text = last.text.replace(/ +$/, '');
    this.append('\n', context, style);
    this.collapse = true;
  }

  private append(text: string, context: Context, style: Style) {
    this.context ??= context;
    const last = this.runs.at(-1);
    if (last && sameStyle(last, style)) last.text += text;
    else this.runs.push({ text, ...flags(style) });
  }

  private image(src: string | null, context: Context) {
    const image = src ? this.picture(src) : null;
    if (!image) return;
    // A picture inside a paragraph splits it: the printed page sets pictures between lines, not within them.
    this.flush();
    this.push({ kind: 'image', image, quote: context.quote, list: context.list });
  }

  private list(element: Element, context: Context, style: Style) {
    this.flush();
    const inner: Context = { ...context, list: context.list + 1, target: PARAGRAPH };
    const ordered = element.localName.toLowerCase() === 'ol';
    const items = Array.from(element.children).filter((child) => child.localName.toLowerCase() === 'li');
    const reversed = ordered && element.hasAttribute('reversed');
    let n = integer(element.getAttribute('start')) ?? (reversed ? items.length : 1);
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== ELEMENT_NODE || (node as Element).localName.toLowerCase() !== 'li') {
        this.node(node, inner, style);
        continue;
      }
      const li = node as Element;
      n = integer(li.getAttribute('value')) ?? n;
      const marker = ordered ? `${listNumber(n, element.getAttribute('type') ?? '1')}.` : bullet(inner.list);
      this.item(li, { ...inner, align: alignOf(li) ?? inner.align }, style, marker);
      n += reversed ? -1 : 1;
    }
    this.flush();
  }

  private item(element: Element, context: Context, style: Style, marker: string) {
    this.flush();
    this.marker = { text: marker, nesting: { quote: context.quote, list: context.list } };
    this.children(element, { ...context, target: PARAGRAPH }, style);
    this.flush();
    // An empty item still shows its marker.
    if (this.marker) this.push({ kind: 'paragraph', runs: [], ...this.marker.nesting });
  }

  /** Each row becomes one line of text; pictures in cells follow their row. */
  private table(element: Element, context: Context, style: Style) {
    this.flush();
    for (const child of Array.from(element.children)) {
      if (child.localName.toLowerCase() === 'caption') this.element(child, context, style);
    }
    for (const row of tableRows(element)) {
      const runs: Run[] = [];
      const pictures: Draft[] = [];
      for (const cell of Array.from(row.children)) {
        const tag = cell.localName.toLowerCase();
        if (tag !== 'td' && tag !== 'th') continue;
        const reader = new BlockReader(this.picture);
        reader.children(cell, ROOT, tag === 'th' ? { ...style, bold: true } : style);
        reader.flush();
        const text = flatten(reader.blocks, pictures);
        if (!text.length) continue;
        if (runs.length) runs.push({ text: CELL_SEPARATOR });
        runs.push(...text);
      }
      const nesting = { quote: context.quote, list: context.list };
      if (runs.length) this.push({ kind: 'paragraph', runs: mergeRuns(runs), align: 'left', row: true, ...nesting });
      for (const picture of pictures) this.push({ ...picture, ...nesting } as Draft);
    }
  }

  private pageBreak() {
    this.flush();
    this.push({ kind: 'page-break' });
  }

  /** Ends the pending inline content, turning it into a block. */
  private flush() {
    const context = this.context;
    const runs = context?.target.kind === 'pre' ? trimPre(this.runs) : trimRuns(this.runs);
    this.runs = [];
    this.context = null;
    this.collapse = true;
    if (!context) return;
    const visible = runs.some((run) => /\S/.test(run.text));
    const nesting = { quote: context.quote, list: context.list };
    const { target, align } = context;
    if (target.kind === 'heading') {
      if (visible) this.push({ kind: 'heading', level: target.level, runs, align });
    } else if (target.kind === 'pre') {
      if (visible) this.push({ kind: 'pre', runs, ...nesting });
    } else if (target.kind === 'caption') {
      if (visible) this.push({ kind: 'caption', runs, align, ...nesting });
    } else if (visible || this.marker) {
      this.push({ kind: 'paragraph', runs: visible ? runs : [], align, ...nesting });
    } else {
      // Only &nbsp; or <br>: a browser still gives it a line, which books use to mark a pause.
      this.push({ kind: 'break', blank: true });
    }
  }

  /** Adds a block; the first one in a list item carries the item's marker. */
  private push(block: Draft) {
    const marker = this.marker;
    if (marker) {
      this.marker = null;
      if (block.kind === 'paragraph') {
        this.blocks.push({
          kind: 'item',
          marker: marker.text,
          runs: block.runs,
          align: block.align,
          ...marker.nesting,
        });
        return;
      }
      this.blocks.push({ kind: 'item', marker: marker.text, runs: [], ...marker.nesting });
    }
    this.blocks.push(block);
  }
}

function alignOf(element: Element): Align | undefined {
  const value = element.getAttribute('align')?.trim().toLowerCase();
  return value && ALIGNS.has(value) ? (value as Align) : undefined;
}

function inlineStyle(tag: string, style: Style): Style {
  if (ITALIC.has(tag)) return { ...style, italic: true };
  if (tag === 'strong' || tag === 'b') return { ...style, bold: true };
  if (tag === 'sup') return { ...style, sup: true, sub: false };
  if (tag === 'sub') return { ...style, sub: true, sup: false };
  if (tag === 'small') return { ...style, small: true };
  if (MONO.has(tag)) return { ...style, mono: true };
  return style;
}

const STYLE_KEYS = ['bold', 'italic', 'small', 'sup', 'sub', 'mono'] as const;

/** The style flags that are set, so runs stay small when posted to the worker. */
function flags(style: Style): Style {
  const out: Style = {};
  for (const key of STYLE_KEYS) if (style[key]) out[key] = true;
  return out;
}

function sameStyle(a: Style, b: Style): boolean {
  return STYLE_KEYS.every((key) => !a[key] === !b[key]);
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && sameStyle(last, run)) last.text += run.text;
    else if (run.text) out.push({ ...run });
  }
  return out;
}

/** Drops spaces at the end of the block and one closing line break, which browsers don't show either. */
function trimRuns(runs: Run[]): Run[] {
  const out = mergeRuns(runs);
  let closing = true;
  for (let last = out.at(-1); last; last = out.at(-1)) {
    last.text = last.text.replace(/ +$/, '');
    if (closing && last.text.endsWith('\n')) last.text = last.text.slice(0, -1).replace(/ +$/, '');
    closing = false;
    if (last.text) break;
    out.pop();
  }
  return out;
}

/** Preformatted text loses the newline right after <pre>, as in HTML, and blank lines at the end. */
function trimPre(runs: Run[]): Run[] {
  const out = mergeRuns(runs);
  const first = out[0];
  if (first) first.text = first.text.replace(/^\n/, '');
  for (let last = out.at(-1); last; last = out.at(-1)) {
    last.text = last.text.replace(/\s+$/, '');
    if (last.text) break;
    out.pop();
  }
  return out.filter((run) => run.text);
}

/** Rows in document order, from the table itself or its head, bodies and foot (not from nested tables). */
function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.localName.toLowerCase();
    if (tag === 'tr') rows.push(child);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      rows.push(...Array.from(child.children).filter((row) => row.localName.toLowerCase() === 'tr'));
    }
  }
  return rows;
}

/** A cell's blocks as one run of text; its pictures are set aside. */
function flatten(blocks: Draft[], pictures: Draft[]): Run[] {
  const runs: Run[] = [];
  for (const block of blocks) {
    if (block.kind === 'image') {
      pictures.push(block);
      continue;
    }
    if (!('runs' in block) || !block.runs.length) continue;
    if (runs.length) runs.push({ text: ' ' });
    for (const run of block.runs) runs.push({ ...run, text: run.text.replace(/\s*\n\s*/g, ' ') });
  }
  return mergeRuns(runs);
}

/** Bullets alternate between levels, with shapes Literata has. */
function bullet(depth: number): string {
  return depth % 2 === 1 ? '•' : '–';
}

function integer(value: string | null): number | undefined {
  const n = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Formats an ordered list number per the list's `type`: 1, a, A, i or I. */
export function listNumber(n: number, type: string): string {
  if (n <= 0 || (type !== 'a' && type !== 'A' && type !== 'i' && type !== 'I')) return String(n);
  if (type === 'i' || type === 'I') {
    const roman = toRoman(n);
    return type === 'i' ? roman.toLowerCase() : roman;
  }
  let letters = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) letters = String.fromCharCode(97 + ((k - 1) % 26)) + letters;
  return type === 'A' ? letters.toUpperCase() : letters;
}

function toRoman(n: number): string {
  const numerals: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [value, numeral] of numerals) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/** Waits for the chapter's pictures, dropping those that couldn't be prepared. */
async function settle(drafts: Draft[]): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const draft of drafts) {
    if (draft.kind !== 'image') {
      blocks.push(draft);
      continue;
    }
    const image = await draft.image;
    // Spacer GIFs and tracking pixels aren't pictures.
    if (image && image.width > 2 && image.height > 2) blocks.push({ ...draft, image });
  }
  return blocks;
}

/** Scene breaks and page breaks only mean something between content: repeats and those at either end go. */
function tidy(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const last = out.at(-1);
    if (block.kind === 'break' || block.kind === 'page-break') {
      if (!last) continue;
      if (last.kind === 'page-break') continue;
      if (last.kind === 'break') {
        if (block.kind === 'page-break' || (last.blank && !block.blank)) out[out.length - 1] = block;
        continue;
      }
    }
    out.push(block);
  }
  while (out.at(-1)?.kind === 'break' || out.at(-1)?.kind === 'page-break') out.pop();
  return out;
}
