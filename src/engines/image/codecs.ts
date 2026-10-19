/**
 * Small, dependency-free image container writers and geometry helpers.
 * Kept free of browser APIs so they can be unit tested in Node.
 */

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Scales (width, height) down to fit a box of `limit` on the long edge. Never upscales unless `allowUpscale`. */
export function fitWithin(width: number, height: number, limit: number | null, allowUpscale = false): [number, number] {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return [width, height];
  const longest = Math.max(width, height);
  if (longest <= limit && !allowUpscale) return [width, height];
  const scale = limit / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** 24-bit uncompressed Windows bitmap. Alpha must already be flattened. */
export function encodeBmp({ width, height, data }: Rgba): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const out = new Uint8Array(54 + pixelBytes);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive height: rows stored bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true); // 72 dpi
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    let src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++, src += 4) {
      out[dst++] = data[src + 2] ?? 0;
      out[dst++] = data[src + 1] ?? 0;
      out[dst++] = data[src] ?? 0;
    }
  }
  return out;
}

/** Windows icon with PNG-compressed entries, one per size. */
export function buildIco(entries: { size: number; png: Uint8Array }[]): Uint8Array {
  const headerSize = 6 + entries.length * 16;
  const total = headerSize + entries.reduce((sum, e) => sum + e.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, entries.length, true);
  let offset = headerSize;
  entries.forEach((entry, i) => {
    const p = 6 + i * 16;
    out[p] = entry.size >= 256 ? 0 : entry.size;
    out[p + 1] = entry.size >= 256 ? 0 : entry.size;
    out[p + 2] = 0; // palette size
    out[p + 3] = 0; // reserved
    view.setUint16(p + 4, 1, true); // colour planes
    view.setUint16(p + 6, 32, true); // bits per pixel
    view.setUint32(p + 8, entry.png.length, true);
    view.setUint32(p + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });
  return out;
}

export interface IcoEntry {
  width: number;
  height: number;
  bitCount: number;
  offset: number;
  size: number;
}

export function readIcoDirectory(bytes: Uint8Array): IcoEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    if (p + 16 > bytes.length) break;
    entries.push({
      width: bytes[p] || 256,
      height: bytes[p + 1] || 256,
      bitCount: view.getUint16(p + 6, true),
      size: view.getUint32(p + 8, true),
      offset: view.getUint32(p + 12, true),
    });
  }
  return entries;
}

/** Decodes an uncompressed 32- or 24-bit DIB as stored inside .ico files (height is doubled to include the mask). */
export function decodeIcoDib(bytes: Uint8Array): Rgba {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = Math.abs(view.getInt32(8, true)) / 2;
  const bitCount = view.getUint16(14, true);
  if (bitCount !== 32 && bitCount !== 24) throw new Error(`Unsupported icon bit depth: ${bitCount}`);
  const bytesPerPixel = bitCount / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const maskRowSize = Math.ceil(width / 32) * 4;
  const maskOffset = headerSize + rowSize * height;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = headerSize + (height - 1 - y) * rowSize;
    const maskRow = maskOffset + (height - 1 - y) * maskRowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * bytesPerPixel;
      const d = (y * width + x) * 4;
      data[d] = bytes[s + 2] ?? 0;
      data[d + 1] = bytes[s + 1] ?? 0;
      data[d + 2] = bytes[s] ?? 0;
      if (bitCount === 32) {
        data[d + 3] = bytes[s + 3] ?? 255;
      } else {
        const masked = ((bytes[maskRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        data[d + 3] = masked ? 0 : 255;
      }
    }
  }
  return { width, height, data };
}

export function hasTransparency(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  return false;
}
