/**
 * PalmDOC compression, the LZ77 variant MOBI uses for its 4096-byte text records.
 * Each compressed byte is one of:
 *
 *   0x00, 0x09–0x7F   that byte
 *   0x01–0x08         a count: that many bytes follow, to copy as they are
 *   0x80–0xBF         with the next byte, a copy of earlier output: the 16 bits are 10, then the
 *                     distance back (1–2047) in 11 bits, then the length (3–10) less three in 3 bits
 *   0xC0–0xFF         a space, then this byte XOR 0x80 (one of 0x40–0x7F)
 */

const MIN_MATCH = 3;
const MAX_MATCH = 10;
const MAX_DISTANCE = 2047;
const HASH_BITS = 13;
/** Earlier positions tried for each byte: plenty for prose, and it bounds the work on repetitive input. */
const MAX_CANDIDATES = 32;

export function compressPalmDoc(data: Uint8Array): Uint8Array {
  const length = data.length;
  // The worst case, a lone byte that needs a one-byte raw run, doubles in size.
  const out = new Uint8Array(length * 2);
  // Earlier positions of each 3-byte sequence: the latest in `head` by hash, older ones chained through `previous`.
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const previous = new Int32Array(length);
  const remember = (i: number) => {
    if (i + MIN_MATCH > length) return;
    const h = hash(data, i);
    previous[i] = head[h] ?? -1;
    head[h] = i;
  };

  let o = 0;
  let run = -1; // where the count byte of the raw run being filled is, or -1
  let i = 0;
  while (i < length) {
    // The longest earlier copy of the bytes at i. Copies never overlap the bytes they produce: Calibre never
    // writes overlapping copies, so there is no telling whether every Kindle decodes them.
    let matchLength = 0;
    let matchDistance = 0;
    if (i + MIN_MATCH <= length) {
      const longest = Math.min(MAX_MATCH, length - i);
      let candidate = head[hash(data, i)] ?? -1;
      for (let tries = 0; tries < MAX_CANDIDATES && candidate >= 0 && i - candidate <= MAX_DISTANCE; tries++) {
        const limit = Math.min(longest, i - candidate);
        let n = 0;
        while (n < limit && data[candidate + n] === data[i + n]) n++;
        if (n > matchLength) {
          matchLength = n;
          matchDistance = i - candidate;
          if (n === longest) break;
        }
        candidate = previous[candidate] ?? -1;
      }
    }

    if (matchLength >= MIN_MATCH) {
      const code = 0x8000 | (matchDistance << 3) | (matchLength - MIN_MATCH);
      out[o++] = code >> 8;
      out[o++] = code & 0xff;
      run = -1;
      const end = i + matchLength;
      while (i < end) remember(i++);
      continue;
    }

    const byte = data[i] ?? 0;
    const next = data[i + 1] ?? 0;
    if (byte === 0x20 && next >= 0x40 && next <= 0x7f) {
      out[o++] = next ^ 0x80;
      run = -1;
      remember(i++);
      remember(i++);
      continue;
    }
    if (byte === 0 || (byte >= 0x09 && byte <= 0x7f)) {
      out[o++] = byte;
      run = -1;
    } else {
      // Anything else would read as a command, so it goes in a raw run of up to eight bytes.
      if (run < 0 || out[run] === 8) {
        run = o++;
        out[run] = 0;
      }
      out[run] = (out[run] ?? 0) + 1;
      out[o++] = byte;
    }
    remember(i++);
  }
  return out.slice(0, o);
}

function hash(data: Uint8Array, i: number): number {
  const key = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
  return Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS);
}
