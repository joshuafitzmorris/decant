// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat } from '../../src/core/sniff';
import { type Book, parseChapter } from '../../src/engines/ebook/book';
import { readEpub } from '../../src/engines/ebook/epub-read';
import { writeEpub } from '../../src/engines/ebook/epub-write';
import { readFb2 } from '../../src/engines/ebook/fb2-read';
import { writeFb2 } from '../../src/engines/ebook/fb2-write';
import { documentToBook } from '../../src/engines/ebook/from-document';
import { readMobi } from '../../src/engines/ebook/mobi-read';
import { flattenStyles, parseRules } from '../../src/engines/ebook/styles';
import { bookToHtml, bookToMarkdown, bookToText } from '../../src/engines/ebook/text';

const bytes = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', name));
const fixture = (name: string) => new File([bytes(name)], name);
const text = (book: Book) =>
  book.chapters
    .map((c) => parseChapter(c.html).body.textContent)
    .join(' ')
    .replace(/\s+/g, ' ');

describe('format detection', () => {
  it('recognises ebooks by their contents', async () => {
    expect(await detectFormat(fixture('sample.epub'))).toBe('epub');
    expect(await detectFormat(fixture('sample.mobi'))).toBe('mobi');
    expect(await detectFormat(fixture('sample.azw3'))).toBe('azw3');
    expect(await detectFormat(fixture('sample.fb2'))).toBe('fb2');
    expect(await detectFormat(fixture('sample.cbz'))).toBe('cbz');
    // Renamed files are still read for what they are.
    expect(await detectFormat(new File([bytes('sample.epub')], 'book.zip'))).toBe('epub');
    const zipped = zipSync({ 'book.fb2': bytes('sample.fb2') });
    expect(await detectFormat(new File([zipped as BlobPart], 'book.fb2.zip'))).toBe('fb2');
  });
});

describe('Kindle books', () => {
  for (const name of ['sample.mobi', 'sample.azw3']) {
    it(`reads ${name}: text, metadata, cover and contents`, async () => {
      const book = await readMobi(fixture(name));
      expect(book.title).toBe('The Raven');
      expect(book.authors).toEqual(['Edgar Allan Poe']);
      expect(book.language).toMatch(/^en/);
      expect(text(book)).toContain('Once upon a midnight dreary, while I pondered, weak and weary');
      const cover = book.resources.find((r) => r.id === book.coverId);
      expect(cover?.type).toBe('image/jpeg');
      expect(book.toc.length).toBeGreaterThan(0);
      for (const chapter of book.chapters) {
        expect(chapter.html).not.toMatch(/kindle:|recindex|filepos=|<script/);
        for (const [, src] of chapter.html.matchAll(/ src="([^"]+)"/g)) {
          expect(book.resources.some((r) => r.href === src)).toBe(true);
        }
      }
    });
  }

  it('survives a round trip through MOBI without gaining a contents chapter', async () => {
    const { writeMobi } = await import('../../src/engines/ebook/mobi-write');
    const original = await readEpub(fixture('sample.epub'));
    const mobi = await writeMobi({ ...original, resources: original.resources.filter((r) => r.type === 'image/jpeg') });
    const copy = await readMobi(new File([mobi as BlobPart], 'copy.mobi'));
    expect(copy.chapters.map((c) => c.title)).toEqual(original.chapters.map((c) => c.title));
    expect(copy.title).toBe(original.title);
    expect(text(copy)).toContain('Dear Charles, the Analytical Engine weaves algebraic patterns.');
    expect(copy.chapters[0]?.html).toContain('href="chapter-');
  });

  it('refuses books with DRM', async () => {
    const data = new Uint8Array(bytes('sample.mobi'));
    const view = new DataView(data.buffer);
    view.setUint16(view.getUint32(78) + 12, 2);
    await expect(readMobi(new File([data], 'locked.azw'))).rejects.toThrow(/DRM/);
  });
});

describe('EPUB', () => {
  it('reads chapters, folds CSS classes into markup and resolves links', async () => {
    const book = await readEpub(fixture('sample.epub'));
    expect(book.title).toBe('The Decant Sample Book');
    expect(book.authors).toEqual(['Ada Lovelace']);
    expect(book.description).toBe('A tiny book for testing ebook conversions.');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter One: Arrival', 'Chapter Two: Departure']);
    const first = book.chapters[0]?.html ?? '';
    expect(first).toContain('<em>dark and stormy</em>');
    expect(first).toContain('<strong>engine</strong>');
    expect(first).toContain('<p align="center">* * *</p>');
    expect(first).not.toContain('hidden by the stylesheet');
    expect(first).not.toContain('alert(');
    expect(first).toContain('href="chapter-2.xhtml#letter"');
    expect(first).toContain('href="https://example.com/"');
    expect(first).toMatch(/<img src="images\/figure\.png" alt="A test pattern"\s*\/>/);
    expect(book.toc[1]?.children[0]).toEqual({ title: 'The letter', href: 'chapter-2.xhtml#letter', children: [] });
    expect(book.resources.find((r) => r.id === book.coverId)?.href).toBe('images/cover.jpg');
  });

  it('refuses DRM-locked EPUBs but not ones with obfuscated fonts', async () => {
    const files = unzipSync(bytes('sample.epub'));
    const encryption = (algorithm: string) =>
      strToU8(
        `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/></enc:EncryptedData></encryption>`,
      );
    const locked = zipSync({
      ...files,
      'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc'),
    });
    await expect(readEpub(new File([locked as BlobPart], 'locked.epub'))).rejects.toThrow(/DRM/);
    const fonts = zipSync({ ...files, 'META-INF/encryption.xml': encryption('http://www.idpf.org/2008/embedding') });
    await expect(readEpub(new File([fonts as BlobPart], 'fonts.epub'))).resolves.toBeTruthy();
  });

  it('writes an EPUB that reads back the same', async () => {
    const original = await readMobi(fixture('sample.azw3'));
    const epub = await writeEpub(original);
    const entries = unzipSync(epub);
    expect(Object.keys(entries)[0]).toBe('mimetype');
    expect(new TextDecoder().decode(entries.mimetype)).toBe('application/epub+zip');
    expect(new TextDecoder().decode(epub.subarray(30, 38))).toBe('mimetype');
    const opf = new TextDecoder().decode(entries['OEBPS/content.opf']);
    expect(opf).toContain('<dc:title>The Raven</dc:title>');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('dcterms:modified');

    const copy = await readEpub(new File([epub as BlobPart], 'copy.epub'));
    expect(copy.title).toBe('The Raven');
    expect(copy.authors).toEqual(['Edgar Allan Poe']);
    expect(text(copy)).toBe(text(original));
    expect(copy.resources.find((r) => r.id === copy.coverId)?.data).toEqual(
      original.resources.find((r) => r.id === original.coverId)?.data,
    );
  });
});

describe('FictionBook', () => {
  it('reads sections, notes, pictures and links', async () => {
    const book = await readFb2(fixture('sample.fb2'));
    expect(book.title).toBe('Decant FB2 Sample');
    expect(book.authors).toEqual(['Anton Chekhov']);
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Notes']);
    const [one, two, notes] = book.chapters.map((c) => c.html);
    expect(one).toContain('<em>first</em>');
    expect(one).toContain('Привет, мир.');
    expect(one).toContain('<a href="chapter-3.xhtml#n1"><sup>[1]</sup></a>');
    expect(two).toContain('<a href="chapter-1.xhtml#s1">chapter one</a>');
    expect(notes).toContain("The note's text.");
    expect(book.resources.map((r) => r.type)).toEqual(['image/jpeg', 'image/png']);
    expect(book.coverId).toBe(book.resources[0]?.id);
  });

  it('honours a declared Windows-1251 encoding', async () => {
    // "Привет" in Windows-1251.
    const word = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2];
    const head = strToU8(
      '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><body><section><p>',
    );
    const tail = strToU8('</p></section></body></FictionBook>');
    const book = await readFb2(new File([head, new Uint8Array(word), tail], 'cp1251.fb2'));
    expect(text(book)).toContain('Привет');
  });

  it('writes FB2 that reads back with the same text', async () => {
    const original = await readEpub(fixture('sample.epub'));
    const copy = await readFb2(new File([writeFb2(original) as BlobPart], 'copy.fb2'));
    expect(copy.title).toBe(original.title);
    expect(copy.authors).toEqual(original.authors);
    for (const phrase of [
      'dark and stormy',
      'Café, naïve, “quoted” — and an em dash.',
      'Dear Charles',
      '• First thing',
    ]) {
      expect(text(copy)).toContain(phrase);
    }
    expect(copy.chapters[0]?.html).toContain('<em>dark and stormy</em>');
    expect(copy.chapters[0]?.html).toContain('href="chapter-2.xhtml#c2-letter"');
    expect(copy.resources.length).toBe(2);
  });
});

describe('documents to books', () => {
  it('splits Markdown into chapters at its headings', async () => {
    const md = '# My Novel\n\n## One\n\nFirst [see two](#two).\n\n## Two {#two}\n\nSecond.\n';
    const book = await documentToBook(new File([md], 'novel.md'), 'md', 'novel');
    expect(book.chapters.map((c) => c.title)).toEqual(['My Novel', 'One', 'Two {#two}']);
  });

  it('finds chapter headings in plain text', async () => {
    const txt = 'Chapter 1\n\nIt begins.\n\nCHAPTER II\n\nIt goes on.\n\nEpilogue\n\nIt ends.\n';
    const book = await documentToBook(new File([txt], 'story.txt'), 'txt', 'story');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'CHAPTER II', 'Epilogue']);
  });
});

describe('plain outputs', () => {
  it('writes text, Markdown and one self-contained web page', async () => {
    const book = await readEpub(fixture('sample.epub'));
    const txt = bookToText(book);
    expect(txt.startsWith('The Decant Sample Book\nAda Lovelace\n')).toBe(true);
    expect(txt).toContain('It was a dark and stormy night');
    const md = await bookToMarkdown(book);
    expect(md).toContain('*dark and stormy*');
    expect(md).not.toContain('chapter-2.xhtml');
    const html = bookToHtml(book);
    expect(html).toContain('<a href="#c2-letter">the letter</a>');
    expect(html).toContain('id="c2-letter"');
    expect(html).toContain('src="data:image/png;base64,');
  });
});

describe('stylesheet folding', () => {
  it('parses rules and skips @-blocks', () => {
    expect(parseRules('@media print { .a { color: red } } .b, p.c { font-style: italic }')).toEqual([
      { selectors: ['.b', 'p.c'], declarations: ' font-style: italic ' },
    ]);
  });

  it("styles a container's paragraphs rather than wrapping blocks in inline tags", () => {
    const doc = parseChapter('<div class="quote"><p>One</p><p>Two</p></div><p style="font-weight:bold">Three</p>');
    flattenStyles(doc, ['.quote { font-style: italic }']);
    expect(doc.body.innerHTML).toBe('<div><p><em>One</em></p><p><em>Two</em></p></div><p><strong>Three</strong></p>');
  });
});
