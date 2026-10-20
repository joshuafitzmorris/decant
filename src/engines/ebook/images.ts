import type { FormatId } from '../../core/formats';
import type { Book, Resource } from './book';

const FORMAT_FOR_TYPE: Record<string, FormatId> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};
const TYPE_FOR_FORMAT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };

/**
 * Converts pictures the target can't hold (MOBI only takes JPEG and GIF, FB2
 * JPEG and PNG...) and, when asked, shrinks JPEGs that are too heavy for older
 * Kindles. Chapters are updated to the new file names.
 */
export async function convertImages(
  book: Book,
  accepted: readonly string[],
  target: 'jpg' | 'png',
  signal: AbortSignal,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Book> {
  const { transcodeImage } = await import('../image');
  const renamed = new Map<string, string>();
  const resources: Resource[] = [];
  for (const resource of book.resources) {
    let current = resource;
    const from = FORMAT_FOR_TYPE[resource.type];
    if (!accepted.includes(resource.type) && from) {
      current = await transcode(resource, from, target, {}, transcodeImage, signal).catch(() => resource);
    }
    // Step down in size until the picture fits, as KindleGen did.
    for (const size of ['1600', '1200', '900']) {
      if (current.data.length <= maxBytes || current.type !== 'image/jpeg') break;
      current = await transcode(current, 'jpg', 'jpg', { size, quality: 75 }, transcodeImage, signal).catch(
        () => current,
      );
    }
    if (!accepted.includes(current.type)) continue; // Couldn't convert it; the image is left out.
    if (current.href !== resource.href) renamed.set(resource.href, current.href);
    resources.push(current);
  }
  if (!renamed.size && resources.length === book.resources.length) return book;

  const kept = new Set(resources.map((r) => r.href));
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    html: chapter.html.replace(/ src="([^"]*)"/g, (match, src: string) => {
      const href = renamed.get(src) ?? src;
      return kept.has(href) ? ` src="${href}"` : match;
    }),
  }));
  const coverId = resources.some((r) => r.id === book.coverId) ? book.coverId : undefined;
  return { ...book, chapters, resources, coverId };
}

async function transcode(
  resource: Resource,
  from: FormatId,
  to: 'jpg' | 'png',
  options: Record<string, string | number>,
  transcodeImage: typeof import('../image').transcodeImage,
  signal: AbortSignal,
): Promise<Resource> {
  const blob = await transcodeImage(
    new Blob([resource.data as BlobPart], { type: resource.type }),
    from,
    to,
    { size: 'original', quality: 88, background: '#ffffff', ...options },
    signal,
  );
  return {
    ...resource,
    href: resource.href.replace(/\.[^./]+$/, `.${to}`),
    type: TYPE_FOR_FORMAT[to] as string,
    data: new Uint8Array(await blob.arrayBuffer()),
  };
}
