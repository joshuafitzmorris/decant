/**
 * How wide a line of vessel type is, in ems, worked out from the font's advance widths instead of measured
 * on the page. The pour line can then be sized in CSS from its container's width, so the server-rendered
 * page already has the final size and nothing moves when the app hydrates.
 *
 * Archivo at width 78 and weight 780 with -0.035em tracking (the .vessel class). Measured in Chrome and
 * WebKit, which agree, by scripts/vessel-metrics.mjs; run it again if the vessel's type settings change.
 * The table leaves out kerning, which only ever tightens a pair, so a line comes out at most 1.5% narrower
 * than this predicts and never wider.
 */
const ADVANCE: Record<string, number> = {
  '.': 0.2199,
  a: 0.4665,
  b: 0.4726,
  c: 0.4515,
  d: 0.4726,
  e: 0.4613,
  f: 0.2615,
  g: 0.4577,
  h: 0.4682,
  i: 0.206,
  j: 0.2052,
  k: 0.4634,
  l: 0.2057,
  m: 0.7168,
  n: 0.4685,
  o: 0.4717,
  p: 0.4726,
  q: 0.4726,
  r: 0.2908,
  s: 0.4231,
  t: 0.274,
  u: 0.4683,
  v: 0.4219,
  w: 0.6617,
  x: 0.4569,
  y: 0.4196,
  z: 0.4006,
  0: 0.4712,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: a measured width that happens to equal log10(e).
  1: 0.4343,
  2: 0.4667,
  3: 0.4703,
  4: 0.4643,
  5: 0.4717,
  6: 0.4714,
  7: 0.4442,
  8: 0.4648,
  9: 0.4712,
};

/** Anything not in the table is assumed to be as wide as the widest lowercase letters (m and w aside). */
const FALLBACK = 0.48;

/** The gap either side of the stream, and the stream's own width (see Pour). */
export const VESSEL_GAP = 0.12;
export const STREAM_WIDTH = 0.7;

export function textEms(text: string): number {
  let width = 0;
  for (const char of text) width += ADVANCE[char] ?? FALLBACK;
  return width;
}

/** The whole line: source, stream and target. */
export function lineEms(from: string, to: string): number {
  return textEms(from) + VESSEL_GAP + STREAM_WIDTH + VESSEL_GAP + textEms(to);
}
