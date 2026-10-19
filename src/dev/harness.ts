/**
 * Development-only helpers for exercising conversions from the browser console:
 *   await decantTest.run('sample.heic', 'jpg')
 * Fixtures are served by the dev server from tests/fixtures.
 */
import { type FormatId, getFormat } from '../core/formats';
import { addFiles, clearAll, convertGroup, getState, setOption, setTarget } from '../state/jobs';

/** "sample.png" loads from tests/fixtures; ".large/clip.mov" from tests/.large (not committed). */
async function fixture(name: string): Promise<File> {
  const path = name.includes('/') ? `/tests/${name}` : `/tests/fixtures/${name}`;
  const response = await fetch(`${path}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`Missing fixture ${name}`);
  return new File([await response.blob()], name.split('/').pop() as string);
}

async function run(
  name: string,
  target: FormatId,
  options: Record<string, string | number | boolean> = {},
  timeoutMs = 60_000,
) {
  clearAll();
  addFiles([await fixture(name)]);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = performance.now();
  while (getState().jobs[0]?.status === 'detecting' && performance.now() - started < 5000) await wait(20);
  let job = getState().jobs[0];
  if (!job?.from || job.status === 'unsupported') return { name, target, status: 'unsupported' };
  const category = getFormat(job.from).category;
  setTarget(category, target);
  for (const [key, value] of Object.entries(options)) setOption(category, key, value);
  convertGroup(category);
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    job = getState().jobs[0];
    if (!job || job.status === 'done' || job.status === 'failed') break;
    await wait(25);
  }
  const ms = Math.round(performance.now() - t0);
  if (job?.status !== 'done') return { name, target, status: job?.status, error: job?.error, stage: job?.stage, ms };
  const outputs = await Promise.all(
    job.outputs.map(async (o) => ({
      name: o.name,
      size: o.blob.size,
      type: o.blob.type,
      head: Array.from(new Uint8Array(await o.blob.slice(0, 12).arrayBuffer()), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join(''),
      text: /^(text|application\/(json|yaml|toml|xml))/.test(o.blob.type) ? await o.blob.text() : undefined,
    })),
  );
  return { name, target, status: 'done', ms, outputs };
}

async function matrix(cases: [string, FormatId, Record<string, string | number | boolean>?][]) {
  const lines: string[] = [];
  for (const [name, target, options] of cases) {
    const r = await run(name, target, options ?? {});
    lines.push(
      `${name} → ${target}: ${r.status} ${r.ms ?? ''}ms ${r.error ?? ''} ${(r.outputs ?? []).map((o) => `${o.name} ${o.size}B ${o.head.slice(0, 16)}`).join(' | ')}`,
    );
  }
  return lines.join('\n');
}

Object.assign(window, { decantTest: { fixture, run, matrix, getState } });
