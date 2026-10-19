import type { FormatId } from '../core/formats';
import type { Options } from '../core/options';

export type ProgressFn = (progress: number | null, stage?: string) => void;

export interface ConvertRequest {
  file: File;
  from: FormatId;
  to: FormatId;
  options: Options;
  signal: AbortSignal;
  onProgress: ProgressFn;
}

export interface ConvertedFile {
  blob: Blob;
  /** Appended to the source file's base name when one input produces several files, e.g. "-page-2". */
  suffix?: string;
  /** Overrides the target format's extension, e.g. when a PDF page becomes a JPG. */
  ext?: string;
  /** Name of the backing file in the private file system, deleted when the result is discarded. */
  disk?: string;
}

export interface Engine {
  convert(request: ConvertRequest): Promise<ConvertedFile[]>;
}

/** An error whose message is written for the person using the app. */
export class ConversionError extends Error {
  readonly code: string;
  constructor(message: string, code = 'conversion') {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('The conversion was cancelled.', 'AbortError');
}
