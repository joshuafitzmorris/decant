import { extensionOf, type FormatId, formatFromExtension } from '../../core/formats';
import { ConversionError, type ConvertRequest } from '../types';

const PAGE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

/** A comic archive's pages, in reading order, become a PDF with one page per picture. */
export async function cbzToPdf({ file, signal, onProgress }: ConvertRequest): Promise<Blob> {
  const { unzipSync } = await import('fflate');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => PAGE.test(entry.name) && !entry.name.startsWith('__MACOSX/') && !/(^|\/)\./.test(entry.name),
    });
  } catch {
    throw new ConversionError(
      'This comic archive couldn’t be opened. It may be damaged, or be a RAR file renamed to CBZ.',
    );
  }
  // "page 2" sorts before "page 10", the way people number files.
  const names = Object.keys(entries).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
  if (!names.length) throw new ConversionError('This comic archive has no pictures in it.');
  const sources = names.map((name) => formatFromExtension(extensionOf(name))?.id as FormatId);
  const blobs = names.map((name) => new Blob([entries[name] as BlobPart]));
  const { imagesToPdf } = await import('../pdf');
  return imagesToPdf(blobs, sources[0] as FormatId, { page: 'image' }, { signal, onProgress }, sources);
}

/** Each PDF page becomes a JPEG in a comic archive. */
export async function pdfToCbz(request: ConvertRequest): Promise<Blob> {
  const { pdfToImages } = await import('../pdf');
  const pages = await pdfToImages({
    ...request,
    to: 'jpg',
    options: { dpi: request.options.dpi ?? '150', quality: request.options.quality ?? 85, pages: 'all' },
  });
  const { zipSync } = await import('fflate');
  const digits = String(pages.length).length;
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const [i, page] of pages.entries()) {
    // JPEGs are already compressed, so they're stored as they are.
    files[`page-${String(i + 1).padStart(Math.max(3, digits), '0')}.jpg`] = [
      new Uint8Array(await page.blob.arrayBuffer()),
      { level: 0 },
    ];
  }
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.comicbook+zip' });
}
