import type { FormatId } from '../../core/formats';
import type { Options } from '../../core/options';
import { WorkerPool } from '../../lib/worker-pool';
import { ConversionError, type ConvertedFile, type ConvertRequest, type ProgressFn } from '../types';
import type { ImageTask } from './image.worker';

const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

const pool = new WorkerPool(
  () => new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: 'decant-image' }),
  workers,
);

export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  const blob = await transcodeImage(
    request.file,
    request.from,
    request.to,
    request.options,
    request.signal,
    request.onProgress,
  );
  return [{ blob }];
}

/** Converts one image to another image format. Shared with the PDF engine for embedding. */
export async function transcodeImage(
  file: Blob,
  from: FormatId,
  to: FormatId,
  options: Options,
  signal?: AbortSignal,
  onProgress?: ProgressFn,
): Promise<Blob> {
  let input: Blob | ImageBitmap = file;
  let taskOptions = options;
  const transfer: Transferable[] = [];
  if (from === 'svg') {
    // Workers have no SVG renderer, so vector images are rasterised here first.
    input = await rasterizeSvg(file, options);
    taskOptions = { ...options, size: 'original' };
    transfer.push(input);
  }
  const task: ImageTask = { input, from, to, options: taskOptions };
  return pool.run<Blob>(task, { signal, onProgress, transfer });
}

/**
 * Encodes already-decoded pixels in a worker. Encoding on the page would be
 * throttled to about one image per second whenever the tab is in the background.
 */
export function encodeBitmap(bitmap: ImageBitmap, to: FormatId, options: Options, signal?: AbortSignal): Promise<Blob> {
  const task: ImageTask = { input: bitmap, from: 'png', to, options: { ...options, size: 'original' } };
  return pool.run<Blob>(task, { signal, transfer: [bitmap] });
}

const DEFAULT_SVG_WIDTH = 300;
const DEFAULT_SVG_HEIGHT = 150;

export async function rasterizeSvg(file: Blob, options: Options): Promise<ImageBitmap> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new ConversionError("This SVG couldn't be read. Check that it's a valid SVG file.");
  }

  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const [, , vbWidth = 0, vbHeight = 0] = viewBox.length === 4 ? viewBox : [];
  let width = parseLength(svg.getAttribute('width'));
  let height = parseLength(svg.getAttribute('height'));
  if (vbWidth > 0 && vbHeight > 0) {
    if (!width && !height) {
      width = vbWidth;
      height = vbHeight;
    } else if (!width && height) {
      width = (height * vbWidth) / vbHeight;
    } else if (width && !height) {
      height = (width * vbHeight) / vbWidth;
    }
  }
  width ||= DEFAULT_SVG_WIDTH;
  height ||= DEFAULT_SVG_HEIGHT;

  const requested = Number(options.size);
  const scale = Number.isFinite(requested) && requested > 0 ? requested / Math.max(width, height) : 1;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  if (outWidth * outHeight > 16384 * 16384)
    throw new ConversionError('That size is too large to render. Pick a smaller width.');

  if (viewBox.length !== 4) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(outWidth));
  svg.setAttribute('height', String(outHeight));
  svg.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet');

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(outWidth, outHeight);
    image.src = url;
    await image.decode().catch(() => {
      throw new ConversionError("This SVG couldn't be drawn. It may rely on features browsers block in images.");
    });
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ConversionError('This browser could not allocate an image canvas.');
    ctx.drawImage(image, 0, 0, outWidth, outHeight);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseLength(value: string | null): number {
  if (!value) return 0;
  const match = /^\s*([\d.]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value);
  if (!match) return 0; // percentages and other relative units fall back to the viewBox
  const n = Number(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  const perUnit: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return n * (perUnit[unit] ?? 1);
}
