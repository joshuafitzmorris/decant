import { type FormatId, getFormat, isFormatId } from './formats';
import { canConvert } from './routes';

/**
 * Popular conversions get their own URL (/decant/heic-to-jpg/) with a page
 * title search engines can match. The app itself is identical; it just opens
 * with that pair and defaults to it.
 */
export const LANDING_PAIRS: [FormatId, FormatId][] = [
  ['heic', 'jpg'],
  ['heic', 'png'],
  ['webp', 'png'],
  ['webp', 'jpg'],
  ['png', 'jpg'],
  ['jpg', 'png'],
  ['avif', 'jpg'],
  ['png', 'webp'],
  ['jpg', 'webp'],
  ['png', 'ico'],
  ['svg', 'png'],
  ['jpg', 'pdf'],
  ['png', 'pdf'],
  ['pdf', 'jpg'],
  ['pdf', 'png'],
  ['gif', 'mp4'],
  ['mov', 'mp4'],
  ['mp4', 'mp3'],
  ['mp4', 'gif'],
  ['mkv', 'mp4'],
  ['webm', 'mp4'],
  ['avi', 'mp4'],
  ['wav', 'mp3'],
  ['flac', 'mp3'],
  ['m4a', 'mp3'],
  ['mp3', 'wav'],
  ['docx', 'md'],
  ['md', 'html'],
  ['csv', 'xlsx'],
  ['xlsx', 'csv'],
  ['json', 'csv'],
  ['json', 'yaml'],
];

export interface LandingPair {
  from: FormatId;
  to: FormatId;
}

export const landingSlug = (from: FormatId, to: FormatId) => `${from}-to-${to}`;

/** Reads a pair from a path like "/decant/heic-to-jpg/". */
export function pairFromPath(pathname: string, base: string): LandingPair | null {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const match = /^([a-z0-9]+)-to-([a-z0-9]+)\/?$/.exec(rest.toLowerCase());
  if (!match) return null;
  const [, from, to] = match;
  if (!from || !to || !isFormatId(from) || !isFormatId(to) || !canConvert(from, to)) return null;
  return { from, to };
}

export function landingCopy(from: FormatId, to: FormatId) {
  const source = getFormat(from);
  const target = getFormat(to);
  return {
    title: `Convert ${source.label} to ${target.label} without uploading | Decant`,
    description: `Convert ${source.label} to ${target.label} in your browser. Free, with no uploads, no queue, no ads and no sign-up. Your files never leave your device.`,
  };
}
