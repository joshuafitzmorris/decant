import type { FormatId } from '../../core/formats';

export type AudioCodecId = 'aac' | 'opus' | 'mp3' | 'vorbis' | 'flac' | 'pcm-s16';
export type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';

export interface OutputSpec {
  audioOnly: boolean;
  /** Preferred video codecs, best first. Empty means "keep whatever the source has". */
  videoCodecs: VideoCodecId[];
  /** Target audio codec, or null to keep the source's. */
  audioCodec: AudioCodecId | null;
  /** Bitrate used when audio has to be re-encoded and the person left it on Auto. */
  defaultKbps?: number;
  mime: string;
}

export const OUTPUT_SPECS: Partial<Record<FormatId, OutputSpec>> = {
  mp4: { audioOnly: false, videoCodecs: ['avc'], audioCodec: 'aac', defaultKbps: 192, mime: 'video/mp4' },
  mov: { audioOnly: false, videoCodecs: ['avc'], audioCodec: 'aac', defaultKbps: 192, mime: 'video/quicktime' },
  webm: {
    audioOnly: false,
    videoCodecs: ['vp9', 'vp8', 'av1'],
    audioCodec: 'opus',
    defaultKbps: 128,
    mime: 'video/webm',
  },
  mkv: { audioOnly: false, videoCodecs: [], audioCodec: null, mime: 'video/x-matroska' },
  mp3: { audioOnly: true, videoCodecs: [], audioCodec: 'mp3', defaultKbps: 192, mime: 'audio/mpeg' },
  wav: { audioOnly: true, videoCodecs: [], audioCodec: 'pcm-s16', mime: 'audio/wav' },
  flac: { audioOnly: true, videoCodecs: [], audioCodec: 'flac', mime: 'audio/flac' },
  m4a: { audioOnly: true, videoCodecs: [], audioCodec: 'aac', defaultKbps: 192, mime: 'audio/mp4' },
  aac: { audioOnly: true, videoCodecs: [], audioCodec: 'aac', defaultKbps: 192, mime: 'audio/aac' },
  ogg: { audioOnly: true, videoCodecs: [], audioCodec: 'opus', defaultKbps: 128, mime: 'audio/ogg' },
  opus: { audioOnly: true, videoCodecs: [], audioCodec: 'opus', defaultKbps: 128, mime: 'audio/ogg' },
};

/** Rounds to the nearest even number; most video encoders need even dimensions. */
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * "720p" means the short edge is 720 px, so portrait video keeps its orientation.
 * Returns null when the video is already that size or smaller.
 */
export function scaledDimensions(width: number, height: number, shortEdge: number): [number, number] | null {
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return null;
  const short = Math.min(width, height);
  if (short <= shortEdge) return null;
  const scale = shortEdge / short;
  return [even(width * scale), even(height * scale)];
}
