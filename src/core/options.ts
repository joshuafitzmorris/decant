import { type FormatId, getFormat } from './formats';

export type OptionValue = string | number | boolean;
export type Options = Record<string, OptionValue>;

interface BaseOption {
  key: string;
  label: string;
  hint?: string;
}

export interface SelectOption extends BaseOption {
  kind: 'select';
  choices: readonly { value: string; label: string }[];
  default: string;
}

export interface RangeOption extends BaseOption {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  /** Disable the control while another boolean option is on. */
  disabledBy?: string;
}

export interface ToggleOption extends BaseOption {
  kind: 'toggle';
  default: boolean;
}

export interface ColorOption extends BaseOption {
  kind: 'color';
  default: string;
}

export interface TimeOption extends BaseOption {
  kind: 'time';
  /** Seconds; empty means "from the start" / "to the end". */
  default: string;
  placeholder: string;
}

export type OptionDef = SelectOption | RangeOption | ToggleOption | ColorOption | TimeOption;

const LOSSY_IMAGE_QUALITY: Partial<Record<FormatId, number>> = { jpg: 85, webp: 85, avif: 60, jxl: 80 };
const TRANSPARENT_SOURCES = new Set<FormatId>([
  'png',
  'webp',
  'avif',
  'gif',
  'svg',
  'ico',
  'tiff',
  'jxl',
  'heic',
  'bmp',
]);
const OPAQUE_TARGETS = new Set<FormatId>(['jpg', 'bmp']);

/** Long-edge size. Raster images are never enlarged; SVGs are drawn at the chosen size. */
const imageSize: SelectOption = {
  kind: 'select',
  key: 'size',
  label: 'Size',
  default: 'original',
  hint: 'Longest side. Photos are never enlarged; SVGs are drawn at this size',
  choices: [
    { value: 'original', label: 'Original' },
    { value: '3840', label: 'Up to 3840 px' },
    { value: '2048', label: 'Up to 2048 px' },
    { value: '1920', label: 'Up to 1920 px' },
    { value: '1280', label: 'Up to 1280 px' },
    { value: '1024', label: 'Up to 1024 px' },
    { value: '512', label: 'Up to 512 px' },
  ],
};

const quality = (initial: number): RangeOption => ({
  kind: 'range',
  key: 'quality',
  label: 'Quality',
  min: 1,
  max: 100,
  step: 1,
  default: initial,
  disabledBy: 'lossless',
});

const trim: OptionDef[] = [
  { kind: 'time', key: 'start', label: 'Start', default: '', placeholder: '0:00' },
  { kind: 'time', key: 'end', label: 'End', default: '', placeholder: 'end' },
];

const bitrate = (choices: number[]): SelectOption => ({
  kind: 'select',
  key: 'bitrate',
  label: 'Bitrate',
  hint: 'Auto keeps the original audio when it can, and otherwise picks a high-quality bitrate',
  default: 'auto',
  choices: [
    { value: 'auto', label: 'Auto' },
    ...choices.map((kbps) => ({ value: String(kbps), label: `${kbps} kbps` })),
  ],
});

export function optionsFor(from: FormatId, to: FormatId): OptionDef[] {
  const source = getFormat(from);
  const target = getFormat(to);

  if (source.category === 'image' && target.category === 'image') {
    const defs: OptionDef[] = [];
    const q = LOSSY_IMAGE_QUALITY[to];
    if (q !== undefined) defs.push(quality(q));
    if (to === 'webp' || to === 'avif' || to === 'jxl') {
      defs.push({ kind: 'toggle', key: 'lossless', label: 'Lossless', default: false });
    }
    if (to !== 'ico') defs.push(imageSize);
    if (OPAQUE_TARGETS.has(to) && TRANSPARENT_SOURCES.has(from)) {
      defs.push({
        kind: 'color',
        key: 'background',
        label: 'Background',
        default: '#ffffff',
        hint: 'Fills transparent areas',
      });
    }
    if (to === 'png') {
      defs.push({ kind: 'toggle', key: 'optimize', label: 'Smaller file', hint: 'Slower, lossless', default: false });
    }
    return defs;
  }

  if (source.category === 'image' && to === 'pdf') {
    return [
      {
        kind: 'select',
        key: 'page',
        label: 'Page',
        default: 'image',
        choices: [
          { value: 'image', label: 'Match image' },
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter' },
        ],
      },
    ];
  }

  if (from === 'gif' && target.category === 'video') return [];

  if (source.category === 'video' && to === 'gif') {
    return [
      {
        kind: 'select',
        key: 'width',
        label: 'Width',
        default: '480',
        choices: [
          { value: '320', label: '320 px' },
          { value: '480', label: '480 px' },
          { value: '640', label: '640 px' },
          { value: '800', label: '800 px' },
          { value: 'original', label: 'Original' },
        ],
      },
      {
        kind: 'select',
        key: 'fps',
        label: 'Frame rate',
        default: '12',
        choices: ['8', '10', '12', '15', '20', '25'].map((v) => ({ value: v, label: `${v} fps` })),
      },
      ...trim,
    ];
  }

  if (target.category === 'video') {
    return [
      {
        kind: 'select',
        key: 'resolution',
        label: 'Resolution',
        default: 'original',
        choices: [
          { value: 'original', label: 'Original' },
          { value: '2160', label: '2160p (4K)' },
          { value: '1440', label: '1440p' },
          { value: '1080', label: '1080p' },
          { value: '720', label: '720p' },
          { value: '480', label: '480p' },
          { value: '360', label: '360p' },
        ],
      },
      {
        kind: 'select',
        key: 'quality',
        label: 'Quality',
        default: 'auto',
        hint: 'Auto copies the video untouched when it can, which is near-instant',
        choices: [
          { value: 'auto', label: 'Auto' },
          { value: 'very-high', label: 'Very high' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ],
      },
      { kind: 'toggle', key: 'mute', label: 'Remove audio', default: false },
      ...trim,
    ];
  }

  if (target.category === 'audio') {
    const defs: OptionDef[] = [];
    if (to === 'mp3') defs.push(bitrate([128, 192, 256, 320]));
    if (to === 'm4a' || to === 'aac') defs.push(bitrate([96, 128, 192, 256]));
    if (to === 'ogg' || to === 'opus') defs.push(bitrate([64, 96, 128, 192]));
    defs.push({ kind: 'toggle', key: 'mono', label: 'Mono', default: false });
    defs.push(...trim);
    return defs;
  }

  if (from === 'pdf' && target.category === 'image') {
    const defs: OptionDef[] = [
      {
        kind: 'select',
        key: 'dpi',
        label: 'Resolution',
        default: '150',
        choices: [
          { value: '72', label: '72 dpi' },
          { value: '150', label: '150 dpi' },
          { value: '300', label: '300 dpi' },
        ],
      },
      {
        kind: 'select',
        key: 'pages',
        label: 'Pages',
        default: 'all',
        choices: [
          { value: 'all', label: 'All pages' },
          { value: 'first', label: 'First page' },
        ],
      },
    ];
    const q = LOSSY_IMAGE_QUALITY[to];
    if (q !== undefined) defs.unshift(quality(q));
    return defs;
  }

  return [];
}

export function defaultOptions(from: FormatId, to: FormatId): Options {
  const options: Options = {};
  for (const def of optionsFor(from, to)) options[def.key] = def.default;
  return options;
}

/** Parses "1:23", "83", "1:02:03" or "12.5" into seconds. Returns undefined for blank or invalid input. */
export function parseTime(value: OptionValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return undefined;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
