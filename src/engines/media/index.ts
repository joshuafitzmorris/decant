import { DISK_PREFIX } from '../../lib/disk';
import { WorkerPool } from '../../lib/worker-pool';
import { ConversionError, type ConvertedFile, type ConvertRequest } from '../types';
import type { MediaResult, MediaTask } from './media.worker';

/** One worker: hardware encoders are a shared resource, and media jobs are memory-hungry. */
const pool = new WorkerPool(
  () => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module', name: 'decant-media' }),
  1,
);

/** Failures worth retrying with ffmpeg.wasm rather than reporting. */
const RETRYABLE = new Set(['fallback', 'internal', 'crash', 'stalled']);

/**
 * A WebCodecs encoder can accept a configuration and then never return a frame or an error (1080p
 * H.264 does this in the iOS Simulator). Progress stops moving once its queue fills, so a job that
 * shows none for this long while the page is in view is handed to ffmpeg instead of waiting forever.
 */
export const STALL_SECONDS = 20;

export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  try {
    const { blob, disk } = await convertWithWebCodecs(request);
    return [{ blob, disk }];
  } catch (error) {
    if (!(error instanceof ConversionError) || !RETRYABLE.has(error.code) || request.signal.aborted) throw error;
    if (import.meta.env.DEV) console.info('[decant] WebCodecs path failed, using ffmpeg.wasm:', error.message);
    const { convertWithFfmpeg } = await import('./ffmpeg');
    return [{ blob: await convertWithFfmpeg(request) }];
  }
}

async function convertWithWebCodecs(request: ConvertRequest): Promise<MediaResult> {
  const task: MediaTask = {
    file: request.file,
    from: request.from,
    to: request.to,
    options: request.options,
    diskPrefix: DISK_PREFIX,
  };
  // Cancelled by the person, or by the watchdog when the job stops making progress.
  const attempt = new AbortController();
  const cancel = () => attempt.abort();
  if (request.signal.aborted) cancel();
  request.signal.addEventListener('abort', cancel, { once: true });
  const watch = watchForStall(cancel);
  try {
    return await pool.run<MediaResult>(task, {
      signal: attempt.signal,
      onProgress: (progress, stage) => {
        watch.progressed();
        request.onProgress(progress, stage);
      },
    });
  } catch (error) {
    if (watch.stalled && !request.signal.aborted) {
      throw new ConversionError(`No progress for ${STALL_SECONDS} s`, 'stalled');
    }
    throw error;
  } finally {
    watch.stop();
    request.signal.removeEventListener('abort', cancel);
  }
}

/**
 * Counts seconds without progress, starting from the first progress report so that downloading a
 * codec beforehand never counts. Time while the page is hidden or suspended (a phone switching apps)
 * doesn't count either: browsers pause the work then too.
 */
function watchForStall(onStall: () => void) {
  let armed = false;
  let quiet = 0;
  let lastTick = Date.now();
  const state = {
    stalled: false,
    progressed() {
      armed = true;
      quiet = 0;
    },
    stop: () => clearInterval(timer),
  };
  const timer = setInterval(() => {
    const now = Date.now();
    const paused = (typeof document !== 'undefined' && document.hidden) || now - lastTick > 5000;
    lastTick = now;
    if (!armed || paused) {
      quiet = 0;
      return;
    }
    if (++quiet < STALL_SECONDS) return;
    state.stalled = true;
    clearInterval(timer);
    onStall();
  }, 1000);
  return state;
}
