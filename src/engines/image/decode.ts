import { displayName, type FormatId } from '../../core/formats';
import { ConversionError } from '../types';
import { decodeIcoDib, readIcoDirectory } from './codecs';

export type Decoded = ImageBitmap | ImageData;

/**
 * Decodes any supported image into pixels. The browser's own decoder is tried
 * first because it is fastest and honours EXIF orientation; WebAssembly
 * decoders cover what the browser can't read (HEIC everywhere but Safari,
 * TIFF and JPEG XL in most browsers).
 */
export async function decodeImage(input: Blob | ImageBitmap, from: FormatId): Promise<Decoded> {
  if (input instanceof ImageBitmap) return input;

  const native = await createImageBitmap(input, { imageOrientation: 'from-image' }).catch(() => null);
  if (native) return native;

  try {
    switch (from) {
      case 'heic':
        return await decodeHeic(input);
      case 'tiff':
        return await decodeTiff(input);
      case 'jxl': {
        const { default: decode } = await import('@jsquash/jxl/decode');
        return await decode(await input.arrayBuffer());
      }
      case 'avif': {
        const { default: decode } = await import('@jsquash/avif/decode');
        const result = await decode(await input.arrayBuffer());
        if (!result) throw new Error('empty');
        return result;
      }
      case 'webp': {
        const { default: decode } = await import('@jsquash/webp/decode');
        return await decode(await input.arrayBuffer());
      }
      case 'jpg': {
        const { default: decode } = await import('@jsquash/jpeg/decode');
        return await decode(await input.arrayBuffer());
      }
      case 'ico':
        return await decodeIco(input);
    }
  } catch (error) {
    if (error instanceof ConversionError) throw error;
  }
  throw new ConversionError(
    `This ${displayName(from)} file couldn’t be read. It may be damaged, or use a variant Decant doesn’t support.`,
  );
}

let libheif: Promise<import('libheif-js/libheif-wasm/libheif-bundle.mjs').LibHeif> | undefined;

async function decodeHeic(blob: Blob): Promise<ImageData> {
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  const lib = await libheif;
  const images = new lib.HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  if (images.length === 0) throw new ConversionError('This HEIC file has no image in it.');
  const image = images.find((img) => img.is_primary()) ?? images[0];
  if (!image) throw new ConversionError('This HEIC file has no image in it.');
  const width = image.get_width();
  const height = image.get_height();
  const target = new ImageData(width, height);
  try {
    await new Promise<void>((resolve, reject) => {
      image.display(target, (result) => (result ? resolve() : reject(new Error('HEIC decode failed'))));
    });
  } finally {
    for (const img of images) img.free();
  }
  return target;
}

async function decodeTiff(blob: Blob): Promise<ImageData> {
  const UTIF = await import('utif2');
  const buffer = await blob.arrayBuffer();
  const pages = UTIF.decode(buffer);
  // Some TIFFs lead with a thumbnail; take the largest page.
  const page = pages.reduce<(typeof pages)[number] | undefined>((best, ifd) => {
    const area = Number(ifd.t256 ?? 0) * Number(ifd.t257 ?? 0);
    const bestArea = best ? Number(best.t256 ?? 0) * Number(best.t257 ?? 0) : -1;
    return area > bestArea ? ifd : best;
  }, undefined);
  if (!page) throw new ConversionError('This TIFF file has no image in it.');
  UTIF.decodeImage(buffer, page);
  const rgba = UTIF.toRGBA8(page);
  return new ImageData(
    new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength),
    page.width,
    page.height,
  );
}

async function decodeIco(blob: Blob): Promise<Decoded> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readIcoDirectory(bytes).sort(
    (a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount,
  );
  for (const entry of entries) {
    const data = bytes.subarray(entry.offset, entry.offset + entry.size);
    const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    try {
      if (isPng) return await createImageBitmap(new Blob([data], { type: 'image/png' }));
      const dib = decodeIcoDib(data);
      return new ImageData(new Uint8ClampedArray(dib.data), dib.width, dib.height);
    } catch {
      // Try the next size.
    }
  }
  throw new ConversionError('This icon uses an image format Decant can’t read.');
}
