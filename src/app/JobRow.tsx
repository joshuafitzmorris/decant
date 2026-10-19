import { memo, useEffect, useState } from 'react';
import { getFormat } from '../core/formats';
import { zipFiles } from '../core/zip';
import { cancelJob, type Job, markSaved, removeJob, retryJob } from '../state/jobs';
import { describeSizeChange, formatBytes, formatDuration, plural } from './format';
import { CloseIcon, DownloadIcon, RetryIcon } from './icons';
import { saveBlob } from './save';

/** Formats every browser can show in an <img>, used for input thumbnails. */
const PREVIEWABLE = new Set(['jpg', 'png', 'webp', 'gif', 'avif', 'bmp', 'ico', 'svg']);

interface JobRowProps {
  job: Job;
  /** Shown instead of "Ready" for files the group's target doesn't apply to. */
  note?: string;
}

export const JobRow = memo(function JobRow({ job, note }: JobRowProps) {
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_minmax(13rem,auto)_auto]">
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
      {category && <span className="absolute inset-x-0 bottom-0 h-1 bg-liquid" />}
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
      return <p className="text-ink-2">Decant can't convert this kind of file.</p>;
    case 'ready':
      return <p className="text-ink-3">Ready</p>;
    case 'queued':
      return <p className="text-ink-3">Waiting</p>;
    case 'working':
      return <Progress job={job} />;
    case 'failed':
      return (
        <p className="text-danger [text-wrap:pretty]" role="alert">
          {job.error}
        </p>
      );
    case 'done': {
      const total = job.outputs.reduce((sum, output) => sum + output.blob.size, 0);
      const change = job.outputs.length === 1 ? describeSizeChange(job.file.size, total) : null;
      const took = job.startedAt && job.finishedAt ? formatDuration(job.finishedAt - job.startedAt) : null;
      return (
        <div className="tabular leading-snug">
          <p>
            {job.outputs.length > 1 ? `${plural(job.outputs.length, 'file')}, ` : ''}
            {formatBytes(total)}
            {change && <span className="text-ink-3"> ({change})</span>}
          </p>
          <p className="text-[0.8125rem] text-ink-3">
            {job.stale ? 'Settings changed since' : took ? `Converted in ${took}` : 'Converted'}
          </p>
        </div>
      );
    }
  }
}

function Progress({ job }: { job: Job }) {
  const percent = job.progress === null ? null : Math.round(job.progress * 100);
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
      <p className="text-[0.8125rem] text-ink-2 tabular">
        {job.stage ?? 'Converting'}
        {percent !== null && percent > 0 && percent < 100 ? ` ${percent}%` : ''}
      </p>
    </div>
  );
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

  return (
    <>
      {job.status === 'done' && (
        <button
          type="button"
          onClick={download}
          disabled={zipping}
          className="flex h-9 items-center gap-2 rounded-lg border border-rule-strong px-3 font-[560] text-ink transition-colors hover:border-ink"
          title={job.outputs.length === 1 ? job.outputs[0]?.name : `Download ${job.outputs.length} files as a ZIP`}
        >
          <DownloadIcon />
          <span className="hidden sm:inline">{job.outputs.length > 1 ? 'ZIP' : 'Save'}</span>
          <span className="sr-only"> {job.outputs.length === 1 ? job.outputs[0]?.name : 'all files as a ZIP'}</span>
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
