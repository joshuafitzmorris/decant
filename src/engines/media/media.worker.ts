import {
  AdtsOutputFormat,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  canEncodeAudio,
  FlacOutputFormat,
  getFirstEncodableVideoCodec,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  type OutputFormat,
  Quality,
  type QualityLevel,
  StreamTarget,
  type StreamTargetChunk,
  WavOutputFormat,
  WebMOutputFormat,
} from 'mediabunny';
import type { FormatId } from '../../core/formats';
import { type Options, parseTime } from '../../core/options';
import { serve } from '../../lib/worker-host';
import { ConversionError, type ProgressFn } from '../types';
import { type AudioCodecId, even, OUTPUT_SPECS, type OutputSpec, scaledDimensions } from './specs';

export interface MediaTask {
  file: File;
  from: FormatId;
  to: FormatId;
  options: Options;
}

/** Signals the page to retry with ffmpeg.wasm, which reads far more formats but runs slower. */
const fallback = (reason: string) => new ConversionError(reason, 'fallback');

serve<MediaTask, Blob>(async (task, progress) => {
  if (task.from === 'gif') return { result: await gifToVideo(task, progress) };

  const input = new Input({ source: new BlobSource(task.file), formats: ALL_FORMATS });
  try {
    const readable = await input.canRead().catch(() => false);
    if (!readable) throw fallback(`Unsupported container: ${task.from}`);
    await registerDecoders(input);
    if (task.to === 'gif') return { result: await videoToGif(input, task.options, progress) };
    return { result: await transcode(input, task, progress) };
  } finally {
    input.dispose();
  }
});

// ---------------------------------------------------------------------------
// Audio and video conversion

async function transcode(input: Input, { file, to, options }: MediaTask, progress: ProgressFn): Promise<Blob> {
  const spec = OUTPUT_SPECS[to];
  if (!spec) throw new ConversionError(`Decant can't write ${to.toUpperCase()} files yet.`);
  if (spec.audioCodec) await ensureAudioEncoder(spec.audioCodec);

  const trim = await resolveTrim(input, options);
  const sink = await createSink(file.size);
  const output = new Output({ format: outputFormat(to, sink.streaming), target: sink.target });

  const conversion = await Conversion.init({
    input,
    output,
    showWarnings: false,
    tracks: spec.audioOnly ? 'primary' : 'all',
    trim,
    video: (track) => videoOptions(track, spec, options),
    audio: (track) => audioOptions(track, spec, options),
  });

  const codecProblem = conversion.discardedTracks.find(
    (d) =>
      (d.track.isVideoTrack() || d.track.isAudioTrack()) &&
      (d.reason === 'unknown_source_codec' ||
        d.reason === 'undecodable_source_codec' ||
        d.reason === 'no_encodable_target_codec'),
  );
  if (codecProblem) throw fallback(`Track ${codecProblem.track.number}: ${codecProblem.reason}`);
  if (!conversion.isValid) {
    throw spec.audioOnly
      ? new ConversionError('This file has no audio to extract.', 'no-audio')
      : new ConversionError("This file doesn't contain any audio or video that can be converted.", 'empty');
  }

  conversion.onProgress = (value) => progress(value, 'Converting');
  progress(0, 'Converting');
  await conversion.execute();
  return sink.finish(spec.mime);
}

async function videoOptions(
  track: InputVideoTrack,
  spec: OutputSpec,
  options: Options,
): Promise<ConversionVideoOptions> {
  if (spec.audioOnly) return { discard: true };
  const result: ConversionVideoOptions = {};
  let width = track.displayWidth;
  let height = track.displayHeight;
  const scaled = scaledDimensions(width, height, Number(options.resolution));
  if (scaled) {
    [width, height] = scaled;
    Object.assign(result, { width, height, fit: 'fill' });
  }
  if (spec.videoCodecs.length > 0) {
    const codec = await getFirstEncodableVideoCodec(spec.videoCodecs, { width: even(width), height: even(height) });
    if (codec) result.codec = codec;
  }
  if (typeof options.quality === 'string' && options.quality !== 'auto') {
    result.quality = new Quality(options.quality as QualityLevel);
  }
  return result;
}

function audioOptions(track: InputAudioTrack, spec: OutputSpec, options: Options): ConversionAudioOptions {
  if (options.mute === true && !spec.audioOnly) return { discard: true };
  const result: ConversionAudioOptions = {};
  if (spec.audioCodec) result.codec = spec.audioCodec;
  if (options.mono === true && track.numberOfChannels > 1) result.numberOfChannels = 1;

  const lossy = spec.audioCodec === 'mp3' || spec.audioCodec === 'aac' || spec.audioCodec === 'opus';
  if (lossy && track.sampleRate > 48000) result.sampleRate = 48000;
  if (spec.audioCodec === 'opus' && ![8000, 12000, 16000, 24000, 48000].includes(track.sampleRate)) {
    result.sampleRate = 48000;
  }

  const kbps = Number(options.bitrate);
  const reencoding =
    (spec.audioCodec !== null && track.codec !== spec.audioCodec) ||
    result.numberOfChannels !== undefined ||
    result.sampleRate !== undefined;
  if (kbps > 0) result.quality = new Quality({ bitrate: kbps * 1000 });
  else if (reencoding && spec.defaultKbps) result.quality = new Quality({ bitrate: spec.defaultKbps * 1000 });
  return result;
}

function outputFormat(to: FormatId, streaming: boolean): OutputFormat {
  const fastStart = streaming ? false : 'in-memory';
  switch (to) {
    case 'mp4':
    case 'm4a':
      return new Mp4OutputFormat({ fastStart });
    case 'mov':
      return new MovOutputFormat({ fastStart });
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
    case 'mp3':
      return new Mp3OutputFormat();
    case 'wav':
      return new WavOutputFormat();
    case 'flac':
      return new FlacOutputFormat();
    case 'aac':
      return new AdtsOutputFormat();
    case 'ogg':
    case 'opus':
      return new OggOutputFormat();
    default:
      throw new ConversionError(`Decant can't write ${to.toUpperCase()} files yet.`);
  }
}

async function resolveTrim(input: Input, options: Options): Promise<{ start?: number; end?: number } | undefined> {
  const start = parseTime(options.start);
  const end = parseTime(options.end);
  if (start === undefined && end === undefined) return undefined;
  const duration = await input.computeDuration();
  if (start !== undefined && start >= duration) {
    throw new ConversionError(`The start time is past the end of the file (${formatSeconds(duration)}).`, 'trim');
  }
  if (start !== undefined && end !== undefined && end <= start) {
    throw new ConversionError('The end time needs to be after the start time.', 'trim');
  }
  return { start, end: end === undefined ? undefined : Math.min(end, duration) };
}

// ---------------------------------------------------------------------------
// Codec extensions, loaded only when the browser lacks a native codec

const registered = new Set<string>();

async function ensureAudioEncoder(codec: AudioCodecId) {
  if (registered.has(codec)) return;
  if (codec === 'mp3' && !(await canEncodeAudio('mp3'))) {
    (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
  } else if (codec === 'aac' && !(await canEncodeAudio('aac'))) {
    (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  } else if (codec === 'flac' && !(await canEncodeAudio('flac'))) {
    (await import('@mediabunny/flac-encoder')).registerFlacEncoder();
  }
  registered.add(codec);
}

async function registerDecoders(input: Input) {
  for (const track of await input.getTracks()) {
    if (track.isAudioTrack() && (track.codec === 'ac3' || track.codec === 'eac3') && !registered.has('ac3-decoder')) {
      if (!(await track.canDecode())) (await import('@mediabunny/ac3')).registerAc3Decoder();
      registered.add('ac3-decoder');
    }
    if (track.isVideoTrack() && track.codec === 'prores' && !registered.has('prores-decoder')) {
      if (!(await track.canDecode())) (await import('@mediabunny/prores')).registerProresDecoder();
      registered.add('prores-decoder');
    }
  }
}

// ---------------------------------------------------------------------------
// Output targets

interface Sink {
  target: BufferTarget | StreamTarget;
  streaming: boolean;
  finish(mime: string): Promise<Blob>;
}

/** Outputs past this size go to the origin-private file system instead of memory. */
const DISK_THRESHOLD = 512 * 1024 * 1024;

async function createSink(inputSize: number): Promise<Sink> {
  if (inputSize >= DISK_THRESHOLD) {
    const disk = await createDiskSink().catch(() => null);
    if (disk) return disk;
  }
  const target = new BufferTarget();
  return {
    target,
    streaming: false,
    finish: async (mime) => {
      if (!target.buffer) throw new ConversionError('The converter finished without producing a file.');
      return new Blob([target.buffer], { type: mime });
    },
  };
}

interface SyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}

async function createDiskSink(): Promise<Sink> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(`decant-${Date.now()}-${Math.random().toString(36).slice(2)}`, {
    create: true,
  });
  const access = await (
    handle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      access.write(chunk.data, { at: chunk.position });
    },
  });
  return {
    target: new StreamTarget(writable, { chunked: true }),
    streaming: true,
    finish: async (mime) => {
      access.flush();
      access.close();
      const file = await handle.getFile();
      return file.slice(0, file.size, mime);
    },
  };
}

// ---------------------------------------------------------------------------
// Video to GIF

const MAX_GIF_FRAMES = 3000;

async function videoToGif(input: Input, options: Options, progress: ProgressFn): Promise<Blob> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new ConversionError('This file has no video to turn into a GIF.', 'no-video');
  if (!(await track.canDecode())) throw fallback(`Undecodable video codec: ${track.codec}`);

  const duration = await input.computeDuration();
  const trim = await resolveTrim(input, options);
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration;
  const fps = Number(options.fps) || 12;
  const requestedWidth = options.width === 'original' ? track.displayWidth : Number(options.width) || 480;
  const width = Math.min(requestedWidth, track.displayWidth);
  const height = Math.max(1, Math.round((track.displayHeight * width) / track.displayWidth));

  const timestamps: number[] = [];
  for (let t = start; t < end; t += 1 / fps) timestamps.push(t);
  if (timestamps.length === 0) timestamps.push(start);
  if (timestamps.length > MAX_GIF_FRAMES) {
    const maxSeconds = Math.floor(MAX_GIF_FRAMES / fps);
    throw new ConversionError(
      `That's too long for a GIF. Set a start and end time to keep it under ${maxSeconds} seconds at ${fps} fps.`,
      'too-long',
    );
  }

  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
  let done = 0;
  for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
    if (frame) {
      const ctx = frame.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256, { format: 'rgb565' });
      gif.writeFrame(applyPalette(data, palette, 'rgb565'), width, height, { palette, delay, repeat: 0 });
    }
    done++;
    progress(done / timestamps.length, 'Making GIF');
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

// ---------------------------------------------------------------------------
// GIF to video

async function gifToVideo({ file, to }: MediaTask, progress: ProgressFn): Promise<Blob> {
  if (to !== 'mp4' && to !== 'webm') throw new ConversionError(`Decant can't turn GIFs into ${to.toUpperCase()}.`);
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported('image/gif'))) {
    throw fallback('ImageDecoder unavailable');
  }

  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (frameCount === 0) throw new ConversionError('This GIF has no frames.');

    const first = await decoder.decode({ frameIndex: 0 });
    const width = even(first.image.displayWidth);
    const height = even(first.image.displayHeight);
    first.image.close();

    const spec = OUTPUT_SPECS[to] as OutputSpec;
    const codec = await getFirstEncodableVideoCodec(to === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : spec.videoCodecs, {
      width,
      height,
    });
    if (!codec) throw fallback('No encodable video codec');

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const target = new BufferTarget();
    const output = new Output({ format: outputFormat(to, false), target });
    const source = new CanvasSource(canvas, { codec, quality: new Quality('high') });
    output.addVideoTrack(source);
    await output.start();

    let timestamp = 0;
    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      // Browsers play GIF delays under 20 ms as 100 ms; match that.
      const micros = image.duration ?? 0;
      const seconds = micros >= 20_000 ? micros / 1e6 : 0.1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      image.close();
      await source.add(timestamp, seconds);
      timestamp += seconds;
      progress((i + 1) / frameCount, 'Encoding video');
    }
    source.close();
    await output.finalize();
    if (!target.buffer) throw new ConversionError('The converter finished without producing a file.');
    return new Blob([target.buffer], { type: spec.mime });
  } finally {
    decoder.close();
  }
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
