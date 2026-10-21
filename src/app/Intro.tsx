import { useEffect, useState } from 'react';
import { type Category, displayName, type FormatId, formatFromExtension, getFormat } from '../core/formats';
import { targetsFor } from '../core/routes';
import { pageMeta, type Route, someTargets } from '../core/seo';
import { Pour } from './Pour';

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
    <section aria-labelledby="intro-title" className="relative pt-[clamp(2.5rem,9vh,6.5rem)] pb-16">
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
      <p className="mt-10 max-w-[34ch] text-[clamp(1.2rem,2.2vw,1.45rem)] leading-[1.4] text-ink-2 [text-wrap:pretty]">
        {summary} Your files stay on your device, and there are no ads or accounts.
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={onChoose}
          className="rounded-xl bg-ink px-6 py-3.5 text-[1rem] font-[620] text-on-ink transition-[scale,background-color] hover:bg-ink/88 active:scale-[0.98]"
        >
          {source ? `Choose ${displayName(source)} files` : 'Choose files'}
        </button>
        <p className="text-ink-3 pointer-coarse:hidden">or drop them onto this page, or paste them in</p>
      </div>
    </section>
  );
}
