#!/usr/bin/env node
/**
 * Generates the EPUB, FB2 and CBZ samples used by the tests. They are written
 * by hand here, independently of Decant's own writers, so the readers are
 * tested against files Decant didn't make.
 *
 * sample.mobi and sample.azw3 are real Kindle books from Project Gutenberg
 * (The Raven by Edgar Allan Poe, ebook #1065, public domain), kept as downloaded:
 * https://www.gutenberg.org/ebooks/1065
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const out = join(import.meta.dirname, '..', 'tests', 'fixtures');
const at = (name) => join(out, name);
const jpg = readFileSync(at('sample.jpg'));
const png = readFileSync(at('sample.png'));
const gif = readFileSync(at('sample.gif'));

// --- EPUB 3, with an EPUB 2 NCX and publisher-style CSS classes -----------------
const page = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../css/book.css"/></head>
<body>
${body}
</body>
</html>
`;
const epub = {
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`),
  'OPS/package.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5f0c5e3e-0b9a-4c55-9a1e-3c6f6d9a2b11</dc:identifier>
    <dc:title>The Decant Sample Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Decant Test Press</dc:publisher>
    <dc:description>&lt;p&gt;A tiny book for testing &lt;b&gt;ebook&lt;/b&gt; conversions.&lt;/p&gt;</dc:description>
    <meta property="dcterms:modified">2026-10-19T00:00:00Z</meta>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="css/book.css" media-type="text/css"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="figure" href="images/figure.png" media-type="image/png"/>
    <item id="ch1" href="text/chapter-one.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter-two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>
`),
  'OPS/css/book.css': strToU8(`@charset "utf-8";
@font-face { font-family: "Book"; src: url(../fonts/book.otf); }
p { text-indent: 1em; margin: 0; }
.ital { font-style: italic; }
.bold-word { font-weight: 700; }
p.centred { text-align: center; }
.hidden { display: none; }
@media amzn-kf8 { .ital { font-style: normal; } }
`),
  'OPS/nav.xhtml': strToU8(
    page(
      'Contents',
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
  <li><a href="text/chapter-one.xhtml">Chapter One: Arrival</a></li>
  <li><a href="text/chapter-two.xhtml">Chapter Two: Departure</a><ol><li><a href="text/chapter-two.xhtml#letter">The letter</a></li></ol></li>
</ol></nav>`,
    ).replace('../css/book.css', 'css/book.css'),
  ),
  'OPS/toc.ncx': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:5f0c5e3e-0b9a-4c55-9a1e-3c6f6d9a2b11"/></head>
  <docTitle><text>The Decant Sample Book</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Chapter One: Arrival</text></navLabel><content src="text/chapter-one.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Chapter Two: Departure</text></navLabel><content src="text/chapter-two.xhtml"/></navPoint>
  </navMap>
</ncx>
`),
  'OPS/images/cover.jpg': [jpg, { level: 0 }],
  'OPS/images/figure.png': [png, { level: 0 }],
  'OPS/text/chapter-one.xhtml': strToU8(
    page(
      'Chapter One',
      `<section epub:type="chapter">
<h1>Chapter One: Arrival</h1>
<p>It was a <span class="ital">dark and stormy</span> night, and the <span class="bold-word">engine</span> hummed.</p>
<p class="centred">* * *</p>
<p>Café, naïve, “quoted” — and an em dash.</p>
<p class="hidden">This paragraph is hidden by the stylesheet.</p>
<figure><img src="../images/figure.png" alt="A test pattern"/><figcaption>Figure 1. A test pattern.</figcaption></figure>
<p>Read <a href="chapter-two.xhtml#letter">the letter</a> or visit <a href="https://example.com/">example.com</a>.</p>
<script>alert('scripts are removed')</script>
</section>`,
    ),
  ),
  'OPS/text/chapter-two.xhtml': strToU8(
    page(
      'Chapter Two',
      `<h1>Chapter Two: Departure</h1>
<p>They left at dawn.</p>
<blockquote><p id="letter">Dear Charles, the Analytical Engine weaves algebraic patterns.</p></blockquote>
<ul><li>First thing</li><li>Second thing</li></ul>`,
    ),
  ),
};
writeFileSync(at('sample.epub'), zipSync(epub));

// --- FictionBook 2, with a footnote, a cover and Cyrillic text --------------------
const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
  <title-info>
    <genre>prose_classic</genre>
    <author><first-name>Anton</first-name><last-name>Chekhov</last-name></author>
    <book-title>Decant FB2 Sample</book-title>
    <annotation><p>A short FictionBook for testing.</p></annotation>
    <coverpage><image l:href="#cover.jpg"/></coverpage>
    <lang>en</lang>
  </title-info>
  <document-info><author><nickname>tests</nickname></author><id>fb2-sample-1</id><version>1.0</version></document-info>
</description>
<body>
  <title><p>Decant FB2 Sample</p></title>
  <section id="s1">
    <title><p>Chapter 1</p></title>
    <epigraph><p>Brevity is the sister of talent.</p><text-author>A. Chekhov</text-author></epigraph>
    <p>The <emphasis>first</emphasis> chapter has <strong>bold</strong> text and a note<a l:href="#n1" type="note">[1]</a>.</p>
    <empty-line/>
    <p>Привет, мир. Здравствуйте!</p>
    <image l:href="#figure.png"/>
  </section>
  <section id="s2">
    <title><p>Chapter 2</p></title>
    <subtitle>* * *</subtitle>
    <poem><stanza><v>A line of verse,</v><v>and another.</v></stanza></poem>
    <p>Back to <a l:href="#s1">chapter one</a>.</p>
  </section>
</body>
<body name="notes">
  <title><p>Notes</p></title>
  <section id="n1"><title><p>1</p></title><p>The note's text.</p></section>
</body>
<binary id="cover.jpg" content-type="image/jpeg">${jpg.toString('base64')}</binary>
<binary id="figure.png" content-type="image/png">${png.toString('base64')}</binary>
</FictionBook>
`;
writeFileSync(at('sample.fb2'), fb2);

// --- A comic archive whose page names need natural sorting ---------------------
writeFileSync(
  at('sample.cbz'),
  zipSync({
    'Comic/page 1.png': [png, { level: 0 }],
    'Comic/page 2.jpg': [jpg, { level: 0 }],
    'Comic/page 10.gif': [gif, { level: 0 }],
    'Comic/ComicInfo.xml': strToU8('<?xml version="1.0"?><ComicInfo><Title>Sample</Title></ComicInfo>'),
  }),
);

console.log(`Ebook fixtures written to ${out}`);
