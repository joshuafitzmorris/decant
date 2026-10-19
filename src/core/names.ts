/** "IMG_0001.HEIC" → "IMG_0001" */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function outputName(source: string, ext: string, suffix = ''): string {
  return `${baseName(source)}${suffix}.${ext}`;
}

/** Makes names unique within one archive: "photo.jpg", "photo (2).jpg", … */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = `${stem} (${count + 1})${ext}`;
    for (let n = count + 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    seen.set(candidate.toLowerCase(), 1);
    return candidate;
  });
}
