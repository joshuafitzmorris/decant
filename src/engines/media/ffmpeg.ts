import { FFmpeg } from '@ffmpeg/ffmpeg';
import { getFormat } from '../../core/formats';
import { type Options, parseTime } from '../../core/options';
import { abortError, ConversionError, type ConvertRequest, type ProgressFn } from '../types';
import { OUTPUT_SPECS } from './specs';

/**
 * The slow-but-universal path: ffmpeg compiled to WebAssembly. It is used only
 * when WebCodecs can't handle a file (AVI, WMV, FLV, AIFF and friends), and its
 * 32 MB core is downloaded the first time that happens.
 */

let ffmpeg: Promise<FFmpeg> | null = null;
let jobCounter = 0;

const vendorUrl = (name: string) =>
  new URL(`${import.meta.env.BASE_URL}${__VENDOR_FFMPEG__}${name}`, location.href).href;

function load(onProgress: ProgressFn): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = (async () => {
      const wasmURL = await downloadWithProgress(vendorUrl('ffmpeg-core.wasm'), (fraction) =>
        onProgress(fraction, 'Downloading the converter'),
      );
      onProgress(null, 'Starting the converter');
      const instance = new FFmpeg();
      try {
        await instance.load({ coreURL: vendorUrl('ffmpeg-core.js'), wasmURL });
      } finally {
        // The worker has compiled its own copy; don't keep 32 MB alive for nothing.
        URL.revokeObjectURL(wasmURL);
      }
      return instance;
    })();
    ffmpeg.catch(() => {
      ffmpeg = null;
    });
  }
  return ffmpeg;
}

async function downloadWithProgress(url: string, onProgress: (fraction: number | null) => void): Promise<string> {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new ConversionError('The video converter could not be downloaded. Check your connection and try again.');
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? received / total : null);
  }
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/wasm' }));
}

/** ffmpeg's memory grows with each job; release it once nothing has needed it for a while. */
const IDLE_SHUTDOWN_MS = 2 * 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function reset() {
  const current = ffmpeg;
  ffmpeg = null;
  current?.then((instance) => instance.terminate()).catch(() => {});
}

export async function convertWithFfmpeg({ file, to, options, signal, onProgress }: ConvertRequest): Promise<Blob> {
  clearTimeout(idleTimer);
  try {
    return await runFfmpeg({ file, to, options, signal, onProgress });
  } finally {
    idleTimer = setTimeout(reset, IDLE_SHUTDOWN_MS);
  }
}

async function runFfmpeg({ file, to, options, signal, onProgress }: Omit<ConvertRequest, 'from'>): Promise<Blob> {
  const instance = await load(onProgress);
  if (signal.aborted) throw abortError();

  const id = ++jobCounter;
  const dir = `/in-${id}`;
  const ext = getFormat(to).exts[0];
  const outputPath = `/out-${id}.${ext}`;
  await instance.createDir(dir);
  await instance.mount('WORKERFS' as never, { files: [file] }, dir);

  let duration = 0;
  let lastError = '';
  const onLog = ({ message }: { message: string }) => {
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (d && !duration) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (t && duration) {
      const seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
      onProgress(Math.min(1, seconds / trimmedDuration(duration, options)), 'Converting');
    }
    if (/error|invalid|not supported|unknown/i.test(message)) lastError = message.trim();
  };
  instance.on('log', onLog);
  const abort = () => reset();
  signal.addEventListener('abort', abort, { once: true });
  onProgress(null, 'Converting');

  try {
    let code = await instance.exec([
      '-hide_banner',
      '-nostdin',
      ...inputArgs(dir, file.name, options),
      ...outputArgs(to, options),
      outputPath,
    ]);
    if (code !== 0 && to === 'mkv') {
      // Stream copy can fail for odd codecs; re-encode instead.
      code = await instance.exec([
        '-hide_banner',
        '-nostdin',
        ...inputArgs(dir, file.name, options),
        ...MP4_VIDEO(options),
        outputPath,
      ]);
    }
    if (signal.aborted) throw abortError();
    if (code !== 0) throw new ConversionError(explain(lastError));
    const data = (await instance.readFile(outputPath)) as Uint8Array;
    return new Blob([data as BlobPart], { type: OUTPUT_SPECS[to]?.mime ?? getFormat(to).mime });
  } catch (error) {
    if (signal.aborted) throw abortError();
    // A WebAssembly crash leaves ffmpeg's memory corrupt, so the next job needs a fresh instance.
    if (!(error instanceof ConversionError)) reset();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    if (!signal.aborted) {
      instance.off('log', onLog);
      await instance.deleteFile(outputPath).catch(() => {});
      await instance.unmount(dir).catch(() => {});
      await instance.deleteDir(dir).catch(() => {});
    }
  }
}

function trimmedDuration(duration: number, options: Options): number {
  const start = parseTime(options.start) ?? 0;
  const end = Math.min(parseTime(options.end) ?? duration, duration);
  return Math.max(0.001, end - start);
}

function inputArgs(dir: string, name: string, options: Options): string[] {
  const start = parseTime(options.start);
  const end = parseTime(options.end);
  const args: string[] = [];
  if (start !== undefined) args.push('-ss', String(start));
  args.push('-i', `${dir}/${name}`);
  if (end !== undefined) args.push('-t', String(Math.max(0.001, end - (start ?? 0))));
  return args;
}

const CRF: Record<string, string> = { 'very-high': '18', high: '21', auto: '21', medium: '25', low: '29' };

function scaleFilter(options: Options): string[] {
  const target = Number(options.resolution);
  if (!(target > 0)) return ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const t = String(target);
  return ['-vf', `scale='if(gte(iw,ih),-2,min(${t},iw))':'if(gte(iw,ih),min(${t},ih),-2)'`];
}

const audioOrMute = (options: Options, codec: string[]) => (options.mute === true ? ['-an'] : codec);

const MP4_VIDEO = (options: Options) => [
  '-map',
  '0:v:0?',
  '-map',
  '0:a:0?',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  CRF[String(options.quality)] ?? '21',
  '-pix_fmt',
  'yuv420p',
  ...scaleFilter(options),
  ...audioOrMute(options, ['-c:a', 'aac', '-b:a', '192k']),
  '-movflags',
  '+faststart',
];

/**
 * libopus in this ffmpeg.wasm build overruns its stack on stereo audio from complexity 5 up, where
 * its pitch pre-filter switches on, and crashes. Complexity 4 runs cleanly and measures within
 * about 2 dB of the default (10) at every bitrate offered.
 */
const OPUS_COMPLEXITY = ['-compression_level', '4'];

function bitrate(options: Options, fallback: number): string {
  const kbps = Number(options.bitrate);
  return `${kbps > 0 ? kbps : fallback}k`;
}

function outputArgs(to: string, options: Options): string[] {
  const mono = options.mono === true ? ['-ac', '1'] : [];
  switch (to) {
    case 'mp4':
    case 'mov':
      return MP4_VIDEO(options);
    case 'webm':
      return [
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c:v',
        'libvpx',
        '-deadline',
        'realtime',
        '-cpu-used',
        '8',
        '-crf',
        '10',
        '-b:v',
        '3M',
        ...scaleFilter(options),
        ...audioOrMute(options, ['-c:a', 'libopus', '-b:a', '128k', ...OPUS_COMPLEXITY]),
      ];
    case 'mkv':
      return ['-map', '0', '-c', 'copy'];
    case 'gif': {
      const fps = Number(options.fps) || 12;
      const width = options.width === 'original' ? 'iw' : String(Number(options.width) || 480);
      return [
        '-filter_complex',
        `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`,
        '-loop',
        '0',
      ];
    }
    case 'mp3':
      return ['-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', bitrate(options, 192), ...mono];
    case 'wav':
      return ['-vn', '-map', '0:a:0', '-c:a', 'pcm_s16le', ...mono];
    case 'flac':
      return ['-vn', '-map', '0:a:0', '-c:a', 'flac', ...mono];
    case 'm4a':
      return ['-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', bitrate(options, 192), ...mono, '-movflags', '+faststart'];
    case 'aac':
      return ['-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', bitrate(options, 192), ...mono, '-f', 'adts'];
    case 'ogg':
    case 'opus':
      return [
        '-vn',
        '-map',
        '0:a:0',
        '-c:a',
        'libopus',
        '-b:a',
        bitrate(options, 128),
        ...OPUS_COMPLEXITY,
        ...mono,
        '-f',
        'ogg',
      ];
    default:
      throw new ConversionError(`Decant can't write ${to.toUpperCase()} files yet.`);
  }
}

function explain(log: string): string {
  if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(log)) {
    return 'This file has no audio or video stream that can be converted.';
  }
  if (/Invalid data found/i.test(log))
    return "This file couldn't be read. It may be damaged or not really a media file.";
  return "This file couldn't be converted.";
}
