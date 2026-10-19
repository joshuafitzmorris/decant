import { useMemo, useState } from 'react';
import { CATEGORY_NAMES, type FormatId, getFormat } from '../core/formats';
import { CATEGORY_NOUNS, groupOptionDefs, groupTargets } from '../core/groups';
import { zipFiles } from '../core/zip';
import {
  cancelJob,
  convertGroup,
  type Group,
  isConvertible,
  type Job,
  pendingJobs,
  setOption,
  setTarget,
} from '../state/jobs';
import { plural } from './format';
import { DownloadIcon } from './icons';
import { JobRow } from './JobRow';
import { OptionsPanel } from './OptionsPanel';
import { Pour } from './Pour';
import { saveBlob } from './save';

interface GroupPanelProps {
  group: Group;
  jobs: Job[];
  prominent: boolean;
}

export function GroupPanel({ group, jobs, prominent }: GroupPanelProps) {
  const target = getFormat(group.target);
  const sources = useMemo(() => [...new Set(jobs.flatMap((j) => (j.from ? [j.from] : [])))], [jobs]);
  const targets = useMemo(() => groupTargets(group.category, sources), [group.category, sources]);
  const defs = useMemo(() => groupOptionDefs(sources, group.target), [sources, group.target]);
  const [zipping, setZipping] = useState(false);

  const convertible = jobs.filter((j) => isConvertible(j, group));
  const active = convertible.filter((j) => j.status === 'working' || j.status === 'queued');
  const pending = pendingJobs(jobs, group);
  const finished = convertible.filter((j) => j.status === 'done' && !j.stale);
  const outputs = finished.flatMap((j) => j.outputs);

  const fill =
    convertible.length === 0
      ? 0
      : convertible.reduce((sum, j) => {
          if (j.status === 'done' && !j.stale) return sum + 1;
          if (j.status === 'working') return sum + (j.progress ?? 0) * 0.98;
          return sum;
        }, 0) / convertible.length;

  const sourceLabel =
    sources.length === 1 ? `.${getFormat(sources[0] as FormatId).exts[0]}` : CATEGORY_NOUNS[group.category];

  const downloadAll = async () => {
    if (outputs.length === 1 && outputs[0]) {
      saveBlob(outputs[0].blob, outputs[0].name);
      return;
    }
    setZipping(true);
    try {
      saveBlob(await zipFiles(outputs), `${CATEGORY_NOUNS[group.category]} as ${target.label}.zip`);
    } finally {
      setZipping(false);
    }
  };

  const noteFor = (job: Job): string | undefined => {
    if (!job.from || isConvertible(job, group)) return undefined;
    return job.from === group.target ? `Already ${target.label}` : `Can't become ${target.label}`;
  };

  const headingId = `group-${group.category}`;

  return (
    <section
      aria-labelledby={headingId}
      data-liquid={target.category}
      className={prominent ? 'pt-[clamp(1.5rem,6vh,4.5rem)]' : 'pt-14 first:pt-[clamp(1.5rem,6vh,4.5rem)]'}
    >
      <h2 id={headingId} className="sr-only">
        {CATEGORY_NAMES[group.category]}: {plural(jobs.length, 'file')} to convert to {target.label}
      </h2>
      <Pour
        from={sourceLabel}
        to={`.${target.exts[0]}`}
        fill={fill}
        pouring={active.length > 0}
        liquid={target.category}
        size={prominent ? 'hero' : 'section'}
      />

      <div className="mt-10 space-y-7">
        <fieldset>
          <legend className="mb-2.5 text-[0.8125rem] text-ink-2">Convert to</legend>
          <div className="flex flex-wrap gap-2">
            {targets.map((id) => (
              <TargetChip
                key={id}
                id={id}
                selected={id === group.target}
                onSelect={() => setTarget(group.category, id)}
              />
            ))}
          </div>
        </fieldset>

        <OptionsPanel
          defs={defs}
          values={group.options}
          onChange={(key, value) => setOption(group.category, key, value)}
        />

        <div className="flex flex-wrap items-center gap-3">
          {active.length > 0 ? (
            <>
              <button type="button" disabled className={primaryButton}>
                Converting{active.length > 1 ? ` ${plural(active.length, 'file')}` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  for (const j of active) cancelJob(j.id);
                }}
                className={secondaryButton}
              >
                Stop
              </button>
            </>
          ) : pending.length > 0 ? (
            <button type="button" onClick={() => convertGroup(group.category)} className={primaryButton}>
              {pending.length === 1
                ? `Convert to ${target.label}`
                : `Convert ${pending.length} files to ${target.label}`}
            </button>
          ) : null}

          {outputs.length > 0 && (
            <button
              type="button"
              onClick={downloadAll}
              disabled={zipping}
              className={pending.length === 0 && active.length === 0 ? primaryButton : secondaryButton}
            >
              <DownloadIcon />
              {zipping
                ? 'Zipping…'
                : outputs.length === 1
                  ? `Save ${outputs[0]?.name}`
                  : `Save all ${outputs.length} as ZIP`}
            </button>
          )}
        </div>
      </div>

      <ul className="mt-8 divide-y divide-rule border-y border-rule">
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} note={noteFor(job)} />
        ))}
      </ul>
    </section>
  );
}

const primaryButton =
  'inline-flex max-w-full items-center gap-2 truncate rounded-xl bg-ink px-5 py-3 font-[620] text-on-ink transition-[transform,opacity] active:scale-[0.98] disabled:cursor-default disabled:opacity-60';
const secondaryButton =
  'inline-flex max-w-full items-center gap-2 truncate rounded-xl border border-rule-strong px-5 py-3 font-[600] text-ink transition-colors hover:border-ink disabled:opacity-60';

function TargetChip({ id, selected, onSelect }: { id: FormatId; selected: boolean; onSelect: () => void }) {
  const format = getFormat(id);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={format.name}
      onClick={onSelect}
      className={`rounded-full border px-4 py-1.5 font-[620] tracking-[0.01em] transition-colors [font-variation-settings:'wdth'_88] ${
        selected ? 'border-ink bg-ink text-on-ink' : 'border-rule-strong text-ink-2 hover:border-ink-3 hover:text-ink'
      }`}
    >
      {format.label}
    </button>
  );
}
