// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Book, parseChapter } from '../../src/engines/ebook/book';
import { writeMobi } from '../../src/engines/ebook/mobi-write';
import { compressPalmDoc } from '../../src/engines/ebook/palmdoc';
import { MOBI, type MobiBook, type MobiTocItem } from '../../src/engines/ebook/vendor/foliate-mobi';

const jpeg = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sample.jpg')));

const mixed = Array.from({ length: 120 }, (_, i) => {
  const heading = i === 60 ? '<h3 id="milieu">Au milieu</h3>' : '';
  return `${heading}<p>Paragraphe ${i + 1} : “crème brûlée” — 漢字かな交じり文 😀 ${'é'.repeat(i % 7)}.</p>\n`;
}).join('');
/**
 * Over 10 KB of mixed multibyte text, then 4,104 three-byte characters in a row. 4096 isn't a multiple
 * of three, so at least two of the record boundaries in that run split a character, wherever it starts.
 */
const longChapter = `${mixed}<p>${'漢字かな交じり文'.repeat(513)}</p>`;

const book: Book = {
  title: 'Café — Test',
  authors: ['Émile Zola', 'Ada Lovelace'],
  language: 'fr',
  publisher: 'Éditions Decant',
  description: 'Un livre pour les tests.',
  date: '2024-05-01',
  identifier: 'urn:isbn:978-0-14-044913-6',
  coverId: 'cover',
  resources: [
    { id: 'cover', href: 'images/cover.jpg', type: 'image/jpeg', data: jpeg },
    { id: 'diagram', href: 'images/diagram.png', type: 'image/png', data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47) },
  ],
  chapters: [
    {
      href: 'chapter-1.xhtml',
      title: 'Premier chapitre',
      html:
        '<h1 class="title">Premier chapitre</h1>' +
        '<p>Voir <a href="chapter-3.xhtml#cible">la cible</a>, <a href="https://example.com/?a=1&amp;b=2">un site</a>, ' +
        '<a href="mailto:auteur@example.com">un courriel</a> et <a href="absent.xhtml">un lien perdu</a>.</p>' +
        '<figure><img src="images/cover.jpg" alt="La couverture"/><img src="images/diagram.png" alt="Diagramme"/>' +
        '<figcaption>Une figure</figcaption></figure>' +
        '<ul><li>Un</li><li>Deux <em>et</em> <strong>trois</strong></li></ul>' +
        '<blockquote><p style="color: red">Une citation</p></blockquote>',
    },
    {
      href: 'chapter-2.xhtml',
      title: 'Deuxième chapitre',
      html: `<section><h2>Deuxième chapitre</h2>\n${longChapter}</section>`,
    },
    {
      href: 'chapter-3.xhtml',
      title: 'Troisième chapitre',
      html: '<h2>Troisième chapitre</h2><p>Avant la cible.</p><h3 id="cible">La cible</h3><p>Après la cible.</p>',
    },
  ],
  toc: [
    { title: 'Premier chapitre', href: 'chapter-1.xhtml', children: [] },
    {
      title: 'Deuxième chapitre',
      href: 'chapter-2.xhtml',
      children: [{ title: 'Au milieu', href: 'chapter-2.xhtml#milieu', children: [] }],
    },
    { title: 'Troisième chapitre', href: 'chapter-3.xhtml', children: [] },
  ],
};

const open = (file: Uint8Array): Promise<MobiBook> =>
  new MOBI({ unzlib: unzlibSync }).open(new Blob([file as BlobPart]));

async function sectionDocument(mobi: MobiBook, index: number): Promise<Document> {
  const section = mobi.sections[index];
  if (!section?.createDocument) throw new Error(`No section ${index}`);
  return section.createDocument();
}

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/** The Palm database's records. */
function records(file: Uint8Array): Uint8Array[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const offsets = Array.from({ length: view.getUint16(76) }, (_, i) => view.getUint32(78 + i * 8));
  return offsets.map((offset, i) => file.subarray(offset, offsets[i + 1] ?? file.length));
}

const u16 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset);
const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

/** A PalmDOC decompressor written from the spec, independent of foliate's. */
function decompressPalmDoc(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] ?? 0;
    if (byte >= 1 && byte <= 8) {
      out.push(...input.subarray(i + 1, i + 1 + byte));
      i += byte;
    } else if (byte < 0x80) {
      out.push(byte);
    } else if (byte >= 0xc0) {
      out.push(0x20, byte ^ 0x80);
    } else {
      const pair = (byte << 8) | (input[++i] ?? 0);
      const distance = (pair & 0x3fff) >> 3;
      const length = (pair & 7) + 3;
      if (distance < length || distance > out.length)
        throw new Error(`Bad copy: ${length} bytes from ${distance} back`);
      for (let n = 0; n < length; n++) out.push(out[out.length - distance] ?? 0);
    }
  }
  return Uint8Array.from(out);
}

/** Each text record's decompressed bytes and multibyte overlap, read without foliate. */
function textRecords(file: Uint8Array): { text: Uint8Array; overlap: Uint8Array }[] {
  const all = records(file);
  const count = u16(all[0] as Uint8Array, 8);
  return all.slice(1, count + 1).map((record) => {
    const overlap = (record[record.length - 1] ?? 0) & 3;
    const end = record.length - 1 - overlap;
    return { text: decompressPalmDoc(record.subarray(0, end)), overlap: record.subarray(end, end + overlap) };
  });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('writeMobi', () => {
  let file: Uint8Array;
  let mobi: MobiBook;
  /** The whole uncompressed text, decoded without foliate. */
  let text: Uint8Array;
  beforeAll(async () => {
    file = await writeMobi(book);
    mobi = await open(file);
    text = concat(textRecords(file).map((record) => record.text));
  });

  it('stores the metadata', () => {
    expect(mobi.metadata.title).toBe('Café — Test');
    expect(mobi.metadata.author).toEqual(['Émile Zola', 'Ada Lovelace']);
    expect([mobi.metadata.language].flat()).toEqual(['fr']);
    expect(mobi.metadata.publisher).toBe('Éditions Decant');
    expect(mobi.metadata.description).toBe('Un livre pour les tests.');
    expect(mobi.metadata.published).toBe('2024-05-01');
    expect(mobi.mobi.headers.exth?.isbn).toBe('9780140449136');
  });

  it('writes the Palm database, MOBI header and records the way Calibre does', () => {
    const all = records(file);
    const header = all[0] as Uint8Array;
    expect(ascii(file, 0, 32)).toBe(`Cafe___Test${'\0'.repeat(21)}`);
    expect(ascii(file, 60, 8)).toBe('BOOKMOBI');
    expect(u32(file, 68)).toBe(all.length * 2 - 1);
    expect(u32(file, 78)).toBe(78 + all.length * 8 + 2);
    expect(u32(file, 78 + 8 * 5 + 4)).toBe(10); // record 5's attributes (0) and unique id (2 × 5)

    expect(u16(header, 0)).toBe(2); // PalmDOC compression
    expect(u32(header, 4)).toBe(text.length);
    expect(u16(header, 10)).toBe(4096);
    expect(u16(header, 12)).toBe(0); // not encrypted
    expect(ascii(header, 16, 4)).toBe('MOBI');
    expect([u32(header, 20), u32(header, 24), u32(header, 28), u32(header, 36)]).toEqual([0xe8, 2, 65001, 6]);
    expect([header[94], header[95]]).toEqual([0, 12]); // French, no region
    expect(u32(header, 104)).toBe(6);
    expect(u32(header, 128)).toBe(0x50);
    expect(u32(header, 240)).toBe(1); // multibyte trailing entries
    expect(u32(header, 244)).toBe(0xffffffff); // no NCX index

    const textCount = u16(header, 8);
    const firstImage = u32(header, 108);
    expect(u32(header, 80)).toBe(firstImage);
    expect(firstImage).toBeGreaterThan(textCount);
    expect(all[firstImage]).toEqual(jpeg);
    expect(u16(header, 192)).toBe(1);
    expect(u16(header, 194)).toBe(firstImage); // the only image is the last content record
    expect(ascii(all[u32(header, 208)] as Uint8Array, 0, 4)).toBe('FLIS');
    expect(ascii(all[u32(header, 200)] as Uint8Array, 0, 4)).toBe('FCIS');
    expect(u32(all[u32(header, 200)] as Uint8Array, 20)).toBe(text.length);
    expect(all.at(-1)).toEqual(Uint8Array.of(0xe9, 0x8e, 0x0d, 0x0a));

    const exthLength = u32(header, 248 + 4);
    expect(ascii(header, 248, 4)).toBe('EXTH');
    expect(u32(header, 84) % 4).toBe(0);
    expect(u32(header, 84)).toBeGreaterThan(248 + exthLength);
    expect(new TextDecoder().decode(header.subarray(u32(header, 84), u32(header, 84) + u32(header, 88)))).toBe(
      'Café — Test',
    );
    expect(header.length % 4).toBe(0);
  });

  it('marks the cover and stores the exact image bytes', async () => {
    expect(mobi.mobi.headers.exth?.coverOffset).toBe(0);
    expect(mobi.mobi.headers.exth?.thumbnailOffset).toBe(0);
    expect(new Uint8Array(await mobi.mobi.loadResource(0))).toEqual(jpeg);
    const cover = await mobi.getCover();
    expect(new Uint8Array((await cover?.arrayBuffer()) ?? [])).toEqual(jpeg);

    const first = await sectionDocument(mobi, 1);
    const images = first.querySelectorAll('img');
    expect(images).toHaveLength(1); // the PNG can't be stored, so its <img> is gone
    expect(images[0]?.getAttribute('recindex')).toBe('00001');
    expect(images[0]?.getAttribute('alt')).toBe('La couverture');
  });

  it('carries characters split between records in the multibyte trailing entry', () => {
    const parts = textRecords(file);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.some((part) => part.overlap.length > 0)).toBe(true);
    for (const [i, part] of parts.entries()) {
      expect(part.text.length).toBe(i < parts.length - 1 ? 4096 : text.length - 4096 * i);
      // The overlap repeats the start of the next record: all the rest of the record's last character.
      const next = parts[i + 1]?.text ?? new Uint8Array();
      expect(part.overlap).toEqual(next.subarray(0, part.overlap.length));
      expect((next[part.overlap.length] ?? 0) & 0xc0).not.toBe(0x80);
    }
    expect(() => decode(text)).not.toThrow();
  });

  it('handles every way a record boundary can split a four-byte character', async () => {
    const overlaps = new Set<number>();
    for (const shift of ['', 'x', 'xx', 'xxx']) {
      const content = `${shift}${'😀'.repeat(3000)}`;
      const emoji = await writeMobi({
        ...book,
        coverId: undefined,
        resources: [],
        chapters: [{ href: 'emoji.xhtml', html: `<p>${content}</p>` }],
        toc: [],
      });
      for (const part of textRecords(emoji)) overlaps.add(part.overlap.length);
      expect((await sectionDocument(await open(emoji), 0)).body.textContent).toBe(content);
    }
    expect([...overlaps].sort()).toEqual([0, 1, 2, 3]);
  });

  it('splits sections at the page breaks and keeps every chapter’s text intact', async () => {
    expect(mobi.sections).toHaveLength(book.chapters.length + 1); // the contents page, then each chapter
    for (const [i, chapter] of book.chapters.entries()) {
      const doc = await sectionDocument(mobi, i + 1);
      expect(normalize(doc.body.textContent)).toBe(normalize(parseChapter(chapter.html).body.textContent));
    }
  });

  it('turns markup into tags MOBI 6 knows', async () => {
    const first = await sectionDocument(mobi, 1);
    expect(first.querySelector('figure, figcaption')).toBeNull();
    expect(first.querySelector('[class], [style]')).toBeNull();
    expect(first.querySelector('h1')?.textContent).toBe('Premier chapitre');
    expect(first.querySelector('em')?.textContent).toBe('et');
    expect(first.querySelector('strong')?.textContent).toBe('trois');
    expect(first.querySelector('blockquote > p')?.textContent).toBe('Une citation');
    expect(first.querySelectorAll('ul > li')).toHaveLength(2);
    const second = await sectionDocument(mobi, 2);
    expect(second.querySelector('section')).toBeNull();
    expect(second.querySelector('[id]:not([id^="filepos"])')).toBeNull();
  });

  it('points internal links at their target’s byte offset', async () => {
    const first = await sectionDocument(mobi, 1);
    const link = Array.from(first.querySelectorAll('a[filepos]')).find((a) => a.textContent === 'la cible');
    const filepos = link?.getAttribute('filepos') ?? '';
    expect(filepos).toMatch(/^\d{10}$/);
    expect(decode(text.subarray(Number(filepos))).startsWith('<h3>La cible</h3>')).toBe(true);

    const [index, anchor] = mobi.splitTOCHref(`filepos:${filepos}`);
    expect(index).toBe(3);
    const target = (await sectionDocument(mobi, 3)).getElementById(anchor as string);
    expect(target?.nextElementSibling?.tagName).toBe('H3');
    expect(target?.nextElementSibling?.textContent).toBe('La cible');
  });

  it('keeps web and mail links, and only the text of links to missing chapters', async () => {
    const first = await sectionDocument(mobi, 1);
    expect(first.querySelector('a[href^="https:"]')?.getAttribute('href')).toBe('https://example.com/?a=1&b=2');
    expect(first.querySelector('a[href^="mailto:"]')?.textContent).toBe('un courriel');
    expect(Array.from(first.querySelectorAll('a')).map((a) => a.textContent)).not.toContain('un lien perdu');
    expect(first.body.textContent).toContain('un lien perdu');
  });

  it('starts with a contents page that foliate reads as the table of contents', () => {
    const labels = (items: MobiTocItem[] = []): unknown[] =>
      items.map((item) => (item.subitems?.length ? [item.label, labels(item.subitems)] : item.label));
    expect(labels(mobi.toc)).toEqual(['Premier chapitre', ['Deuxième chapitre', ['Au milieu']], 'Troisième chapitre']);
    const sections = (items: MobiTocItem[] = []): number[] =>
      items.flatMap((item) => [mobi.splitTOCHref(item.href)[0], ...sections(item.subitems)]);
    expect(sections(mobi.toc)).toEqual([1, 2, 2, 3]);

    const middle = mobi.toc?.[1]?.subitems?.[0]?.href.slice('filepos:'.length) ?? '';
    expect(decode(text.subarray(Number(middle))).startsWith('<h3>Au milieu</h3>')).toBe(true);
  });

  it('keeps the MOBI id across conversions', async () => {
    expect(mobi.metadata.identifier).toBe((await open(await writeMobi(book))).metadata.identifier);
    const again = await open(await writeMobi({ ...book, identifier: mobi.metadata.identifier }));
    expect(again.metadata.identifier).toBe(mobi.metadata.identifier);
  });

  it('writes a plain book without images or a table of contents', async () => {
    const plain: Book = {
      title: 'Plain',
      authors: [],
      language: 'en-GB',
      chapters: [
        { href: 'a.xhtml', html: '<p>First &amp; <b>only</b> <a href="#nowhere">page</a>.</p>' },
        // A soft hyphen, and "é" as "e" plus a combining accent.
        { href: 'b.xhtml', html: `<p>Second hy\xadphen, cafe${String.fromCodePoint(0x301)}.</p>` },
      ],
      resources: [],
      toc: [],
    };
    const output = await writeMobi(plain);
    const header = records(output)[0] as Uint8Array;
    expect(u32(header, 108)).toBe(0xffffffff); // no first image
    expect([header[94], header[95]]).toEqual([8, 9]); // English (9), Great Britain (2 × 4)
    const plainBook = await open(output);
    expect(plainBook.mobi.headers.exth?.coverOffset).toBeUndefined();
    expect(plainBook.toc).toBeUndefined();
    expect(plainBook.sections).toHaveLength(2);
    expect(normalize((await sectionDocument(plainBook, 0)).body.textContent)).toBe('First & only page.');
    expect(normalize((await sectionDocument(plainBook, 1)).body.textContent)).toBe('Second hyphen, caf\xe9.');
    // A link to a missing id goes to the start of its chapter.
    const filepos = (await sectionDocument(plainBook, 0)).querySelector('a[filepos]')?.getAttribute('filepos');
    const plainText = concat(textRecords(output).map((record) => record.text));
    expect(decode(plainText.subarray(Number(filepos))).startsWith('<p>First &amp; <b>only</b>')).toBe(true);
  });
});

describe('compressPalmDoc', () => {
  let seed = 7;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 24;
  };

  it('round-trips random, repetitive and binary data', () => {
    const encoder = new TextEncoder();
    const samples = [
      new Uint8Array(),
      Uint8Array.of(0x80),
      Uint8Array.of(0x20),
      Uint8Array.of(0x20, 0x41),
      Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0x7f, 0x80, 0xbf, 0xc0, 0xff),
      new Uint8Array(4096),
      new Uint8Array(4096).fill(0x20),
      new Uint8Array(4096).fill(0xff),
      Uint8Array.from({ length: 4096 }, (_, i) => i % 251),
      encoder.encode('Le café “crème” — 漢字 😀 '.repeat(200)).subarray(0, 4096),
      ...Array.from({ length: 200 }, () => Uint8Array.from({ length: random() * 16 + 1 }, random)),
      ...Array.from({ length: 20 }, () => Uint8Array.from({ length: 4096 }, random)),
      ...Array.from({ length: 20 }, () => Uint8Array.from({ length: 4096 }, () => (random() < 32 ? random() : 0x61))),
    ];
    for (const sample of samples) expect(decompressPalmDoc(compressPalmDoc(sample))).toEqual(sample);
  });

  it('compresses text', () => {
    const prose = new TextEncoder().encode(
      'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, '.repeat(
        40,
      ),
    );
    const chunk = prose.subarray(0, 4096);
    expect(compressPalmDoc(chunk).length).toBeLessThan(chunk.length / 3);
  });
});
