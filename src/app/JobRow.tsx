import { type CSSProperties, memo, useEffect, useState } from 'react';
import { getFormat } from '../core/formats';
import { zipFiles } from '../core/zip';
import { cancelJob, type Job, markSaved, removeJob, retryJob } from '../state/jobs';
import { describeSizeChange, formatBytes, formatDuration, plural } from './format';
import { CheckIcon, CloseIcon, DownloadIcon, RetryIcon } from './icons';
import { saveBlob } from './save';

/** Formats every browser can show in an <img>, used for input thumbnails. */
const PREVIEWABLE = new Set(['jpg', 'png', 'webp', 'gif', 'avif', 'bmp', 'ico', 'svg']);

interface JobRowProps {
  job: Job;
  /** Shown instead of "Ready" for files the group's target doesn't apply to. */
  note?: string;
  /** Position in its list, so a batch of new files lands one after another. */
  index?: number;
}

export const JobRow = memo(function JobRow({ job, note, index = 0 }: JobRowProps) {
  return (
    <li
      style={{ '--delay': `${Math.min(index, 8) * 40}ms` } as CSSProperties}
      className="row-land grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_minmax(13rem,auto)_auto]"
    >
      <Thumbnail job={job} />
      <div className="min-w-0">
        <p className="truncate font-[540]" title={job.file.name}>
          {job.file.name}
        </p>
        <p className="text-[0.8125rem] text-ink-3 tabular">{formatBytes(job.file.size)}</p>
      </div>
      <div className="col-span-2 col-start-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
        <Status job={job} note={note} />
      </div>
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-1 sm:col-start-4">
        <RowActions job={job} />
      </div>
    </li>
  );
});

function Thumbnail({ job }: { job: Job }) {
  const firstOutput = job.outputs[0];
  const outputIsImage = firstOutput && /\.(jpe?g|png|webp|gif|avif|bmp|ico|svg)$/i.test(firstOutput.name);
  const inputUrl = useObjectUrl(job.from && PREVIEWABLE.has(job.from) && !outputIsImage ? job.file : null);
  const src = outputIsImage ? firstOutput.url : inputUrl;
  const category = job.from ? getFormat(job.from).category : null;
  const failed = job.status === 'failed';
  const [broken, setBroken] = useState<string | null>(null);

  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(src)}
        className="size-11 rounded-lg border border-rule bg-sunk object-cover"
      />
    );
  }
  return (
    <div
      data-liquid={category ?? undefined}
      aria-hidden="true"
      className="relative grid size-11 place-items-center overflow-hidden rounded-lg border border-rule bg-sunk text-[0.6875rem] font-[700] tracking-[0.02em] text-ink-2 [font-variation-settings:'wdth'_80]"
    >
      {category && (
        <span
          className={`band absolute inset-x-0 bottom-0 h-1 transition-colors duration-300 ${failed ? 'bg-danger' : 'bg-liquid'}`}
        />
      )}
      {job.from ? getFormat(job.from).label : '?'}
    </div>
  );
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}

function Status({ job, note }: { job: Job; note?: string }) {
  if (note && (job.status === 'ready' || job.status === 'failed' || (job.status === 'done' && job.stale))) {
    return <p className="text-ink-3">{note}</p>;
  }
  switch (job.status) {
    case 'detecting':
      return <p className="text-ink-3">Reading…</p>;
    case 'unsupported':
      return <p className="text-ink-2">Decant can’t convert this kind of file.</p>;
    case 'ready':
      return <p className="text-ink-3">Ready</p>;
    case 'queued':
      return <p className="text-ink-3">Waiting</p>;
    case 'working':
      return <Progress job={job} />;
    case 'failed':
      return (
        <p className="nudge text-danger [text-wrap:pretty]" role="alert">
          {job.error}
        </p>
      );
    case 'done': {
      const total = job.outputs.reduce((sum, output) => sum + output.blob.size, 0);
      const change = job.outputs.length === 1 ? describeSizeChange(job.file.size, total) : null;
      const took = job.startedAt && job.finishedAt ? formatDuration(job.finishedAt - job.startedAt) : null;
      return (
        <div className="status-in tabular leading-snug">
          <p>
            {job.outputs.length > 1 ? `${plural(job.outputs.length, 'file')}, ` : ''}
            {formatBytes(total)}
            {change && <span className="text-ink-3"> ({change})</span>}
          </p>
          <p className="text-[0.8125rem] text-ink-3">
            {job.stale ? 'Made with earlier settings' : took ? `Converted in ${took}` : 'Converted'}
          </p>
        </div>
      );
    }
  }
}

function Progress({ job }: { job: Job }) {
  const percent = job.progress === null ? null : Math.round(job.progress * 100);
  const left = timeLeft(job);
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label={`Converting ${job.file.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="graduated relative h-1.5 overflow-hidden rounded-full bg-sunk"
      >
        {percent === null ? (
          <div className="indeterminate absolute inset-y-0 w-1/3 rounded-full bg-liquid" />
        ) : (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-liquid transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      {/* One line, always: a status that wrapped mid-conversion would shift the rows below. */}
      <p className="flex justify-between gap-3 text-[0.8125rem] text-ink-2 tabular">
        <span className="truncate">
          {job.stage ?? 'Converting'}
          {left && <span className="text-ink-3">, {left}</span>}
        </span>{' '}
        {percent !== null && percent > 0 && percent < 100 && <span>{percent}%</span>}
      </p>
    </div>
  );
}

/** "about 4 min left", once a conversion has run long enough for the estimate to mean something. */
function timeLeft(job: Job): string | null {
  const progress = job.progress;
  if (progress === null || progress < 0.02 || progress >= 1 || job.startedAt === undefined) return null;
  const elapsed = performance.now() - job.startedAt;
  if (elapsed < 4000) return null;
  const remaining = (elapsed * (1 - progress)) / progress;
  if (remaining < 15_000) return 'a few seconds left';
  if (remaining < 60_000) return 'under a minute left';
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 90) return `about ${minutes}\u00a0min left`;
  return `about ${Math.round(minutes / 60)}\u00a0h left`;
}

const iconButton =
  'grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-sunk hover:text-ink disabled:opacity-40';

function RowActions({ job }: { job: Job }) {
  const [zipping, setZipping] = useState(false);

  const download = async () => {
    if (job.outputs.length === 1) {
      const [output] = job.outputs;
      if (output) {
        saveBlob(output.blob, output.name);
        markSaved([output]);
      }
      return;
    }
    setZipping(true);
    try {
      const zip = await zipFiles(job.outputs);
      saveBlob(zip, `${job.file.name.replace(/\.[^.]+$/, '')}.zip`);
      markSaved(job.outputs);
    } finally {
      setZipping(false);
    }
  };

  const single = job.outputs.length === 1 ? job.outputs[0] : undefined;
  const saved = job.outputs.length > 0 && job.outputs.every((output) => output.saved);
  return (
    <>
      {job.status === 'done' && (
        <button
          type="button"
          onClick={download}
          disabled={zipping}
          className={`pop flex h-9 items-center gap-2 rounded-lg border px-3 font-[560] transition-colors ${
            saved
              ? 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
              : 'border-rule-strong text-ink hover:border-ink'
          }`}
          title={single ? single.name : `Save all ${job.outputs.length} files as a ZIP`}
        >
          {saved ? <CheckIcon className="check-draw" /> : <DownloadIcon />}
          {/* Hidden visually on phones, but always part of the button's name. */}
          <span className="max-sm:sr-only">{saved ? 'Saved' : 'Save'}</span>
          <span className="sr-only"> {single ? single.name : `all ${job.outputs.length} files as a ZIP`}</span>
        </button>
      )}
      {job.status === 'failed' && (
        <button type="button" onClick={() => retryJob(job.id)} className={iconButton} title="Try again">
          <RetryIcon />
          <span className="sr-only">Try again</span>
        </button>
      )}
      {job.status === 'working' || job.status === 'queued' ? (
        <button type="button" onClick={() => cancelJob(job.id)} className={iconButton} title="Stop">
          <CloseIcon />
          <span className="sr-only">Stop converting {job.file.name}</span>
        </button>
      ) : (
        <button type="button" onClick={() => removeJob(job.id)} className={iconButton} title="Remove">
          <CloseIcon />
          <span className="sr-only">Remove {job.file.name}</span>
        </button>
      )}
    </>
  );
}
