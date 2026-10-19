import type { FormatId } from '../../core/formats';
import type { Options } from '../../core/options';
import { serve } from '../../lib/worker-host';
import { decodeImage } from './decode';
import { encodeImage, encodeSettings } from './encode';

export interface ImageTask {
  input: Blob | ImageBitmap;
  from: FormatId;
  to: FormatId;
  options: Options;
}

serve<ImageTask, Blob>(async ({ input, from, to, options }, progress) => {
  progress(null, 'Reading');
  const decoded = await decodeImage(input, from);
  progress(null, 'Encoding');
  const blob = await encodeImage(decoded, to, encodeSettings(options));
  if ('close' in decoded) decoded.close();
  return { result: blob };
});
