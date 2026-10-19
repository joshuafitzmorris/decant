import { WorkerPool } from '../../lib/worker-pool';
import { ConversionError, type ConvertedFile, type ConvertRequest } from '../types';
import type { MediaTask } from './media.worker';

/** One worker: hardware encoders are a shared resource, and media jobs are memory-hungry. */
const pool = new WorkerPool(
  () => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module', name: 'decant-media' }),
  1,
);

/** Failures worth retrying with ffmpeg.wasm rather than reporting. */
const RETRYABLE = new Set(['fallback', 'internal', 'crash']);

export async function convert(request: ConvertRequest): Promise<ConvertedFile[]> {
  const task: MediaTask = { file: request.file, from: request.from, to: request.to, options: request.options };
  try {
    const blob = await pool.run<Blob>(task, { signal: request.signal, onProgress: request.onProgress });
    return [{ blob }];
  } catch (error) {
    if (!(error instanceof ConversionError) || !RETRYABLE.has(error.code) || request.signal.aborted) throw error;
    if (import.meta.env.DEV) console.info('[decant] WebCodecs path failed, using ffmpeg.wasm:', error.message);
    const { convertWithFfmpeg } = await import('./ffmpeg');
    return [{ blob: await convertWithFfmpeg(request) }];
  }
}
