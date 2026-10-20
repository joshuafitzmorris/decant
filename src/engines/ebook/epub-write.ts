import {
  type Book,
  escapeXml,
  fallbackIdentifier,
  parseChapter,
  serializeChildren,
  type TocEntry,
  tocOrChapters,
} from './book';

/** A quiet, readable default; reading systems apply the reader's own font and size on top. */
const STYLESHEET = `body { margin: 0 5%; line-height: 1.5; widows: 2; orphans: 2; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.8em; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.6em; margin-top: 2.5em; }
p { margin: 0 0 0.6em; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 1.5em; }
pre { white-space: pre-wrap; font-size: 0.9em; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #999; padding: 0.25em 0.5em; vertical-align: top; }
hr { border: 0; margin: 1.5em 0; text-align: center; }
hr::after { content: "\\2042"; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-height: 100vh; }
`;

/** Writes an EPUB 3 file, with an EPUB 2 NCX so older readers get a table of contents too. */
export async function writeEpub(book: Book): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const identifier = book.identifier ?? fallbackIdentifier(book);
  const language = book.language || 'en';
  const title = book.title || 'Untitled';
  const cover = book.resources.find((r) => r.id === book.coverId);
  // Both navigation formats need at least one entry.
  const listed = tocOrChapters(book);
  const firstChapter = book.chapters[0];
  const toc = listed.length || !firstChapter ? listed : [{ title, href: firstChapter.href, children: [] }];
  const modified = `${new Date().toISOString().slice(0, 19)}Z`;

  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // Must come first and be stored uncompressed, so readers can sniff the format.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n',
    ),
    'OEBPS/style.css': strToU8(STYLESHEET),
  };

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
  ];
  const spine: string[] = [];

  if (cover) {
    files['OEBPS/cover.xhtml'] = strToU8(
      page(title, language, `<div class="cover"><img src="${escapeXml(cover.href)}" alt="${escapeXml(title)}"/></div>`),
    );
    manifest.push('<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover-page" linear="yes"/>');
  }
  for (const [i, chapter] of book.chapters.entries()) {
    // Re-parsing guarantees well-formed XHTML whatever the source was.
    const body = serializeChildren(parseChapter(chapter.html).body);
    files[`OEBPS/${chapter.href}`] = strToU8(page(chapter.title ?? title, language, body));
    manifest.push(`<item id="c${i + 1}" href="${escapeXml(chapter.href)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${i + 1}"/>`);
  }
  for (const resource of book.resources) {
    files[`OEBPS/${resource.href}`] = [resource.data, { level: 0 }];
    const properties = resource === cover ? ' properties="cover-image"' : '';
    manifest.push(
      `<item id="${escapeXml(resource.id)}" href="${escapeXml(resource.href)}" media-type="${escapeXml(resource.type)}"${properties}/>`,
    );
  }

  const metadata = [
    `<dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dc:language>${escapeXml(language)}</dc:language>`,
    ...book.authors.map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`),
    book.publisher && `<dc:publisher>${escapeXml(book.publisher)}</dc:publisher>`,
    book.description && `<dc:description>${escapeXml(book.description)}</dc:description>`,
    book.date && `<dc:date>${escapeXml(book.date)}</dc:date>`,
    `<meta property="dcterms:modified">${modified}</meta>`,
    cover && `<meta name="cover" content="${escapeXml(cover.id)}"/>`,
    '<meta name="generator" content="Decant"/>',
  ].filter(Boolean);

  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${metadata.join('\n    ')}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spine.join('\n    ')}
  </spine>
</package>
`);

  files['OEBPS/nav.xhtml'] = strToU8(
    page(
      'Contents',
      language,
      `<nav epub:type="toc" id="toc"><h1>Contents</h1>${navList(toc)}</nav>`,
      ' xmlns:epub="http://www.idpf.org/2007/ops"',
    ),
  );
  files['OEBPS/toc.ncx'] = strToU8(ncx(identifier, title, toc));

  return zipSync(files);
}

function page(title: string, language: string, body: string, namespaces = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"${namespaces} lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

function navList(entries: TocEntry[]): string {
  if (!entries.length) return '<ol><li><a href="nav.xhtml">Contents</a></li></ol>';
  const items = entries.map(
    (entry) =>
      `<li><a href="${escapeXml(entry.href)}">${escapeXml(entry.title)}</a>${entry.children.length ? navList(entry.children) : ''}</li>`,
  );
  return `<ol>${items.join('')}</ol>`;
}

function ncx(identifier: string, title: string, entries: TocEntry[]): string {
  let order = 0;
  let depth = 0;
  const points = (list: TocEntry[], level: number): string =>
    list
      .map((entry) => {
        order++;
        depth = Math.max(depth, level);
        return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeXml(entry.title)}</text></navLabel><content src="${escapeXml(entry.href)}"/>${points(entry.children, level + 1)}</navPoint>`;
      })
      .join('');
  const map = points(entries, 1);
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="${Math.max(1, depth)}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${map}</navMap>
</ncx>
`;
}
