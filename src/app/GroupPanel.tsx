import { useMemo, useState } from 'react';
import { CATEGORY_NAMES, displayName, type FormatId, getFormat } from '../core/formats';
import { CATEGORY_NOUNS, groupOptionDefs, groupTargets } from '../core/groups';
import { baseName } from '../core/names';
import { zipFiles } from '../core/zip';
import {
  cancelJob,
  convertGroup,
  type Group,
  isConvertible,
  type Job,
  markSaved,
  pendingJobs,
  setOption,
  setTarget,
} from '../state/jobs';
import { isAppleTouchDevice } from './device';
import { plural } from './format';
import { CheckIcon, DownloadIcon, SpinnerIcon } from './icons';
import { JobRow } from './JobRow';
import { OptionsPanel } from './OptionsPanel';
import { Pour } from './Pour';
import { saveBlob } from './save';
import { fieldLabel, primaryButton, secondaryButton } from './ui';

interface GroupPanelProps {
  group: Group;
  jobs: Job[];
  prominent: boolean;
}

export function GroupPanel({ group, jobs, prominent }: GroupPanelProps) {
  const target = getFormat(group.target);
  const t = displayName(group.target);
  const sources = useMemo(() => [...new Set(jobs.flatMap((j) => (j.from ? [j.from] : [])))], [jobs]);
  const targets = useMemo(() => groupTargets(group.category, sources), [group.category, sources]);
  const defs = useMemo(() => groupOptionDefs(sources, group.target), [sources, group.target]);
  const [zipping, setZipping] = useState(false);
  const [merging, setMerging] = useState(false);

  const convertible = jobs.filter((j) => isConvertible(j, group));
  const active = convertible.filter((j) => j.status === 'working' || j.status === 'queued');
  const pending = pendingJobs(jobs, group);
  const finished = convertible.filter((j) => j.status === 'done' && !j.stale);
  const outputs = finished.flatMap((j) => j.outputs);
  const complete = convertible.length > 0 && finished.length === convertible.length;
  const saved = outputs.length > 0 && outputs.every((o) => o.saved);

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
      markSaved(outputs);
      return;
    }
    setZipping(true);
    try {
      // One source with several results (PDF pages, workbook sheets) is named after that file.
      const name =
        finished.length === 1 && finished[0]
          ? `${baseName(finished[0].file.name)}.zip`
          : `${CATEGORY_NAMES[group.category]} as ${t}.zip`;
      saveBlob(await zipFiles(outputs), name);
      markSaved(outputs);
    } finally {
      setZipping(false);
    }
  };

  // Several images converted to PDF can also be saved as one document, in the order they were added.
  const canMerge = group.target === 'pdf' && outputs.length > 1;
  const saveMerged = async () => {
    setMerging(true);
    try {
      const { mergePdfs } = await import('../engines/pdf');
      const first = finished[0];
      saveBlob(
        await mergePdfs(outputs.map((o) => o.blob)),
        `${first ? baseName(first.file.name) : 'images'}-combined.pdf`,
      );
      markSaved(outputs);
    } finally {
      setMerging(false);
    }
  };

  const noteFor = (job: Job): string | undefined => {
    if (!job.from || isConvertible(job, group)) return undefined;
    return job.from === group.target ? `Already ${t}` : `Can’t convert to ${t}`;
  };

  const headingId = `group-${group.category}`;

  return (
    <section
      aria-labelledby={headingId}
      data-liquid={target.category}
      className={prominent ? 'pt-[clamp(1.5rem,6vh,4.5rem)]' : 'pt-14 first:pt-[clamp(1.5rem,6vh,4.5rem)]'}
    >
      <h2 id={headingId} className="sr-only">
        {CATEGORY_NAMES[group.category]}: {plural(jobs.length, 'file')} to convert to {t}
      </h2>
      <Pour
        from={sourceLabel}
        to={`.${target.exts[0]}`}
        fill={fill}
        pouring={active.length > 0}
        done={complete}
        animate
        liquid={target.category}
        size={prominent ? 'hero' : 'section'}
        label={`${sources.length === 1 ? displayName(sources[0] as FormatId) : CATEGORY_NAMES[group.category]} to ${t}`}
      />

      {/* The settings and what to do with them, as one panel. */}
      <div className="mt-8 rounded-panel border border-rule bg-surface sm:mt-10">
        <div className="@container space-y-5 p-4 sm:p-6">
          <fieldset>
            <legend className={`${fieldLabel} mb-2.5`}>Convert to</legend>
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
        </div>

        {/* On a phone the buttons widen to fill their rows, so a wrapped pair still looks deliberate. */}
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-4 max-sm:*:grow sm:px-6">
          {active.length > 0 ? (
            <>
              <button type="button" disabled className={`${primaryButton} disabled:cursor-progress`}>
                <SpinnerIcon className="animate-spin motion-reduce:animate-none" />
                Converting{active.length > 1 ? ` ${plural(active.length, 'file')}` : ''}…
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
              {pending.length === 1 ? `Convert to ${t}` : `Convert ${pending.length} files to ${t}`}
            </button>
          ) : convertible.length === 0 ? (
            <p className="max-w-[60ch] py-1 text-ink-2 [text-wrap:pretty]">{nothingToConvert(jobs, group.target)}</p>
          ) : null}

          {canMerge && (
            <button
              type="button"
              onClick={saveMerged}
              disabled={merging}
              className={`pop ${pending.length === 0 && active.length === 0 ? primaryButton : secondaryButton}`}
            >
              <DownloadIcon />
              {merging ? 'Combining…' : 'Save as one PDF'}
            </button>
          )}

          {outputs.length > 0 && (
            <button
              type="button"
              onClick={downloadAll}
              disabled={zipping}
              className={`pop ${pending.length === 0 && active.length === 0 && !canMerge ? primaryButton : secondaryButton}`}
            >
              {saved ? <CheckIcon className="check-draw" /> : <DownloadIcon />}
              <span className="min-w-0 truncate">
                {zipping
                  ? 'Zipping…'
                  : outputs.length === 1
                    ? `Save ${outputs[0]?.name}`
                    : active.length > 0
                      ? `Save ${outputs.length} so far as a ZIP`
                      : `Save all ${outputs.length} as a ZIP`}
              </span>
            </button>
          )}
        </div>
      </div>

      <ul className="mt-6 divide-y divide-rule border-y border-rule sm:mt-8">
        {jobs.map((job, i) => (
          <JobRow key={job.id} job={job} note={noteFor(job)} index={i} />
        ))}
      </ul>
    </section>
  );
}

/** Why none of a group's files can become its target, and what to do instead. */
function nothingToConvert(jobs: Job[], target: FormatId): string {
  const t = displayName(target);
  const one = jobs.length === 1;
  if (!jobs.every((job) => job.from === target)) {
    return `${one ? 'This file' : 'These files'} can’t be converted to ${t}. Pick another format above.`;
  }
  const already = `${one ? 'This file is' : 'These files are'} already ${t}.`;
  // The photo picker on iPhone and iPad converts HEIC photos to JPG unless told not to.
  if (target === 'jpg' && isAppleTouchDevice()) {
    return `${already} iPhone and iPad hand over JPG copies of photos picked from the library. To convert the original HEIC instead, tap ⋯ in the photo picker, then Options, and choose Current.`;
  }
  return `${already} Pick another format above.`;
}

function TargetChip({ id, selected, onSelect }: { id: FormatId; selected: boolean; onSelect: () => void }) {
  const format = getFormat(id);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={format.name}
      onClick={onSelect}
      className={`h-9 min-w-[3.25rem] rounded-field border px-3 font-[620] tracking-[0.02em] transition-[color,background-color,border-color,scale] active:scale-[0.96] [font-variation-settings:'wdth'_88] ${
        selected ? 'border-ink bg-ink text-on-ink' : 'border-rule-strong text-ink-2 hover:border-ink-3 hover:text-ink'
      }`}
    >
      {format.label}
    </button>
  );
}
