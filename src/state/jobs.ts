import { useSyncExternalStore } from 'react';
import { ENGINE_CONCURRENCY, loadEngine } from '../core/engines';
import { type Category, type FormatId, getFormat } from '../core/formats';
import { groupDefaultOptions, groupOptionDefs, groupTargets } from '../core/groups';
import { outputName } from '../core/names';
import type { Options, OptionValue } from '../core/options';
import { canConvert, type EngineId, engineFor, targetsFor } from '../core/routes';
import { detectFormat } from '../core/sniff';
import { ConversionError, isAbortError } from '../engines/types';

export type JobStatus = 'detecting' | 'unsupported' | 'ready' | 'queued' | 'working' | 'done' | 'failed';

export interface Output {
  name: string;
  blob: Blob;
  url: string;
  /** Set once the person has saved this result, so leaving the page doesn't need a warning. */
  saved?: boolean;
}

export interface Job {
  id: string;
  file: File;
  from: FormatId | null;
  status: JobStatus;
  progress: number | null;
  stage?: string;
  outputs: Output[];
  error?: string;
  /** The target this job was queued with. */
  target?: FormatId;
  startedAt?: number;
  finishedAt?: number;
  /** Results exist but the group's target or options have changed since. */
  stale?: boolean;
}

/** All files of one kind (images, audio...) share a target format and options. */
export interface Group {
  category: Category;
  target: FormatId;
  options: Options;
  /** Set once the person picks a target; until then the default follows the files added. */
  chosen?: boolean;
}

export interface State {
  jobs: Job[];
  groups: Partial<Record<Category, Group>>;
}

// ---------------------------------------------------------------------------
// Store

let state: State = { jobs: [], groups: {} };
const listeners = new Set<() => void>();

function setState(update: (current: State) => State) {
  state = update(state);
  for (const listener of listeners) listener();
}

export function getState(): State {
  return state;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Selectors must return existing references (not new arrays) to avoid render loops. */
export function useAppState<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function updateJob(id: string, patch: Partial<Job> | ((job: Job) => Partial<Job>)) {
  setState((s) => ({
    ...s,
    jobs: s.jobs.map((job) =>
      job.id === id ? { ...job, ...(typeof patch === 'function' ? patch(job) : patch) } : job,
    ),
  }));
}

export function categoryOf(job: Job): Category | null {
  return job.from ? getFormat(job.from).category : null;
}

/** Source formats present in a group, in the order they were added. */
export function groupSources(jobs: Job[], category: Category): FormatId[] {
  const sources: FormatId[] = [];
  for (const job of jobs)
    if (job.from && categoryOf(job) === category && !sources.includes(job.from)) sources.push(job.from);
  return sources;
}

/** Whether a job takes part when its group converts to the group's target. */
export function isConvertible(job: Job, group: Group | undefined): boolean {
  return !!job.from && !!group && canConvert(job.from, group.target);
}

// ---------------------------------------------------------------------------
// Actions

let idCounter = 0;

/** Targets to default to per kind of file, e.g. from a /heic-to-jpg/ landing page. */
const preferredTargets: Partial<Record<Category, FormatId>> = {};

export function preferTarget(from: FormatId, to: FormatId) {
  preferredTargets[getFormat(from).category] = to;
}

export function addFiles(files: File[]) {
  const fresh: Job[] = files.map((file) => ({
    id: `job-${++idCounter}`,
    file,
    from: null,
    status: 'detecting',
    progress: null,
    outputs: [],
  }));
  if (fresh.length === 0) return;
  setState((s) => ({ ...s, jobs: [...s.jobs, ...fresh] }));

  for (const job of fresh) {
    detectFormat(job.file)
      .catch(() => null)
      .then((from) => {
        if (!state.jobs.some((j) => j.id === job.id)) return;
        if (!from || targetsFor(from).length === 0) {
          updateJob(job.id, { status: 'unsupported', from });
          return;
        }
        setState((s) => {
          const category = getFormat(from).category;
          const jobs = s.jobs.map((j) => (j.id === job.id ? { ...j, from, status: 'ready' as const } : j));
          const existing = s.groups[category];
          const sources = groupSources(jobs, category);
          if (existing?.chosen) {
            // Fill in defaults for options this new kind of file brings with it.
            const options = { ...groupDefaultOptions(sources, existing.target), ...existing.options };
            return { jobs, groups: { ...s.groups, [category]: { ...existing, options } } };
          }
          // Until the person chooses, default to the preferred or most popular target for the whole mix.
          const available = groupTargets(category, sources);
          const preferred = preferredTargets[category];
          const target = (preferred && available.includes(preferred) ? preferred : available[0]) as FormatId;
          const options =
            existing && existing.target === target
              ? { ...groupDefaultOptions(sources, target), ...existing.options }
              : groupDefaultOptions(sources, target);
          return { jobs, groups: { ...s.groups, [category]: { category, target, options } } };
        });
      });
  }
}

export function setTarget(category: Category, target: FormatId) {
  const group = state.groups[category];
  if (!group || group.target === target) return;
  // Keep values the new target also understands (size, trim...); quality scales differ per format.
  const sources = groupSources(state.jobs, category);
  const validKeys = new Set(groupOptionDefs(sources, target).map((d) => d.key));
  const kept = Object.fromEntries(
    Object.entries(group.options).filter(([key]) => validKeys.has(key) && key !== 'quality' && key !== 'bitrate'),
  );
  setState((s) => ({
    groups: {
      ...s.groups,
      [category]: { category, target, chosen: true, options: { ...groupDefaultOptions(sources, target), ...kept } },
    },
    jobs: markStale(s.jobs, category).map((job) =>
      categoryOf(job) === category && job.status === 'queued' ? { ...job, target } : job,
    ),
  }));
}

export function setOption(category: Category, key: string, value: OptionValue) {
  const group = state.groups[category];
  if (!group || group.options[key] === value) return;
  setState((s) => ({
    groups: { ...s.groups, [category]: { ...group, options: { ...group.options, [key]: value } } },
    jobs: markStale(s.jobs, category),
  }));
}

/** Results made with older settings stay downloadable but are flagged for re-conversion. */
function markStale(jobs: Job[], category: Category): Job[] {
  const settled = (job: Job) => job.status === 'done' || job.status === 'failed' || job.status === 'working';
  return jobs.map((job) => (categoryOf(job) === category && settled(job) ? { ...job, stale: true } : job));
}

/** Jobs in a group that have no up-to-date result for the current target. */
export function pendingJobs(jobs: Job[], group: Group): Job[] {
  return jobs.filter(
    (job) =>
      categoryOf(job) === group.category &&
      isConvertible(job, group) &&
      (job.status === 'ready' || job.status === 'failed' || (job.status === 'done' && job.stale)),
  );
}

export function convertGroup(category: Category) {
  const group = state.groups[category];
  if (!group) return;
  const pending = new Set(pendingJobs(state.jobs, group).map((j) => j.id));
  if (pending.size === 0) return;
  setState((s) => ({
    // Converting commits to the target, so files added later don't change it.
    groups: { ...s.groups, [category]: { ...group, chosen: true } },
    jobs: s.jobs.map((job) => {
      if (!pending.has(job.id)) return job;
      revokeOutputs(job);
      return {
        ...job,
        status: 'queued' as const,
        target: group.target,
        progress: null,
        stage: undefined,
        error: undefined,
        outputs: [],
        stale: false,
      };
    }),
  }));
  pump();
}

export function convertAll() {
  for (const category of Object.keys(state.groups) as Category[]) convertGroup(category);
}

export function markSaved(outputs: Output[]) {
  const urls = new Set(outputs.map((o) => o.url));
  setState((s) => ({
    ...s,
    jobs: s.jobs.map((job) =>
      job.outputs.some((o) => urls.has(o.url))
        ? { ...job, outputs: job.outputs.map((o) => (urls.has(o.url) ? { ...o, saved: true } : o)) }
        : job,
    ),
  }));
}

/** True while a conversion is running or a result hasn't been saved yet. */
export function hasUnsavedWork(s: State): boolean {
  return s.jobs.some(
    (job) => job.status === 'working' || job.status === 'queued' || job.outputs.some((output) => !output.saved),
  );
}

export function retryJob(id: string) {
  const job = state.jobs.find((j) => j.id === id);
  const category = job ? categoryOf(job) : null;
  const group = category ? state.groups[category] : undefined;
  if (!job || !group || !isConvertible(job, group)) return;
  updateJob(id, {
    status: 'queued',
    target: group.target,
    progress: null,
    error: undefined,
    stage: undefined,
    stale: false,
  });
  pump();
}

export function cancelJob(id: string) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  if (job.status === 'working') controllers.get(id)?.abort();
  if (job.status === 'queued' || job.status === 'working')
    updateJob(id, { status: 'ready', progress: null, stage: undefined });
}

export function removeJob(id: string) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  controllers.get(id)?.abort();
  revokeOutputs(job);
  setState((s) => {
    const jobs = s.jobs.filter((j) => j.id !== id);
    return { jobs, groups: pruneGroups(s.groups, jobs) };
  });
}

export function clearAll() {
  for (const controller of controllers.values()) controller.abort();
  for (const job of state.jobs) revokeOutputs(job);
  setState(() => ({ jobs: [], groups: {} }));
}

function pruneGroups(groups: State['groups'], jobs: Job[]): State['groups'] {
  const used = new Set(jobs.map(categoryOf));
  return Object.fromEntries(Object.entries(groups).filter(([category]) => used.has(category as Category)));
}

function revokeOutputs(job: Job) {
  for (const output of job.outputs) URL.revokeObjectURL(output.url);
}

// ---------------------------------------------------------------------------
// Scheduler

const controllers = new Map<string, AbortController>();
const running: Record<EngineId, number> = { image: 0, media: 0, pdf: 0, docs: 0, data: 0 };

function pump() {
  for (const job of state.jobs) {
    if (job.status !== 'queued' || !job.from || !job.target) continue;
    const engine = engineFor(job.from, job.target);
    if (running[engine] >= ENGINE_CONCURRENCY[engine]) continue;
    void run(job, engine);
  }
}

async function run(job: Job, engineId: EngineId) {
  const from = job.from as FormatId;
  const target = job.target as FormatId;
  const category = getFormat(from).category;
  const options = { ...(state.groups[category]?.options ?? {}) };
  const controller = new AbortController();
  controllers.set(job.id, controller);
  running[engineId]++;
  updateJob(job.id, { status: 'working', progress: null, stage: 'Starting', startedAt: performance.now() });

  let lastUpdate = 0;
  const onProgress = (progress: number | null, stage?: string) => {
    const current = state.jobs.find((j) => j.id === job.id);
    if (!current || controller.signal.aborted) return;
    // Throttle re-renders; always let stage changes and completion through.
    const now = performance.now();
    if (stage === current.stage && progress !== 1 && now - lastUpdate < 80) return;
    lastUpdate = now;
    updateJob(job.id, {
      progress: progress === null ? null : Math.max(0, Math.min(1, progress)),
      stage: stage ?? current.stage,
    });
  };

  try {
    const engine = await loadEngine(engineId);
    const results = await engine.convert({
      file: job.file,
      from,
      to: target,
      options,
      signal: controller.signal,
      onProgress,
    });
    if (controller.signal.aborted) return;
    const ext = getFormat(target).exts[0] as string;
    const outputs: Output[] = results.map((result) => ({
      name: outputName(job.file.name, result.ext ?? ext, result.suffix),
      blob: result.blob,
      url: URL.createObjectURL(result.blob),
    }));
    updateJob(job.id, (current) => ({
      status: 'done',
      progress: 1,
      stage: undefined,
      outputs,
      finishedAt: performance.now(),
      stale: current.stale,
    }));
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return;
    if (import.meta.env.DEV) console.error('[decant]', error);
    updateJob(job.id, {
      status: 'failed',
      progress: null,
      stage: undefined,
      error: describeError(error),
      finishedAt: performance.now(),
    });
  } finally {
    controllers.delete(job.id);
    running[engineId]--;
    pump();
  }
}

function describeError(error: unknown): string {
  if (error instanceof ConversionError && error.code !== 'internal' && error.code !== 'crash') return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|out of bounds|RangeError/i.test(detail)) {
    return 'This file is too large for the browser to convert in one go.';
  }
  return "Something went wrong while converting this file. It may be damaged, or use a variant Decant can't handle.";
}
