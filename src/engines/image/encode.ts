import type { FormatId } from '../../core/formats';
import type { Options } from '../../core/options';
import { ConversionError } from '../types';
import { buildIco, encodeBmp, fitWithin, hasTransparency } from './codecs';
import type { Decoded } from './decode';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export interface EncodeSettings {
  /** Long-edge limit in pixels, or null for the original size. */
  maxSize: number | null;
  quality: number;
  lossless: boolean;
  background: string;
  optimize: boolean;
}

export function encodeSettings(options: Options, defaults: Partial<EncodeSettings> = {}): EncodeSettings {
  const size = Number(options.size);
  return {
    maxSize: Number.isFinite(size) && size > 0 ? size : null,
    quality: Number(options.quality ?? defaults.quality ?? 85),
    lossless: options.lossless === true,
    background: typeof options.background === 'string' ? options.background : '#ffffff',
    optimize: options.optimize === true,
  };
}

export async function encodeImage(source: Decoded, to: FormatId, settings: EncodeSettings): Promise<Blob> {
  if (to === 'ico') return encodeIco(source);

  const [width, height] = fitWithin(source.width, source.height, settings.maxSize);
  const opaque = to === 'jpg' || to === 'bmp';
  const canvas = await drawScaled(source, width, height, opaque ? settings.background : null);
  const q = Math.min(100, Math.max(1, settings.quality));

  switch (to) {
    case 'png': {
      const png = await canvas.convertToBlob({ type: 'image/png' });
      if (!settings.optimize) return png;
      const { default: optimise } = await import('@jsquash/oxipng/optimise');
      const optimised = await optimise(await png.arrayBuffer(), { level: 2, interlace: false, optimiseAlpha: true });
      return blobOf(optimised, 'image/png');
    }
    case 'jpg': {
      const native = await nativeEncode(canvas, 'image/jpeg', q / 100);
      if (native) return native;
      const { default: encode } = await import('@jsquash/jpeg/encode');
      return blobOf(await encode(pixels(canvas), { quality: q }), 'image/jpeg');
    }
    case 'webp': {
      if (!settings.lossless) {
        const native = await nativeEncode(canvas, 'image/webp', q / 100);
        if (native) return native;
      }
      const { default: encode } = await import('@jsquash/webp/encode');
      const options = settings.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality: q };
      return blobOf(await encode(pixels(canvas), options), 'image/webp');
    }
    case 'avif': {
      const { default: encode } = await import('@jsquash/avif/encode');
      const options = settings.lossless ? { lossless: true } : { quality: q, speed: 7 };
      return blobOf(await encode(pixels(canvas), options), 'image/avif');
    }
    case 'jxl': {
      const { default: encode } = await import('@jsquash/jxl/encode');
      const options = settings.lossless ? { lossless: true, effort: 5 } : { quality: q, effort: 5 };
      return blobOf(await encode(pixels(canvas), options), 'image/jxl');
    }
    case 'gif':
      return encodeGif(pixels(canvas));
    case 'bmp':
      return blobOf(encodeBmp(pixels(canvas)), 'image/bmp');
    case 'tiff': {
      const UTIF = await import('utif2');
      const image = pixels(canvas);
      return blobOf(UTIF.encodeImage(new Uint8Array(image.data.buffer), image.width, image.height), 'image/tiff');
    }
    default:
      throw new ConversionError(`Decant can't write ${to.toUpperCase()} images.`);
  }
}

/**
 * Draws the source at the target size. Large reductions are done in halving
 * steps, which avoids the aliasing a single big downscale produces.
 */
export async function drawScaled(
  source: Decoded,
  width: number,
  height: number,
  background: string | null,
): Promise<OffscreenCanvas> {
  let current: ImageBitmap | OffscreenCanvas = source instanceof ImageData ? await createImageBitmap(source) : source;
  let currentWidth = source.width;
  let currentHeight = source.height;
  while (currentWidth / 2 >= width && currentHeight / 2 >= height) {
    const stepWidth = Math.max(width, Math.round(currentWidth / 2));
    const stepHeight = Math.max(height, Math.round(currentHeight / 2));
    const step = new OffscreenCanvas(stepWidth, stepHeight);
    const stepContext = context2d(step);
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(current, 0, 0, stepWidth, stepHeight);
    current = step;
    currentWidth = stepWidth;
    currentHeight = stepHeight;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = context2d(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, width, height);
  return canvas;
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ConversionError('This browser could not allocate an image canvas. The image may be too large.');
  return ctx;
}

function pixels(canvas: OffscreenCanvas): ImageData {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

const nativeSupport = new Map<string, Promise<boolean>>();

/**
 * Browsers that can't encode a type silently return a PNG instead, so probe once
 * with a 1×1 canvas. The canvas needs a context: Chrome never settles
 * convertToBlob() on a context-less OffscreenCanvas. The timeout guards against
 * any other browser doing the same.
 */
function supportsNativeEncode(type: string): Promise<boolean> {
  let probe = nativeSupport.get(type);
  if (!probe) {
    const canvas = new OffscreenCanvas(1, 1);
    canvas.getContext('2d');
    probe = Promise.race([
      canvas
        .convertToBlob({ type })
        .then((blob) => blob.type === type)
        .catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    nativeSupport.set(type, probe);
  }
  return probe;
}

/** Uses the browser's encoder when it supports the type, otherwise returns null. */
async function nativeEncode(canvas: OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if (!(await supportsNativeEncode(type))) return null;
  try {
    const blob = await canvas.convertToBlob({ type, quality });
    return blob.type === type ? blob : null;
  } catch {
    return null;
  }
}

function blobOf(data: ArrayBuffer | Uint8Array, type: string): Blob {
  return new Blob([data as BlobPart], { type });
}

async function encodeGif(image: ImageData): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const transparent = hasTransparency(image.data);
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(image.data, 256, { format, oneBitAlpha: transparent });
  const index = applyPalette(image.data, palette, format);
  const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;
  const gif = GIFEncoder();
  gif.writeFrame(index, image.width, image.height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return blobOf(gif.bytes(), 'image/gif');
}

async function encodeIco(source: Decoded): Promise<Blob> {
  const longest = Math.max(source.width, source.height);
  const sizes = ICO_SIZES.filter((size) => size <= Math.max(48, longest));
  const entries: { size: number; png: Uint8Array }[] = [];
  for (const size of sizes) {
    const [w, h] = fitWithin(source.width, source.height, size, true);
    const scaled = await drawScaled(source, w, h, null);
    const square = new OffscreenCanvas(size, size);
    context2d(square).drawImage(scaled, Math.round((size - w) / 2), Math.round((size - h) / 2));
    const png = await square.convertToBlob({ type: 'image/png' });
    entries.push({ size, png: new Uint8Array(await png.arrayBuffer()) });
  }
  return blobOf(buildIco(entries), 'image/x-icon');
}
