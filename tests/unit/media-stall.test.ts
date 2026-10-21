import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionError, type ConvertRequest, type ProgressFn } from '../../src/engines/types';

const pool = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/lib/worker-pool', () => ({
  WorkerPool: class {
    run = pool.run;
  },
}));
const ffmpeg = vi.hoisted(() => ({ convertWithFfmpeg: vi.fn(async () => new Blob(['from ffmpeg'])) }));
vi.mock('../../src/engines/media/ffmpeg', () => ffmpeg);

import { convert, STALL_SECONDS } from '../../src/engines/media';

/**
 * Stands in for the WebCodecs worker: reports progress at the given seconds, then finishes at
 * `finishAt`, or never does (a hung encoder) and waits to be cancelled.
 */
function workerThat(reportAt: number[], finishAt?: number) {
  pool.run.mockImplementation(
    (_task: unknown, { signal, onProgress }: { signal: AbortSignal; onProgress: ProgressFn }) =>
      new Promise((resolve, reject) => {
        const timers = reportAt.map((s) => setTimeout(() => onProgress(s / 100, 'Converting'), s * 1000));
        if (finishAt !== undefined) {
          timers.push(setTimeout(() => resolve({ blob: new Blob(['from webcodecs']) }), finishAt * 1000));
        }
        signal.addEventListener('abort', () => {
          for (const timer of timers) clearTimeout(timer);
          reject(new DOMException('The conversion was cancelled.', 'AbortError'));
        });
      }),
  );
}

const request = (signal = new AbortController().signal): ConvertRequest => ({
  file: new File(['x'], 'clip.mov'),
  from: 'mov',
  to: 'mp4',
  options: {},
  signal,
  onProgress: vi.fn(),
});

const output = async (result: ReturnType<typeof convert>) => (await result)[0]?.blob.text();

describe('media conversions that stop making progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    pool.run.mockReset();
    ffmpeg.convertWithFfmpeg.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands a stalled job to ffmpeg', async () => {
    workerThat([0, 1, 2]);
    const result = convert(request());
    await vi.advanceTimersByTimeAsync((2 + STALL_SECONDS + 1) * 1000);
    expect(await output(result)).toBe('from ffmpeg');
    expect(ffmpeg.convertWithFfmpeg).toHaveBeenCalledOnce();
  });

  it('waits for slow conversions that keep moving', async () => {
    const step = STALL_SECONDS - 5;
    workerThat([0, step, step * 2, step * 3], step * 4);
    const result = convert(request());
    await vi.advanceTimersByTimeAsync(step * 4 * 1000);
    expect(await output(result)).toBe('from webcodecs');
    expect(ffmpeg.convertWithFfmpeg).not.toHaveBeenCalled();
  });

  it("doesn't count time before the first progress report, such as a codec download", async () => {
    workerThat([STALL_SECONDS * 3], STALL_SECONDS * 3 + 1);
    const result = convert(request());
    await vi.advanceTimersByTimeAsync((STALL_SECONDS * 3 + 1) * 1000);
    expect(await output(result)).toBe('from webcodecs');
  });

  it("doesn't count time while the page is hidden", async () => {
    vi.stubGlobal('document', { hidden: true });
    workerThat([0, STALL_SECONDS * 3], STALL_SECONDS * 3 + 1);
    const result = convert(request());
    await vi.advanceTimersByTimeAsync((STALL_SECONDS * 3 + 1) * 1000);
    expect(await output(result)).toBe('from webcodecs');
  });

  it('retries failures WebCodecs might not have hit in ffmpeg, but reports the rest', async () => {
    pool.run.mockRejectedValueOnce(new ConversionError('Unsupported container: avi', 'fallback'));
    expect(await output(convert(request()))).toBe('from ffmpeg');

    pool.run.mockRejectedValueOnce(new ConversionError('The end time needs to be after the start time.', 'trim'));
    await expect(convert(request())).rejects.toThrow('end time');
    expect(ffmpeg.convertWithFfmpeg).toHaveBeenCalledOnce();
  });

  it('stops without falling back when the person cancels', async () => {
    workerThat([0]);
    const controller = new AbortController();
    const result = convert(request(controller.signal));
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(ffmpeg.convertWithFfmpeg).not.toHaveBeenCalled();
  });
});
