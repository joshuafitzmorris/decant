import type { FormatId } from '../../core/formats';
import type { Options } from '../../core/options';
import { abortError, ConversionError, type ConvertedFile, type ConvertRequest } from '../types';

export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  if (request.from === 'pdf') {
    if (request.to === 'txt') return [{ blob: await pdfToText(request) }];
    return pdfToImages(request);
  }
  return [{ blob: await imagesToPdf([request.file], request.from, request.options, request) }];
}

// ---------------------------------------------------------------------------
// Reading PDFs (pdf.js)

const vendor = (path: string) => `${import.meta.env.BASE_URL}vendor/pdfjs/${path}`;

async function openPdf(file: Blob) {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: vendor('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendor('standard_fonts/'),
    wasmUrl: vendor('wasm/'),
    iccUrl: vendor('iccs/'),
    enableXfa: false,
  });
  try {
    return await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new ConversionError('This PDF is password-protected. Remove the password and try again.', 'password');
    }
    throw new ConversionError("This PDF couldn't be opened. It may be damaged.", 'invalid');
  }
}

async function pdfToImages({ file, to, options, signal, onProgress }: ConvertRequest): Promise<ConvertedFile[]> {
  const pdf = await openPdf(file);
  const { encodeBitmap } = await import('../image');
  try {
    const dpi = Number(options.dpi) || 150;
    const pageCount = options.pages === 'first' ? 1 : pdf.numPages;
    const digits = String(pageCount).length;
    const encoded: Promise<Blob>[] = [];
    let finished = 0;

    for (let n = 1; n <= pageCount; n++) {
      if (signal.aborted) throw abortError();
      onProgress(finished / pageCount, `Page ${n} of ${pageCount}`);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      if (canvas.width * canvas.height > (16384 * 16384) / 2) {
        throw new ConversionError(
          'These pages are too large to render at that resolution. Pick a lower one.',
          'too-large',
        );
      }
      // The print intent renders without requestAnimationFrame, so it keeps going in background tabs.
      await page.render({ canvas, viewport, background: '#ffffff', intent: 'print' }).promise;
      page.cleanup();
      // Rendering continues while a worker encodes this page.
      const bitmap = await createImageBitmap(canvas);
      canvas.width = 0;
      canvas.height = 0;
      const task = encodeBitmap(bitmap, to, { quality: options.quality ?? 85 }, signal).then((blob) => {
        finished++;
        onProgress(finished / pageCount, `Page ${Math.min(finished + 1, pageCount)} of ${pageCount}`);
        return blob;
      });
      // Failures surface through Promise.all below; this only silences early-exit warnings.
      task.catch(() => {});
      encoded.push(task);
      // Keep a few pages in flight, not the whole document's pixels.
      if (encoded.length - finished > 3) await encoded[encoded.length - 4];
    }

    const blobs = await Promise.all(encoded);
    onProgress(1);
    return blobs.map((blob, i) => ({
      blob,
      suffix: pageCount > 1 ? `-page-${String(i + 1).padStart(digits, '0')}` : '',
    }));
  } finally {
    await pdf.loadingTask.destroy();
  }
}

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

async function pdfToText({ file, signal, onProgress }: ConvertRequest): Promise<Blob> {
  const pdf = await openPdf(file);
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (signal.aborted) throw abortError();
      onProgress((n - 1) / pdf.numPages, `Page ${n} of ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items as TextItem[]));
      page.cleanup();
    }
    const text = pages
      .join('\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    if (!text) {
      throw new ConversionError(
        'This PDF has no selectable text. It is probably a scan; convert it to PNG or JPG instead.',
        'no-text',
      );
    }
    return new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Rebuilds lines from positioned text runs: a change in baseline starts a new line. */
export function joinTextItems(items: TextItem[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const item of items) {
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += item.str;
    if (item.hasEOL && !out.endsWith('\n')) out += '\n';
    if (y !== null) lastY = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing PDFs (pdf-lib)

const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MARGIN = 36;

export async function imagesToPdf(
  files: Blob[],
  from: FormatId,
  options: Options,
  { signal, onProgress }: Pick<ConvertRequest, 'signal' | 'onProgress'>,
  sources?: FormatId[],
): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setProducer('Decant');
  doc.setCreator('Decant');

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw abortError();
    onProgress(i / files.length, files.length > 1 ? `Image ${i + 1} of ${files.length}` : 'Building PDF');
    const file = files[i] as Blob;
    const source = sources?.[i] ?? from;
    // JPEG and PNG embed as-is (no re-encoding, no quality loss); everything else becomes PNG first.
    let bytes: Uint8Array;
    let kind: 'jpg' | 'png';
    if (source === 'jpg' || source === 'png') {
      bytes = new Uint8Array(await file.arrayBuffer());
      kind = source;
    } else {
      const { transcodeImage } = await import('../image');
      const png = await transcodeImage(file, source, 'png', { size: 'original' }, signal);
      bytes = new Uint8Array(await png.arrayBuffer());
      kind = 'png';
    }
    const image = await (kind === 'jpg' ? doc.embedJpg(bytes) : doc.embedPng(bytes)).catch(() => {
      throw new ConversionError("One of the images couldn't be added to the PDF. It may be damaged.");
    });

    const pageSize = PAGE_SIZES[String(options.page)];
    if (pageSize) {
      const landscape = image.width > image.height;
      const [pw, ph] = landscape ? [pageSize[1], pageSize[0]] : pageSize;
      const scale = Math.min((pw - MARGIN * 2) / image.width, (ph - MARGIN * 2) / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    } else {
      // One image pixel per point (the image at 72 dpi), capped at the 200-inch limit PDF readers enforce.
      const scale = Math.min(1, 14400 / Math.max(image.width, image.height));
      const w = image.width * scale;
      const h = image.height * scale;
      doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    }
  }

  onProgress(1, 'Saving PDF');
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
