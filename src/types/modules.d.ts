declare module 'gifenc' {
  export type Palette = number[][];
  export type PixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';
  export interface QuantizeOptions {
    format?: PixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }
  export interface FrameOptions {
    palette?: Palette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  }
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PixelFormat,
  ): Uint8Array;
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    has_alpha_channel(): boolean;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void,
    ): void;
    free(): void;
  }
  export interface LibHeif {
    HeifDecoder: new () => { decode(buffer: Uint8Array): HeifImage[] };
  }
  const factory: () => LibHeif;
  export default factory;
}

declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
