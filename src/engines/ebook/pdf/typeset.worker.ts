import { serve } from '../../../lib/worker-host';
import { ConversionError } from '../../types';
import type { PrintBook } from './blocks';
import { type BookFonts, type PageSize, typeset } from './typeset';

export interface TypesetTask {
  print: PrintBook;
  page: PageSize;
}

const FONTS = `${import.meta.env.BASE_URL}vendor/literata-3.103/`;
let fonts: Promise<BookFonts> | undefined;

/** Fetched once per worker and kept for the next book; the service worker caches the files for offline use. */
function loadFonts(): Promise<BookFonts> {
  fonts ??= Promise.all([font('Regular'), font('Italic'), font('Bold'), font('BoldItalic')]).then(
    ([regular, italic, bold, boldItalic]) => ({ regular, italic, bold, boldItalic }),
    (error) => {
      fonts = undefined;
      throw error;
    },
  );
  return fonts;
}

async function font(style: string): Promise<Uint8Array> {
  const response = await fetch(`${FONTS}Literata-${style}.ttf`).catch(() => null);
  if (!response?.ok) {
    throw new ConversionError("The book font couldn't be loaded. Check your connection and try again.", 'network');
  }
  return new Uint8Array(await response.arrayBuffer());
}

serve<TypesetTask, Uint8Array>(async ({ print, page }, progress) => {
  progress(null, 'Loading fonts');
  const book = await loadFonts();
  const pdf = await typeset(print, { page }, book, (value) => progress(value, 'Typesetting'));
  return { result: pdf, transfer: [pdf.buffer as ArrayBuffer] };
});
