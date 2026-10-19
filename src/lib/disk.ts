/**
 * Very large video outputs are written to the origin-private file system
 * instead of memory. Files are named after the tab that made them, and each tab
 * holds a Web Lock for its lifetime, so a cleanup in one tab never deletes a
 * file another open tab is still offering for download.
 */

const SESSION_ID = Math.random().toString(36).slice(2, 10);
const lockName = (session: string) => `decant-session-${session}`;

/** Prefix for this tab's temporary files. */
export const DISK_PREFIX = `decant-${SESSION_ID}-`;

/** Holds this tab's lock until the tab closes. */
export function holdSessionLock() {
  navigator.locks?.request(lockName(SESSION_ID), () => new Promise<never>(() => {})).catch(() => {});
}

/** Removes temporary files left by tabs that are no longer open. */
export async function sweepDisk() {
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;
  const held = new Set(((await navigator.locks?.query())?.held ?? []).map((lock) => lock.name));
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    const session = /^decant-([a-z0-9]+)-/.exec(name)?.[1];
    if (!session || session === SESSION_ID || held.has(lockName(session))) continue;
    await root.removeEntry(name).catch(() => {});
  }
}

export async function removeDiskFile(name: string) {
  const root = await navigator.storage?.getDirectory?.();
  await root?.removeEntry(name).catch(() => {});
}
