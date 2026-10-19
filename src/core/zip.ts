import { uniqueNames } from './names';

const COMPRESSIBLE = /\.(txt|md|html?|csv|tsv|json|ya?ml|toml|xml|svg|bmp|tiff?|wav|aiff?)$/i;

/** Streams files into a ZIP without loading them all into one buffer. Already-compressed media is stored as-is. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { Zip, ZipDeflate, ZipPassThrough } = await import('fflate');
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });

  const names = uniqueNames(files.map((f) => f.name));
  for (let i = 0; i < files.length; i++) {
    const name = names[i] as string;
    const file = files[i] as { blob: Blob };
    const entry = COMPRESSIBLE.test(name) ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    entry.mtime = new Date();
    zip.add(entry);
    const reader = file.blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      entry.push(value);
    }
    entry.push(new Uint8Array(0), true);
    if (failure) throw failure;
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
