import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Category, getFormat } from '../core/formats';
import { readableFormats } from '../core/routes';
import { pageMeta, type Route } from '../core/seo';
import { zipFiles } from '../core/zip';
import {
  addFiles,
  categoryOf,
  clearAll,
  convertAll,
  hasUnsavedWork,
  type Job,
  markSaved,
  pendingJobs,
  removeJob,
  useAppState,
} from '../state/jobs';
import { isTouchDevice } from './device';
import { Footer } from './Footer';
import { plural } from './format';
import { GroupPanel } from './GroupPanel';
import { Guide } from './Guide';
import { Header, SUPPORT_URL } from './Header';
import { Intro } from './Intro';
import { CupIcon, DownloadIcon, Mark, PlusIcon } from './icons';
import { JobRow } from './JobRow';
import { saveBlob } from './save';
import { inlineLink, quietButton } from './ui';
import { useFileIntake } from './useFileIntake';
import { useTabTitle } from './useTabTitle';

const ACCEPT = readableFormats()
  .flatMap((id) => getFormat(id).exts.map((ext) => `.${ext}`))
  .join(',');

/** The whole app. `route` says which page it's on: home, a conversion like /heic-to-jpg/, or a format's page. */
export function App({ route }: { route: Route }) {
  const jobs = useAppState((s) => s.jobs);
  const groups = useAppState((s) => s.groups);
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const missing = useMissingPath(route);

  const onFiles = useCallback((files: File[]) => addFiles(files), []);
  const dragging = useFileIntake(onFiles);
  const choose = useCallback(() => inputRef.current?.click(), []);
  const accept = useAccept();

  // Groups appear in the order their first file was added.
  const sections = useMemo(() => {
    const order: Category[] = [];
    const byCategory = new Map<Category, Job[]>();
    const others: Job[] = [];
    for (const job of jobs) {
      const category = categoryOf(job);
      if (job.status === 'detecting' || job.status === 'unsupported' || !category || !groups[category]) {
        others.push(job);
        continue;
      }
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        order.push(category);
      }
      byCategory.get(category)?.push(job);
    }
    return { order, byCategory, others };
  }, [jobs, groups]);

  const empty = jobs.length === 0;
  useTabTitle(jobs, missing ? 'Page not found | Decant' : pageMeta(route).title);

  // The button that added the first files disappears with the intro; keep keyboard focus nearby.
  const wasEmpty = useRef(empty);
  useEffect(() => {
    if (wasEmpty.current && !empty && document.activeElement === document.body) {
      mainRef.current?.focus({ preventScroll: true });
    }
    wasEmpty.current = empty;
  }, [empty]);

  // Ask before leaving while something is converting or a result hasn't been saved.
  const unsaved = useAppState(hasUnsavedWork);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  return (
    <div className="mx-auto w-full max-w-[72rem] px-[clamp(1.25rem,5vw,4rem)]">
      <Header />

      <main ref={mainRef} tabIndex={-1} className={`outline-none ${empty ? '' : 'pb-20 sm:pb-28'}`}>
        {empty ? (
          <Intro onChoose={choose} route={route} missing={missing} />
        ) : (
          <>
            {sections.order.map((category) => {
              const group = groups[category];
              if (!group) return null;
              return (
                <GroupPanel
                  key={category}
                  group={group}
                  jobs={sections.byCategory.get(category) ?? []}
                  prominent={sections.order.length === 1}
                />
              );
            })}
            {sections.others.length > 0 && (
              <section aria-label="Other files" className="pt-12">
                <ul className="divide-y divide-rule border-y border-rule">
                  {sections.others.map((job, i) => (
                    <JobRow key={job.id} job={job} index={i} />
                  ))}
                </ul>
              </section>
            )}
            <SessionBar jobs={jobs} groupCount={sections.order.length} onAdd={choose} />
          </>
        )}
      </main>

      {empty && <Guide route={route} />}
      <Footer />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) addFiles(files);
        }}
      />

      {dragging && <DropOverlay />}
      <LiveAnnouncer jobs={jobs} />
    </div>
  );
}

/**
 * The file picker's filter. Touch pickers grey out every file whose type the device doesn't know,
 * which on an iPhone includes Kindle books, FB2, CBZ, MKV and TOML, so phones and tablets get an
 * unfiltered picker. Decant reads each file to work out its format anyway, and explains any it can't use.
 */
function useAccept(): string | undefined {
  const [accept, setAccept] = useState<string | undefined>(ACCEPT);
  useEffect(() => {
    if (isTouchDevice()) setAccept(undefined);
  }, []);
  return accept;
}

/** On the 404 page, which is the home page under an unknown URL, the path that was asked for. */
function useMissingPath(route: Route): string | null {
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const path = window.location.pathname;
    if (route.kind !== 'home' || path === base || path === `${base}index.html`) return;
    try {
      setMissing(decodeURI(path));
    } catch {
      setMissing(path);
    }
  }, [route]);
  return missing;
}

function SessionBar({ jobs, groupCount, onAdd }: { jobs: Job[]; groupCount: number; onAdd: () => void }) {
  const groups = useAppState((s) => s.groups);
  const [zipping, setZipping] = useState(false);
  const finished = jobs.filter((j) => j.status === 'done' && !j.stale);
  const outputs = finished.flatMap((j) => j.outputs);
  const groupsWithOutputs = new Set(finished.map(categoryOf)).size;
  const pending = Object.values(groups).reduce((sum, group) => sum + (group ? pendingJobs(jobs, group).length : 0), 0);
  const unreadable = jobs.filter((j) => j.status === 'unsupported');

  // A quiet thank-you once everything converted has been saved; never before, and never in the way.
  const allSaved = outputs.length > 0 && outputs.every((o) => o.saved) && pending === 0 && !jobs.some(isBusy);

  return (
    <>
      <div className="-mx-3 mt-4 flex flex-wrap items-center gap-x-1 gap-y-1">
        <button type="button" onClick={onAdd} className={quietButton}>
          <PlusIcon /> Add files
        </button>
        {groupCount > 1 && pending > 0 && (
          <button type="button" onClick={convertAll} className={quietButton}>
            Convert all {plural(pending, 'file')}
          </button>
        )}
        {groupsWithOutputs > 1 && (
          <button
            type="button"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              try {
                saveBlob(await zipFiles(outputs), 'decant.zip');
                markSaved(outputs);
              } finally {
                setZipping(false);
              }
            }}
            className={quietButton}
          >
            <DownloadIcon /> {zipping ? 'Zipping…' : `Save all ${outputs.length} as a ZIP`}
          </button>
        )}
        {unreadable.length > 0 && (
          <button
            type="button"
            onClick={() => {
              for (const j of unreadable) removeJob(j.id);
            }}
            className={quietButton}
          >
            Remove unsupported files
          </button>
        )}
        <button type="button" onClick={clearAll} className={`${quietButton} sm:ml-auto`}>
          Start over
        </button>
      </div>
      {allSaved && (
        <p className="status-in mt-6 flex items-start gap-2.5 text-ink-2 [text-wrap:pretty]">
          <CupIcon className="mt-[0.2rem] shrink-0" />
          <span>
            All saved. If that helped, you can{' '}
            <a href={SUPPORT_URL} target="_blank" rel="noopener" className={inlineLink}>
              buy me a coffee
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </span>
        </p>
      )}
    </>
  );
}

const isBusy = (job: Job) => job.status === 'working' || job.status === 'queued' || job.status === 'detecting';

function DropOverlay() {
  return (
    <div className="drop-overlay pointer-events-none fixed inset-0 z-50 grid place-items-center bg-paper/85 backdrop-blur-sm">
      <div className="flex flex-col items-center text-center">
        <Mark width={88} height={88} />
        <p className="mt-6 text-[clamp(2rem,5vw,3.25rem)] leading-none font-[780] tracking-[-0.03em] [font-variation-settings:'wdth'_78]">
          Drop to add
        </p>
        <p className="mt-3 text-ink-2">Whole folders work too.</p>
      </div>
    </div>
  );
}

/** Announces finished and failed conversions to screen readers. */
function LiveAnnouncer({ jobs }: { jobs: Job[] }) {
  const [message, setMessage] = useState('');
  const seen = useRef(new Map<string, string>());
  const repeat = useRef(false);
  useEffect(() => {
    const converted: string[] = [];
    const failed: string[] = [];
    for (const job of jobs) {
      if (seen.current.get(job.id) === job.status) continue;
      seen.current.set(job.id, job.status);
      if (job.status === 'done') converted.push(job.file.name);
      if (job.status === 'failed') failed.push(job.file.name);
    }
    const parts: string[] = [];
    if (converted.length)
      parts.push(converted.length === 1 ? `Converted ${converted[0]}.` : `Converted ${converted.length} files.`);
    if (failed.length)
      parts.push(failed.length === 1 ? `Couldn’t convert ${failed[0]}.` : `Couldn’t convert ${failed.length} files.`);
    if (parts.length === 0) return;
    // Screen readers skip an unchanged message, so alternate an invisible character to repeat one.
    repeat.current = !repeat.current;
    setMessage(parts.join(' ') + (repeat.current ? '\u200b' : ''));
  }, [jobs]);
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
