import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Category, getFormat } from '../core/formats';
import { landingCopy, pairFromPath } from '../core/landing';
import { readableFormats } from '../core/routes';
import { zipFiles } from '../core/zip';
import {
  addFiles,
  categoryOf,
  clearAll,
  convertAll,
  type Job,
  pendingJobs,
  preferTarget,
  removeJob,
  useAppState,
} from '../state/jobs';
import { Footer } from './Footer';
import { plural } from './format';
import { GroupPanel } from './GroupPanel';
import { Header } from './Header';
import { Intro } from './Intro';
import { DownloadIcon, PlusIcon } from './icons';
import { JobRow } from './JobRow';
import { saveBlob } from './save';
import { useFileIntake } from './useFileIntake';

/** On a landing page such as /decant/heic-to-jpg/, open with that pair and default to it. */
const LANDING = pairFromPath(window.location.pathname, import.meta.env.BASE_URL);
if (LANDING) {
  preferTarget(LANDING.from, LANDING.to);
  // The offline copy of the page is shared by every URL, so set the title here too.
  document.title = landingCopy(LANDING.from, LANDING.to).title;
}

const ACCEPT = readableFormats()
  .flatMap((id) => getFormat(id).exts.map((ext) => `.${ext}`))
  .join(',');

export function App() {
  const jobs = useAppState((s) => s.jobs);
  const groups = useAppState((s) => s.groups);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback((files: File[]) => addFiles(files), []);
  const dragging = useFileIntake(onFiles);
  const choose = useCallback(() => inputRef.current?.click(), []);

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

  return (
    <div className="mx-auto w-full max-w-[72rem] px-[clamp(1.25rem,5vw,4rem)]">
      <Header onHome={empty ? undefined : clearAll} />

      <main>
        {empty ? (
          <Intro onChoose={choose} pair={LANDING} />
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
              <section aria-label="Other files" className="pt-14">
                <ul className="divide-y divide-rule border-y border-rule">
                  {sections.others.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </ul>
              </section>
            )}
            <SessionBar jobs={jobs} groupCount={sections.order.length} onAdd={choose} />
          </>
        )}
      </main>

      <Footer />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
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

function SessionBar({ jobs, groupCount, onAdd }: { jobs: Job[]; groupCount: number; onAdd: () => void }) {
  const groups = useAppState((s) => s.groups);
  const [zipping, setZipping] = useState(false);
  const finished = jobs.filter((j) => j.status === 'done' && !j.stale);
  const outputs = finished.flatMap((j) => j.outputs);
  const groupsWithOutputs = new Set(finished.map(categoryOf)).size;
  const pending = Object.values(groups).reduce((sum, group) => sum + (group ? pendingJobs(jobs, group).length : 0), 0);
  const unreadable = jobs.filter((j) => j.status === 'unsupported');

  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-ink-2">
      <button type="button" onClick={onAdd} className="inline-flex items-center gap-2 font-[560] hover:text-ink">
        <PlusIcon /> Add files
      </button>
      {groupCount > 1 && pending > 0 && (
        <button type="button" onClick={convertAll} className="font-[560] hover:text-ink">
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
            } finally {
              setZipping(false);
            }
          }}
          className="inline-flex items-center gap-2 font-[560] hover:text-ink"
        >
          <DownloadIcon /> {zipping ? 'Zipping…' : `Save all ${outputs.length} as ZIP`}
        </button>
      )}
      {unreadable.length > 0 && (
        <button
          type="button"
          onClick={() => {
            for (const j of unreadable) removeJob(j.id);
          }}
          className="font-[560] hover:text-ink"
        >
          Remove unsupported files
        </button>
      )}
      <button type="button" onClick={clearAll} className="font-[560] hover:text-ink sm:ml-auto">
        Start over
      </button>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-paper/85 backdrop-blur-sm">
      <div className="rounded-3xl border-2 border-dashed border-ink-3 px-12 py-10 text-center">
        <p className="text-[clamp(1.75rem,4vw,2.75rem)] font-[760] [font-variation-settings:'wdth'_80]">Drop to add</p>
        <p className="mt-1 text-ink-2">Files and folders both work</p>
      </div>
    </div>
  );
}

/** Announces finished and failed conversions to screen readers. */
function LiveAnnouncer({ jobs }: { jobs: Job[] }) {
  const [message, setMessage] = useState('');
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const job of jobs) {
      const previous = seen.current.get(job.id);
      if (previous !== job.status) {
        seen.current.set(job.id, job.status);
        if (job.status === 'done') setMessage(`Converted ${job.file.name}`);
        if (job.status === 'failed') setMessage(`Couldn't convert ${job.file.name}`);
      }
    }
  }, [jobs]);
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
