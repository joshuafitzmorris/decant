/** Joins a number to its unit so the two never wrap onto separate lines. */
const NBSP = '\u00a0';

/** 2_400_000 → "2.4 MB" (decimal units, like macOS Finder). */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes}${NBSP}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${NBSP}${units[unit]}`;
}

/** 38 → "38 ms", 1412 → "1.4 s", 75_000 → "1 min 15 s" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}${NBSP}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}${NBSP}s`;
  // Round once, before splitting, so 119.6 s reads "2 min" rather than "1 min 60 s".
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}${NBSP}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}${NBSP}min ${seconds}${NBSP}s` : `${minutes}${NBSP}min`;
}

/** Size change as a short phrase: "54% smaller", "2.1× larger". */
export function describeSizeChange(before: number, after: number): string | null {
  if (before <= 0 || after <= 0) return null;
  const ratio = after / before;
  if (ratio < 0.995) return `${Math.round((1 - ratio) * 100)}% smaller`;
  if (ratio > 1.005) return ratio >= 2 ? `${ratio.toFixed(1)}× larger` : `${Math.round((ratio - 1) * 100)}% larger`;
  return 'same size';
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
