/** The parts of foliate-js's MOBI reader that Decant uses. */

export interface MobiHeaders {
  palmdoc: { compression: number; numTextRecords: number; recordSize: number; encryption: number };
  mobi: { version: number; encoding: number; resourceStart: number; uid: number };
  exth: Record<string, unknown> | null;
  kf8: Record<string, number> | null;
}

export interface MobiMetadata {
  identifier?: string;
  title?: string;
  author?: string[];
  publisher?: string;
  language?: string | string[];
  published?: string;
  description?: string;
  subject?: string[];
  rights?: string;
}

export interface MobiTocItem {
  label: string;
  /** "filepos:123" in MOBI 6 books, "kindle:pos:fid:…:off:…" in KF8. */
  href: string;
  subitems?: MobiTocItem[];
}

export interface MobiSection {
  id?: number;
  /** Set to "no" for KF8 skeletons with no content. */
  linear?: 'no';
  createDocument?: () => Promise<Document>;
  /** A blob: URL of the section rebuilt for display, with resources as blob: URLs. */
  load?: () => Promise<string>;
}

export interface MobiBook {
  mobi: MOBI;
  sections: MobiSection[];
  toc?: MobiTocItem[];
  /** The guide: references such as the contents page ("toc") or where the text starts. */
  landmarks?: { label?: string; type?: string[]; href: string }[];
  metadata: MobiMetadata;
  getCover(): Promise<Blob | undefined>;
  /** MOBI 6: [section index, anchor id]. */
  splitTOCHref(href: string): [number, unknown];
  /** KF8: the section and a function that finds the target element in that section's document. */
  resolveHref(
    href: string,
  ):
    | { index: number; anchor: (doc: Document) => Element | null }
    | Promise<{ index: number; anchor: (doc: Document) => Element | null } | undefined>;
  /** KF8 only: raw bytes of a flow such as a stylesheet. */
  loadFlow?(index: number): Promise<Uint8Array> | undefined;
  destroy(): void;
}

export class MOBI {
  constructor(options: { unzlib: (data: Uint8Array) => Uint8Array | Promise<Uint8Array> });
  headers: MobiHeaders;
  open(file: Blob): Promise<MobiBook>;
  /** Raw bytes of the resource at this index (0-based, counted from the first resource record). */
  loadResource(index: number): Promise<ArrayBuffer | Uint8Array>;
  decode(input: Uint8Array | ArrayBuffer): string;
}

export function isMOBI(file: Blob): Promise<boolean>;
