/**
 * Decodes a text file the way a person expects: honour a byte-order mark
 * (UTF-8 or UTF-16), otherwise use UTF-8, and fall back to Windows-1252 for
 * files that aren't valid UTF-8 (such as CSVs saved by older Excel on Windows).
 */
export function decodeText(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Reads a file as text with {@link decodeText}. */
export async function readText(file: Blob): Promise<string> {
  return decodeText(await file.arrayBuffer());
}
