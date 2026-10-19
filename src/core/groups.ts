import type { Category, FormatId } from './formats';
import { defaultOptions, type OptionDef, type Options, optionsFor } from './options';
import { canConvert, targetsFor } from './routes';

/**
 * Files are grouped by kind (images, audio...) so a mixed drop of HEIC, PNG and
 * JPG photos converts to one chosen format in one go.
 */

/** Popularity order used when a group mixes several source formats. */
const CATEGORY_TARGET_ORDER: Record<Category, FormatId[]> = {
  image: ['jpg', 'png', 'webp', 'avif', 'pdf', 'ico', 'jxl', 'gif', 'tiff', 'bmp', 'mp4', 'webm'],
  audio: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'],
  video: ['mp4', 'mp3', 'gif', 'webm', 'mov', 'mkv', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'],
  document: ['md', 'html', 'txt', 'png', 'jpg', 'webp'],
  data: ['xlsx', 'csv', 'json', 'yaml', 'tsv', 'ods', 'toml', 'xml'],
};

export const CATEGORY_NOUNS: Record<Category, string> = {
  image: 'images',
  audio: 'audio',
  video: 'videos',
  document: 'documents',
  data: 'data',
};

/** Every target at least one of the sources can become, most popular first. */
export function groupTargets(category: Category, sources: FormatId[]): FormatId[] {
  const unique = [...new Set(sources)];
  if (unique.length === 1) return [...targetsFor(unique[0] as FormatId)];
  const available = new Set(unique.flatMap((from) => targetsFor(from)));
  const ordered = CATEGORY_TARGET_ORDER[category].filter((to) => available.has(to));
  // Anything not in the popularity list goes last, in a stable order.
  for (const to of available) if (!ordered.includes(to)) ordered.push(to);
  return ordered;
}

/** Options that apply to at least one file in the group, merged by key. */
export function groupOptionDefs(sources: FormatId[], target: FormatId): OptionDef[] {
  const defs: OptionDef[] = [];
  const keys = new Set<string>();
  for (const from of new Set(sources)) {
    if (!canConvert(from, target)) continue;
    for (const def of optionsFor(from, target)) {
      if (keys.has(def.key)) continue;
      keys.add(def.key);
      defs.push(def);
    }
  }
  return defs;
}

export function groupDefaultOptions(sources: FormatId[], target: FormatId): Options {
  const options: Options = {};
  for (const from of new Set(sources)) {
    if (!canConvert(from, target)) continue;
    for (const [key, value] of Object.entries(defaultOptions(from, target))) {
      if (!(key in options)) options[key] = value;
    }
  }
  return options;
}
