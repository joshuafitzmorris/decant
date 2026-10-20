// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Book, Resource } from '../../src/engines/ebook/book';
import { type Block, bookToPrint, listNumber, type PrintImage } from '../../src/engines/ebook/pdf/blocks';

const png = (id: string, href: string): Resource => ({
  id,
  href,
  type: 'image/png',
  data: new Uint8Array([id.length]),
});
const picture = (resource: Resource): PrintImage => ({ type: 'png', data: resource.data, width: 40, height: 30 });

function makeBook(chapters: string[], extra: Partial<Book> = {}): Book {
  return {
    title: 'Sample',
    authors: ['A. Author'],
    language: 'en',
    chapters: chapters.map((html, i) => ({ href: `chapter-${i + 1}.xhtml`, html })),
    resources: [],
    toc: [],
    ...extra,
  };
}

/** The blocks of a one-chapter book. */
async function blocksOf(html: string, extra: Partial<Book> = {}): Promise<Block[]> {
  const print = await bookToPrint(makeBook([html], extra), async (resource) => picture(resource));
  return print.chapters[0]?.blocks ?? [];
}

describe('bookToPrint', () => {
  it('collapses whitespace like a browser and keeps inline styles', async () => {
    const blocks = await blocksOf(
      '<p>  Hello\n   <em>big </em> <strong>bold <i>both</i></strong>\t<cite>title</cite>  </p>' +
        '<p>H<sub>2</sub>O, x<sup>2</sup>, <small>fine print</small> and <code>a   b</code> or <kbd>Ctrl</kbd></p>',
    );
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        quote: 0,
        list: 0,
        runs: [
          { text: 'Hello ' },
          { text: 'big ', italic: true },
          { text: 'bold ', bold: true },
          { text: 'both', bold: true, italic: true },
          { text: ' ' },
          { text: 'title', italic: true },
        ],
      },
      {
        kind: 'paragraph',
        quote: 0,
        list: 0,
        runs: [
          { text: 'H' },
          { text: '2', sub: true },
          { text: 'O, x' },
          { text: '2', sup: true },
          { text: ', ' },
          { text: 'fine print', small: true },
          { text: ' and ' },
          { text: 'a b', mono: true },
          { text: ' or ' },
          { text: 'Ctrl', mono: true },
        ],
      },
    ]);
  });

  it('turns <br> into line breaks, dropping the spaces around them and a closing one', async () => {
    const blocks = await blocksOf('<p>One <br/>  two<br/><em>three</em> <br/></p><p><br/></p><p>&#160;</p><p>Four</p>');
    expect(blocks).toEqual([
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'One\ntwo\n' }, { text: 'three', italic: true }] },
      // Empty paragraphs that still take a line become a blank line (one, since repeats collapse).
      { kind: 'break', blank: true },
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'Four' }] },
    ]);
  });

  it('reads headings, alignment and blockquote depth', async () => {
    const blocks = await blocksOf(
      '<h1 align="center">Part <em>One</em></h1><h3>Section</h3>' +
        '<div align="right"><p>Inherited</p><p align="justify">Own</p></div>' +
        '<blockquote><p>Outer</p><blockquote><p align="left">Inner</p></blockquote></blockquote>' +
        '<script>ignored()</script><style>p { color: red }</style><p>After</p>',
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, align: 'center', runs: [{ text: 'Part ' }, { text: 'One', italic: true }] },
      { kind: 'heading', level: 3, runs: [{ text: 'Section' }] },
      { kind: 'paragraph', align: 'right', quote: 0, list: 0, runs: [{ text: 'Inherited' }] },
      { kind: 'paragraph', align: 'justify', quote: 0, list: 0, runs: [{ text: 'Own' }] },
      { kind: 'paragraph', quote: 1, list: 0, runs: [{ text: 'Outer' }] },
      { kind: 'paragraph', align: 'left', quote: 2, list: 0, runs: [{ text: 'Inner' }] },
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'After' }] },
    ]);
  });

  it('numbers and nests lists', async () => {
    const blocks = await blocksOf(
      '<ol start="3"><li>Three<ul><li>Sub <b>one</b></li><li><p>Sub two</p><p>More</p></li></ul></li><li>Four</li></ol>' +
        '<ol type="i"><li>Roman</li><li>Two</li></ol><ol type="A" start="27"><li>Letters</li></ol><ul><li></li></ul>',
    );
    expect(blocks).toEqual([
      { kind: 'item', marker: '3.', quote: 0, list: 1, runs: [{ text: 'Three' }] },
      { kind: 'item', marker: '–', quote: 0, list: 2, runs: [{ text: 'Sub ' }, { text: 'one', bold: true }] },
      { kind: 'item', marker: '–', quote: 0, list: 2, runs: [{ text: 'Sub two' }] },
      { kind: 'paragraph', quote: 0, list: 2, runs: [{ text: 'More' }] },
      { kind: 'item', marker: '4.', quote: 0, list: 1, runs: [{ text: 'Four' }] },
      { kind: 'item', marker: 'i.', quote: 0, list: 1, runs: [{ text: 'Roman' }] },
      { kind: 'item', marker: 'ii.', quote: 0, list: 1, runs: [{ text: 'Two' }] },
      { kind: 'item', marker: 'AA.', quote: 0, list: 1, runs: [{ text: 'Letters' }] },
      { kind: 'item', marker: '•', quote: 0, list: 1, runs: [] },
    ]);
    expect(['1', 'a', 'A', 'i', 'I'].map((type) => listNumber(14, type))).toEqual(['14', 'n', 'N', 'xiv', 'XIV']);
  });

  it('keeps preformatted text as it is, in monospace', async () => {
    const blocks = await blocksOf('<pre>\n  let x = 1;\n\n    <b>return</b> x;\n</pre>');
    expect(blocks).toEqual([
      {
        kind: 'pre',
        quote: 0,
        list: 0,
        runs: [
          { text: '  let x = 1;\n\n    ', mono: true },
          { text: 'return', bold: true, mono: true },
          { text: ' x;', mono: true },
        ],
      },
    ]);
  });

  it('flattens table rows into lines and keeps scene breaks between text', async () => {
    const blocks = await blocksOf(
      '<hr/><p>Before</p><hr/><hr/>' +
        '<table><caption>Prices</caption><thead><tr><th>Item</th><th>Cost</th></tr></thead>' +
        '<tbody><tr><td><p>Tea</p><p>(loose)</p></td><td>£2</td></tr><tr><td></td><td>Free</td></tr></tbody></table>' +
        '<p>After</p><hr/>',
    );
    expect(blocks).toEqual([
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'Before' }] },
      { kind: 'break' },
      { kind: 'caption', quote: 0, list: 0, runs: [{ text: 'Prices' }] },
      {
        kind: 'paragraph',
        align: 'left',
        row: true,
        quote: 0,
        list: 0,
        runs: [{ text: 'Item', bold: true }, { text: ' | ' }, { text: 'Cost', bold: true }],
      },
      { kind: 'paragraph', align: 'left', row: true, quote: 0, list: 0, runs: [{ text: 'Tea (loose) | £2' }] },
      { kind: 'paragraph', align: 'left', row: true, quote: 0, list: 0, runs: [{ text: 'Free' }] },
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'After' }] },
    ]);
  });

  it('sets pictures between paragraphs, with their captions, and marks page breaks', async () => {
    const a = png('a', 'images/a.png');
    const blocks = await blocksOf(
      '<p>Text <img src="images/a.png" alt=""/> continues</p>' +
        '<figure><img src="images/a.png" alt=""/><figcaption align="center">Plate <i>1</i></figcaption></figure>' +
        '<p>Missing <img src="images/none.png" alt=""/>here</p><div style="page-break-before: always"><p>New page</p></div>',
      { resources: [a] },
    );
    const image = { kind: 'image', quote: 0, list: 0, image: { type: 'png', data: a.data, width: 40, height: 30 } };
    expect(blocks).toEqual([
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'Text' }] },
      image,
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'continues' }] },
      image,
      { kind: 'caption', align: 'center', quote: 0, list: 0, runs: [{ text: 'Plate ' }, { text: '1', italic: true }] },
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'Missing here' }] },
      { kind: 'page-break' },
      { kind: 'paragraph', quote: 0, list: 0, runs: [{ text: 'New page' }] },
    ]);
  });

  it('prepares each picture once, drops those that fail, and skips a page that only repeats the cover', async () => {
    const cover = png('cover', 'images/cover.png');
    const broken = png('broken', 'images/broken.png');
    const prepare = vi.fn(async (resource: Resource) => (resource === broken ? null : picture(resource)));
    const book = makeBook(
      [
        '<div><img src="images/cover.png" alt="Cover"/></div>',
        '<h1>One</h1><p><img src="images/broken.png" alt=""/></p><p>Text</p>',
        '<h2>Two</h2><p>More <img src="images/cover.png" alt=""/></p>',
        '<p>Untitled continuation</p>',
      ],
      {
        resources: [cover, broken],
        coverId: 'cover',
        toc: [
          { title: 'Cover', href: 'chapter-1.xhtml', children: [] },
          {
            title: 'Chapter One',
            href: 'chapter-2.xhtml#start',
            children: [{ title: 'Chapter Two', href: 'chapter-3.xhtml', children: [] }],
          },
        ],
      },
    );
    const print = await bookToPrint(book, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(print.cover).toEqual(picture(cover));
    expect(print).toMatchObject({ title: 'Sample', authors: ['A. Author'], language: 'en' });
    expect(print.chapters.map((chapter) => chapter.title)).toEqual(['Chapter One', 'Chapter Two', undefined]);
    expect(print.chapters[0]?.blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph']);
    const second = print.chapters[1]?.blocks ?? [];
    expect(second[2]).toMatchObject({ kind: 'image', image: print.cover });
  });

  it('names chapters after their headings when the book has no contents', async () => {
    const book = makeBook(['<p>No heading</p>', '<h1>Called</h1>']);
    book.chapters[1] = { ...(book.chapters[1] as Book['chapters'][number]), title: 'Called' };
    const print = await bookToPrint(book, async () => null);
    expect(print.chapters.map((chapter) => chapter.title)).toEqual([undefined, 'Called']);
  });
});
