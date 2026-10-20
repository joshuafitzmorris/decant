import type { FormatId } from '../../../core/formats';
import type { Options } from '../../../core/options';
import { WorkerPool } from '../../../lib/worker-pool';
import { abortError, type ProgressFn } from '../../types';
import { type Book, imageTypeFromBytes, type Resource } from '../book';
import { bookToPrint, type PrintBook, type PrintImage } from './blocks';
import type { PageSize } from './typeset';
import type { TypesetTask } from './typeset.worker';

const pool = new WorkerPool(
  () => new Worker(new URL('./typeset.worker.ts', import.meta.url), { type: 'module', name: 'decant-typeset' }),
  1,
);

const PAGE_SIZES: readonly PageSize[] = ['a5', 'a4', 'letter', '6x9'];
/** Pictures PDF can't hold as they are, and the image engine's name for each. */
const TRANSCODED: Record<string, FormatId> = {
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/**
 * Typesets a book as a PDF. Reading the chapters needs the page's DOM; setting
 * and writing the pages happens in a worker, which keeps going in background tabs.
 */
export async function bookToPdf(
  book: Book,
  options: Options,
  signal: AbortSignal,
  onProgress: ProgressFn,
): Promise<Blob> {
  if (book.resources.length) onProgress(null, 'Preparing pictures');
  const print = await bookToPrint(book, (resource) => prepareImage(resource, signal));
  if (signal.aborted) throw abortError();
  const page = PAGE_SIZES.find((size) => size === options.page) ?? 'a5';
  const task: TypesetTask = { print, page };
  const bytes = await pool.run<Uint8Array>(task, { signal, onProgress, transfer: pictureBuffers(print) });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** JPEG and PNG go into the PDF as they are; other pictures become PNG first. */
async function prepareImage(resource: Resource, signal: AbortSignal): Promise<PrintImage | null> {
  const type = imageTypeFromBytes(resource.data) ?? resource.type;
  if (type === 'image/jpeg' || type === 'image/png') {
    // A copy, so the worker can take the bytes without emptying the book's own.
    const data = resource.data.slice();
    const size = type === 'image/jpeg' ? jpegSize(data) : pngSize(data);
    return size ? { type: type === 'image/jpeg' ? 'jpg' : 'png', data, ...size } : null;
  }
  const from = TRANSCODED[type];
  if (!from) return null;
  const { transcodeImage } = await import('../../image');
  const png = await transcodeImage(
    new Blob([resource.data as BlobPart], { type }),
    from,
    'png',
    { size: 'original' },
    signal,
  );
  const data = new Uint8Array(await png.arrayBuffer());
  const size = pngSize(data);
  return size ? { type: 'png', data, ...size } : null;
}

type Size = { width: number; height: number };

/** The IHDR chunk always comes first, right after the signature. */
function pngSize(data: Uint8Array): Size | null {
  if (data.length < 24) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width && height ? { width, height } : null;
}

/** Walks the JPEG's segments to its start-of-frame header, which holds the size. */
function jpegSize(data: Uint8Array): Size | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 2;
  while (i + 9 < data.length) {
    if (view.getUint8(i) !== 0xff) return null;
    const marker = view.getUint8(i + 1);
    if (marker === 0xff) {
      i++; // Padding between segments.
      continue;
    }
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = view.getUint16(i + 5);
      const width = view.getUint16(i + 7);
      return width && height ? { width, height } : null;
    }
    i += 2 + view.getUint16(i + 2);
  }
  return null;
}

/** Each picture's bytes, once: the same picture may appear on many pages. */
function pictureBuffers(print: PrintBook): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  if (print.cover) buffers.add(print.cover.data.buffer as ArrayBuffer);
  for (const chapter of print.chapters) {
    for (const block of chapter.blocks) if (block.kind === 'image') buffers.add(block.image.data.buffer as ArrayBuffer);
  }
  return [...buffers];
}
