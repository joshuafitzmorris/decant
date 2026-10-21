import { displayName } from '../../core/formats';
import { abortError, ConversionError, type ConvertedFile, type ConvertRequest } from '../types';
import type { Book } from './book';

/** Picture types EPUB readers and browsers all show. */
const WEB_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Ebooks: EPUB, Kindle (MOBI and AZW3), FictionBook and comic archives, plus
 * Word, Markdown, HTML, text and PDF as sources. Every book is read into one
 * model and written out from it. Parsing runs on the page because it needs a
 * real DOM; typesetting PDFs happens in a worker.
 */
export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  const { file, from, to, options, signal, onProgress } = request;
  if (from === 'cbz') {
    const { cbzToPdf } = await import('./cbz');
    return [{ blob: await cbzToPdf(request) }];
  }
  if (to === 'cbz') {
    const { pdfToCbz } = await import('./cbz');
    return [{ blob: await pdfToCbz(request) }];
  }

  onProgress(null, 'Reading the book');
  const fallbackTitle =
    file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .trim() || 'Untitled';
  const book = await readBook(file, from, fallbackTitle, signal, onProgress);
  if (!book.title) book.title = fallbackTitle;
  if (signal.aborted) throw abortError();
  onProgress(null, `Writing ${displayName(to)}`);

  const { convertImages } = await import('./images');
  switch (to) {
    case 'epub': {
      const { writeEpub } = await import('./epub-write');
      const ready = await convertImages(book, WEB_IMAGES, 'png', signal);
      return [output(await writeEpub(ready), 'application/epub+zip')];
    }
    case 'mobi': {
      const { writeMobi } = await import('./mobi-write');
      // Older Kindles only show JPEG and GIF, and choke on pictures over about 127 KB.
      const ready = await convertImages(book, ['image/jpeg', 'image/gif'], 'jpg', signal, 127 * 1024);
      return [output(await writeMobi(ready), 'application/x-mobipocket-ebook')];
    }
    case 'fb2': {
      const { writeFb2 } = await import('./fb2-write');
      const ready = await convertImages(book, ['image/jpeg', 'image/png'], 'png', signal);
      return [output(writeFb2(ready), 'application/x-fictionbook+xml')];
    }
    case 'pdf': {
      const { bookToPdf } = await import('./pdf');
      return [{ blob: await bookToPdf(book, options, signal, onProgress) }];
    }
    case 'txt': {
      const { bookToText } = await import('./text');
      return [output(bookToText(book), 'text/plain;charset=utf-8')];
    }
    case 'md': {
      const { bookToMarkdown } = await import('./text');
      return [output(await bookToMarkdown(book), 'text/markdown;charset=utf-8')];
    }
    case 'html': {
      const { bookToHtml } = await import('./text');
      const ready = await convertImages(book, WEB_IMAGES, 'png', signal);
      return [output(bookToHtml(ready), 'text/html;charset=utf-8')];
    }
    default:
      throw new ConversionError(`Decant can’t make ${displayName(to)} from this book yet.`);
  }
}

async function readBook(
  file: File,
  from: string,
  fallbackTitle: string,
  signal: AbortSignal,
  onProgress: ConvertRequest['onProgress'],
): Promise<Book> {
  switch (from) {
    case 'epub':
      return (await import('./epub-read')).readEpub(file);
    case 'mobi':
    case 'azw3':
      return (await import('./mobi-read')).readMobi(file);
    case 'fb2':
      return (await import('./fb2-read')).readFb2(file);
    case 'pdf':
      return (await import('./from-pdf')).pdfToBook(file, fallbackTitle, signal, onProgress);
    case 'docx':
    case 'md':
    case 'html':
    case 'txt':
      return (await import('./from-document')).documentToBook(file, from, fallbackTitle);
    default:
      throw new ConversionError(`Decant can’t read ${from.toUpperCase()} as a book.`);
  }
}

function output(content: Uint8Array | string, type: string): ConvertedFile {
  return { blob: new Blob([content as BlobPart], { type }) };
}
