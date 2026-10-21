import { CATEGORY_NAMES, type Category, displayName, FORMATS, type FormatId, isFormatId } from './formats';
import { canConvert, readableFormats, targetsFor } from './routes';

/**
 * Words for search engines and answer engines: every page's title and
 * description, what each format is, how-to steps and FAQs. The same text is
 * rendered on the page and in its structured data, so the two always agree.
 */

/** One or two plain sentences on what each format is and when people meet it. */
export const FORMAT_ABOUT: Record<FormatId, string> = {
  jpg: 'JPG (JPEG) is the most widely supported photo format. Its lossy compression keeps photos small at the cost of a little detail.',
  png: 'PNG is a lossless image format with transparency, the usual choice for screenshots, logos and graphics with sharp edges.',
  webp: 'WebP is Google’s image format for the web: smaller than JPG or PNG at the same quality, with transparency. Some older apps can’t open it.',
  avif: 'AVIF is a modern image format built on the AV1 video codec. Files are much smaller than JPG at the same quality, but older software may not open them.',
  heic: 'HEIC (HEIF) is the format iPhones and iPads save photos in. It’s about half the size of a JPG, but Windows, Android and many websites can’t open it.',
  gif: 'GIF is the classic format for short animations and simple graphics. It allows only 256 colours per frame, so photos look grainy and animations get large.',
  jxl: 'JPEG XL is a newer image format that compresses better than JPG and can repack existing JPGs without loss. Few browsers and apps support it yet.',
  tiff: 'TIFF is a high-quality image format for scanning, printing and archiving photos. Files are large, and most websites won’t show them.',
  bmp: 'BMP is the uncompressed bitmap format from early Windows. Files are very large, and these days it mostly turns up in older software.',
  ico: 'ICO is the Windows icon format, used for website favicons. One file can hold the same icon at several sizes.',
  svg: 'SVG is a vector image format made of shapes and text, so it stays sharp at any size. It’s used for logos, icons and illustrations.',
  mp3: 'MP3 is the most widely supported audio format. Its lossy compression keeps files small, and it plays on practically every device.',
  wav: 'WAV is uncompressed audio, exactly as recorded. The quality is as good as it gets, but files are about ten times the size of an MP3.',
  flac: 'FLAC is lossless compressed audio: the same quality as WAV at around half the size. Not every device or app plays it.',
  m4a: 'M4A is AAC audio in an MP4 container, the format iTunes and Apple Music use. It sounds better than MP3 at the same file size.',
  aac: 'AAC is the audio codec behind M4A and most streaming services. A .aac file holds the bare audio stream, without a container.',
  ogg: 'OGG (Ogg Vorbis) is an open, royalty-free audio format often used in games and some music services.',
  opus: 'Opus is a modern, open audio codec that handles speech and music efficiently. Many calling and messaging apps use it for voice.',
  aiff: 'AIFF is Apple’s uncompressed audio format, the Mac counterpart to WAV, common in music production.',
  wma: 'WMA is Microsoft’s older Windows Media Audio format. Many current devices and apps can’t play it.',
  mp4: 'MP4 is the most widely supported video format. It plays on phones, in browsers and on TVs, and opens in almost every editing app.',
  mov: 'MOV is Apple’s QuickTime video format, used by iPhones and Macs. iPhone videos are often HEVC, which some Windows apps and websites can’t play.',
  webm: 'WebM is an open video format for the web, using VP8, VP9 or AV1 video. Browsers play it, but many editors and Apple apps don’t.',
  mkv: 'MKV (Matroska) is a flexible video container that can hold several audio and subtitle tracks. It’s common for films, but many devices won’t play it.',
  avi: 'AVI is an old Microsoft video container. Files are often large, and many modern players and phones can’t open them.',
  wmv: 'WMV is Microsoft’s older Windows Media Video format, rarely supported outside Windows.',
  flv: 'FLV is the old Flash video format used by early video sites. Nothing modern plays it on its own.',
  ts: 'TS (MPEG transport stream, including .m2ts and .mts files) comes from camcorders, Blu-ray discs and TV recordings.',
  mpg: 'MPG (MPEG-1 and MPEG-2) is an older video format found on DVDs (as .vob files) and in early digital video.',
  '3gp': '3GP is the video format of older mobile phones: small files at low resolution.',
  pdf: 'PDF keeps a document’s exact layout on every device. It’s the standard for sharing papers, forms and print-ready files, but it’s hard to edit.',
  docx: 'DOCX is Microsoft Word’s document format, used for most letters, reports and manuscripts.',
  md: 'Markdown is plain text with simple formatting marks, such as # for headings. It’s used for notes, README files and writing for the web.',
  html: 'HTML is the language of web pages. Saved pages and exported documents often arrive as .html files.',
  txt: 'TXT is plain text without formatting. It opens in any app, on any device.',
  epub: 'EPUB is the standard ebook format, read by Apple Books, Kobo, Google Play Books and most e-readers. Kindles take it through Send to Kindle.',
  mobi: 'MOBI is the original Kindle ebook format. Older Kindles read it directly, but Amazon no longer accepts it through Send to Kindle.',
  azw3: 'AZW3 (KF8) is Amazon’s newer Kindle format, with better styling than MOBI. Only Kindle devices and apps open it.',
  fb2: 'FB2 (FictionBook) is an XML ebook format popular in Russia and Eastern Europe, read by apps such as FBReader and Moon+ Reader.',
  cbz: 'CBZ is a comic book archive: a ZIP of page images in reading order, opened by comic readers such as CDisplayEx and YACReader.',
  csv: 'CSV stores a table as plain text, one row per line with commas between values. Every spreadsheet and database can open it.',
  tsv: 'TSV is like CSV but separated by tabs, which avoids trouble with commas inside values.',
  xlsx: 'XLSX is Microsoft Excel’s workbook format, with multiple sheets, formatting and formulas.',
  xls: 'XLS is the Excel 97–2003 workbook format, still produced by some older systems.',
  ods: 'ODS is the OpenDocument spreadsheet format used by LibreOffice and OpenOffice.',
  json: 'JSON is the data format of web APIs and app settings: nested objects and lists in plain text.',
  yaml: 'YAML is a readable data format for configuration files, such as Docker Compose files and GitHub Actions workflows.',
  toml: 'TOML is a simple configuration format used by tools like Cargo, Python’s pyproject.toml and Hugo.',
  xml: 'XML is a structured text format for documents and data exchange, used in feeds, office files and many business systems.',
};

/** Extra, accurate notes for conversions people ask specific questions about. */
const PAIR_NOTES: Partial<Record<string, string>> = {
  'heic>jpg':
    'The JPG is made on your device, so private photos never leave it. Camera and location details aren’t copied into the new file.',
  'heic>png':
    'PNG keeps every pixel of the photo, but files are larger than JPG. Pick JPG if you’re just sharing photos.',
  'webp>png': 'PNG keeps transparency, so logos and stickers saved as WebP keep their clear background.',
  'webp>jpg':
    'JPG can’t store transparency, so clear areas are filled with white unless you pick another background colour.',
  'png>jpg': 'JPG has no transparency, so transparent areas are filled with white or a colour you choose.',
  'mov>mp4':
    'When the video is already H.264, Decant copies it into MP4 without re-encoding, which takes a moment even for long clips. HEVC iPhone videos are converted to H.264 so they play everywhere.',
  'mkv>mp4':
    'When the streams inside are H.264 and AAC, Decant repackages them without re-encoding, so the conversion is near-instant and lossless.',
  'mp4>mp3': 'Only the soundtrack is kept. Pick a bitrate, or leave it on Auto for high quality.',
  'mp4>gif': 'Pick a width and frame rate, and trim to the part you want: GIFs grow quickly with length.',
  'gif>mp4': 'An MP4 is usually a fraction of the size of the GIF, and plays everywhere a GIF does.',
  'pdf>jpg':
    'Each page becomes its own JPG, and they’re saved together as a ZIP. 150 dpi suits screens, and 300 dpi suits printing.',
  'pdf>png':
    'Each page becomes its own PNG, and they’re saved together as a ZIP. 150 dpi suits screens, and 300 dpi suits printing.',
  'epub>pdf':
    'The book is typeset like a paperback, with the cover, a title page, chapters starting on new pages, page numbers and bookmarks for each chapter.',
  'pdf>epub':
    'Decant rebuilds the text into reflowable chapters using the PDF’s bookmarks, so it reads well on any screen. Pictures aren’t carried over, and scanned PDFs have no text to extract.',
  'epub>mobi':
    'Newer Kindles read EPUB through Amazon’s Send to Kindle, so a MOBI is mainly useful for copying to older Kindles over USB.',
  'mobi>epub':
    'The text, pictures, cover and table of contents carry over. Books bought with DRM from the Kindle Store can’t be converted.',
  'azw3>epub':
    'The text, pictures, cover and table of contents carry over. Books bought with DRM from the Kindle Store can’t be converted.',
  'cbz>pdf':
    'Pages are sorted the way people number them, so page 2 comes before page 10, and each picture becomes one PDF page.',
  'docx>md': 'Headings, lists, links, bold, italics and tables become Markdown.',
  'json>csv':
    'Each object in a JSON list becomes a row. Nested objects become dotted columns such as address.city, and lists are written as JSON text.',
};

export interface Faq {
  question: string;
  answer: string;
}

const readable = () => readableFormats();
export const formatCount = () => FORMATS.length;
export const conversionCount = () => readable().reduce((sum, from) => sum + targetsFor(from).length, 0);

const CATEGORY_LIST: Category[] = ['image', 'audio', 'video', 'document', 'ebook', 'data'];
const categoryWords = 'images, audio, video, documents, ebooks and spreadsheets';

const SEVERAL_AT_ONCE =
  'Yes. Add as many as you like and they convert together. Save each result on its own, or all of them as one ZIP.';

export function siteFaq(): Faq[] {
  return [
    {
      question: 'Is Decant free?',
      answer:
        'Yes. There are no ads, no paid tier, no account and no limit on how many files you convert. The code is open source under the MIT licence.',
    },
    {
      question: 'Are my files uploaded anywhere?',
      answer:
        'No. Everything happens inside your browser tab. The page’s security policy only allows connections back to decant.dev, so the browser would block any attempt to send your files elsewhere.',
    },
    {
      question: 'Is there a file size limit?',
      answer:
        'Only your device’s memory. Very large videos are written to the browser’s private storage instead of being held in memory.',
    },
    {
      question: 'Does Decant work offline?',
      answer: 'Yes. Once the page has loaded, any converter you’ve used keeps working without a connection.',
    },
    {
      question: 'Which formats can Decant convert?',
      answer: `${formatCount()} formats across ${categoryWords}, with ${conversionCount()} conversions between them, including HEIC, WebP, MP4, MOV, MP3, PDF, EPUB, MOBI, Word and Excel files.`,
    },
    {
      question: 'Can Decant convert Kindle books?',
      answer:
        'Yes. DRM-free MOBI and AZW3 books convert to EPUB, PDF and more, and EPUB converts to MOBI for older Kindles. Books with Kindle Store DRM can’t be converted.',
    },
    {
      question: 'Which browsers does Decant work in?',
      answer:
        'Current versions of Chrome, Edge and Safari, including Safari on iPhone. It’s tested in Chrome and in WebKit, Safari’s engine, and Edge shares Chrome’s engine. Firefox isn’t tested yet.',
    },
    {
      question: 'Who makes Decant, and how does it make money?',
      answer:
        'Joshua Fitz-Morris, a software engineer in Vancouver. The code is on GitHub. It doesn’t make money: it’s a static site with no servers to pay for, so it stays free. If you find it useful, you can buy him a coffee.',
    },
  ];
}

export function pairFaq(from: FormatId, to: FormatId): Faq[] {
  const s = displayName(from);
  const t = displayName(to);
  const faqs: Faq[] = [
    {
      question: `How do I convert ${s} to ${t}?`,
      answer: `Choose your ${s} files or drop them on this page, check that ${t} is selected, then select Convert and save the result. It works the same on a phone or a computer.`,
    },
    {
      question: `Is it safe to convert ${s} to ${t} here?`,
      answer: `Yes. The conversion runs in your browser, so your ${s} files are never uploaded, stored or logged.`,
    },
  ];
  const note = PAIR_NOTES[`${from}>${to}`];
  if (note) faqs.push({ question: `What should I know about converting ${s} to ${t}?`, answer: note });
  faqs.push({ question: `Can I convert several ${s} files at once?`, answer: SEVERAL_AT_ONCE });
  return faqs;
}

export function formatFaq(format: FormatId): Faq[] {
  const s = displayName(format);
  const targets = targetsFor(format).map(displayName);
  return [
    {
      question: `How do I convert ${s} files?`,
      answer: `Choose your ${s} files or drop them on this page, pick a format (${list(targets)}), then select Convert and save the results.`,
    },
    {
      question: `Is it safe to convert ${s} files here?`,
      answer: `Yes. Decant converts ${s} files in your browser, so they’re never uploaded, stored or logged.`,
    },
    { question: `Can I convert many ${s} files at once?`, answer: SEVERAL_AT_ONCE },
  ];
}

export function pairSteps(from: FormatId, to: FormatId): string[] {
  const s = displayName(from);
  const t = displayName(to);
  return [
    `Choose your ${s} files, or drop them anywhere on this page.`,
    `Check that ${t} is selected, and change the settings if you need to.`,
    `Select Convert, then save your ${t} files.`,
  ];
}

/** What the two formats are; the pair's own note is answered in its FAQ instead. */
export function pairAbout(from: FormatId, to: FormatId): string[] {
  return [FORMAT_ABOUT[from], FORMAT_ABOUT[to]];
}

// ---------------------------------------------------------------------------
// Pages

export type Route =
  | { kind: 'home' }
  | { kind: 'pair'; from: FormatId; to: FormatId }
  | { kind: 'format'; format: FormatId };

/** Reads the page from a path like "/heic-to-jpg/" or "/epub-converter/". */
export function routeFromPath(pathname: string, base: string): Route {
  const rest = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname).toLowerCase();
  const pair = /^([a-z0-9]+)-to-([a-z0-9]+)\/?$/.exec(rest);
  if (pair) {
    const [, from, to] = pair;
    if (from && to && isFormatId(from) && isFormatId(to) && canConvert(from, to)) return { kind: 'pair', from, to };
  }
  const hub = /^([a-z0-9]+)-converter\/?$/.exec(rest);
  if (hub?.[1] && isFormatId(hub[1]) && targetsFor(hub[1]).length) return { kind: 'format', format: hub[1] };
  return { kind: 'home' };
}

export function routePath(route: Route): string {
  if (route.kind === 'pair') return `${route.from}-to-${route.to}/`;
  if (route.kind === 'format') return `${route.format}-converter/`;
  return '';
}

export interface PageMeta {
  title: string;
  description: string;
  /** The page's main heading (read by screen readers and search engines). */
  heading: string;
}

export function pageMeta(route: Route): PageMeta {
  if (route.kind === 'pair') {
    const s = displayName(route.from);
    const t = displayName(route.to);
    return {
      title: `${s} to ${t} converter: free, no upload | Decant`,
      description: `Convert ${s} to ${t} for free in your browser. Your files never leave your device, and there are no ads, accounts or size limits.`,
      heading: `Convert ${s} to ${t}`,
    };
  }
  if (route.kind === 'format') {
    const s = displayName(route.format);
    return {
      title: `${s} converter: free, private, no upload | Decant`,
      description: `Convert ${s} files to ${someTargets(route.format, 4)} for free in your browser. Nothing is uploaded, and there are no ads, accounts or size limits.`,
      heading: `${s} converter`,
    };
  }
  return {
    title: 'Decant: a free file converter that never uploads your files',
    description: `A free converter for ${formatCount()} formats of ${categoryWords}. It runs in your browser, so your files never leave your device.`,
    heading: 'Decant converts files in your browser',
  };
}

/** "JPG, PNG, WebP and more", or every target when there are only a few. */
export function someTargets(format: FormatId, count: number): string {
  const targets = targetsFor(format).map(displayName);
  return targets.length > count ? `${targets.slice(0, count).join(', ')} and more` : list(targets);
}

export function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Readable formats by category, for the formats table and llms.txt. */
export function readableByCategory(): [Category, FormatId[]][] {
  const formats = new Set(readable());
  return CATEGORY_LIST.map((category) => [
    category,
    FORMATS.filter((f) => f.category === category && formats.has(f.id)).map((f) => f.id as FormatId),
  ]);
}

export const categoryName = (category: Category) => CATEGORY_NAMES[category];
