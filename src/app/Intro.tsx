import { useEffect, useState } from 'react';
import { type Category, displayName, type FormatId, formatFromExtension, getFormat } from '../core/formats';
import { targetsFor } from '../core/routes';
import { pageMeta, type Route, someTargets } from '../core/seo';
import { CodeIcon, LockIcon, OfflineIcon, PlusIcon, TrayIcon } from './icons';
import { Pour } from './Pour';
import { primaryButton } from './ui';

type Example = [from: string, to: string, liquid: Category];

const HOME_EXAMPLES: Example[] = [
  ['heic', 'jpg', 'image'],
  ['mov', 'mp4', 'video'],
  ['wav', 'mp3', 'audio'],
  ['pdf', 'png', 'image'],
  ['mobi', 'epub', 'ebook'],
  ['xlsx', 'csv', 'data'],
  ['docx', 'md', 'document'],
  ['mkv', 'gif', 'image'],
];

const ext = (id: FormatId) => getFormat(id).exts[0] as string;
/** How a screen reader should say an extension: "WebP", not "W E B P". */
const spoken = (extension: string) => {
  const format = formatFromExtension(extension);
  return format?.display ?? format?.label ?? extension.toUpperCase();
};

/** The examples the pour cycles through: one fixed pair, a format's common targets, or a mix. */
function examplesFor(route: Route): Example[] {
  if (route.kind === 'pair') return [[ext(route.from), ext(route.to), getFormat(route.to).category]];
  if (route.kind === 'format') {
    return targetsFor(route.format)
      .slice(0, 6)
      .map((to) => [ext(route.format), ext(to), getFormat(to).category]);
  }
  return HOME_EXAMPLES;
}

const POUR_MS = 1500;
const HOLD_MS = 1700;

interface IntroProps {
  onChoose: () => void;
  route: Route;
  /** The path that was asked for, when it isn't a page (the 404 page shows the home page). */
  missing?: string | null;
}

export function Intro({ onChoose, route, missing }: IntroProps) {
  const examples = examplesFor(route);
  const [index, setIndex] = useState(0);
  const [fill, setFill] = useState(0);
  const [from, to, liquid] = examples[index % examples.length] as Example;
  const cycling = examples.length > 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new index starts the next pour.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFill(1);
      return;
    }
    const start = window.setTimeout(() => setFill(1), 350);
    // A single conversion pours once and stops.
    if (!cycling) return () => window.clearTimeout(start);
    const next = window.setTimeout(
      () => {
        setFill(0);
        setIndex((i) => (i + 1) % examples.length);
      },
      350 + POUR_MS + HOLD_MS,
    );
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(next);
    };
  }, [index, cycling]);

  const source = route.kind === 'pair' ? route.from : route.kind === 'format' ? route.format : null;
  let summary = 'Convert photos, audio, video, ebooks, documents and spreadsheets in your browser.';
  if (route.kind === 'pair')
    summary = `Convert ${displayName(route.from)} files to ${displayName(route.to)} in your browser.`;
  if (route.kind === 'format')
    summary = `Convert ${displayName(route.format)} files to ${someTargets(route.format, 3)} in your browser.`;

  return (
    <section
      aria-labelledby="intro-title"
      className="relative pt-[clamp(2.25rem,8vh,6rem)] pb-[clamp(3.5rem,10vh,7rem)]"
    >
      <h1 id="intro-title" className="sr-only">
        {pageMeta(route).heading}
      </h1>
      {missing && (
        // Sits in the section's top padding, so it appears without moving anything.
        <p className="status-in absolute inset-x-0 top-0 text-ink-2 [text-wrap:pretty]">
          There’s no page at <span className="font-[600] break-all text-ink">{missing}</span>, but the converter is
          right here.
        </p>
      )}
      <Pour
        from={`.${from}`}
        to={`.${to}`}
        fill={fill}
        pouring={fill > 0 && fill < 1}
        liquid={liquid}
        animate={index > 0}
        fillDuration={fill === 0 ? 1 : POUR_MS}
        label={`${cycling ? 'For example, ' : ''}${spoken(from)} to ${spoken(to)}`}
        sizeFor={cycling ? examples.map(([a, b]): [string, string] => [`.${a}`, `.${b}`]) : undefined}
      />
      <div className="mt-[clamp(2rem,6vh,3.5rem)] grid gap-x-8 gap-y-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-y-7">
        <p className="max-w-[34ch] text-[clamp(1.2rem,1.9vw,1.375rem)] leading-[1.4] text-ink-2 [text-wrap:pretty] lg:col-span-4">
          {summary}
        </p>
        <DropTarget
          onChoose={onChoose}
          label={source ? `Choose ${displayName(source)} files` : 'Choose files'}
          className="lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1"
        />
        <ul className="flex flex-col gap-2.5 text-ink-2 md:flex-row md:flex-wrap md:gap-x-8 lg:col-span-4 lg:row-start-2 lg:flex-col">
          <li className="flex items-center gap-3">
            <LockIcon className="text-ink-3" /> Nothing is uploaded
          </li>
          <li className="flex items-center gap-3">
            <OfflineIcon className="text-ink-3" /> Works offline
          </li>
          <li className="flex items-center gap-3">
            <CodeIcon className="text-ink-3" /> Free and open source
          </li>
        </ul>
      </div>
    </section>
  );
}

/**
 * Where files go in. The whole page takes drops and pastes; this makes that visible, and the
 * button inside is the way in for keyboards, screen readers and touch screens.
 */
function DropTarget({ onChoose, label, className }: { onChoose: () => void; label: string; className: string }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a larger target for a mouse; the button is the accessible control.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboards use the button inside.
    <div
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button')) onChoose();
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-panel border border-rule-strong bg-surface px-6 py-9 text-center transition-colors hover:border-ink-3 sm:py-11 pointer-coarse:cursor-auto pointer-coarse:border-transparent pointer-coarse:bg-transparent pointer-coarse:p-0 ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-sunk text-ink pointer-coarse:hidden"
      >
        <TrayIcon />
      </span>
      <p className="mt-4 text-[1.5rem] leading-tight font-[740] tracking-[-0.01em] [font-variation-settings:'wdth'_82] pointer-coarse:hidden">
        Drop files here
      </p>
      <p className="mt-1.5 text-ink-2 pointer-coarse:hidden">or paste them in. Whole folders work too.</p>
      <button
        type="button"
        onClick={onChoose}
        className={`${primaryButton} mt-7 h-12 px-6 text-[1rem] pointer-coarse:mt-0 pointer-coarse:w-full`}
      >
        <PlusIcon />
        {label}
      </button>
    </div>
  );
}
