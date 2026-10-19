import { useEffect, useState } from 'react';
import { type Category, getFormat } from '../core/formats';
import type { LandingPair } from '../core/landing';
import { Pour } from './Pour';

const PAIRS: [string, string, Category][] = [
  ['heic', 'jpg', 'image'],
  ['mov', 'mp4', 'video'],
  ['wav', 'mp3', 'audio'],
  ['pdf', 'png', 'image'],
  ['xlsx', 'csv', 'data'],
  ['docx', 'md', 'document'],
  ['mkv', 'gif', 'image'],
  ['flac', 'm4a', 'audio'],
];

const SIZING = PAIRS.map(([from, to]): [string, string] => [`.${from}`, `.${to}`]);

const POUR_MS = 1500;
const HOLD_MS = 1700;

interface IntroProps {
  onChoose: () => void;
  /** Set on a landing page such as /heic-to-jpg/: show that pair instead of the rotating examples. */
  pair?: LandingPair | null;
}

export function Intro({ onChoose, pair }: IntroProps) {
  const [index, setIndex] = useState(0);
  const [fill, setFill] = useState(0);
  const example = PAIRS[index] as [string, string, Category];
  const [from, to, liquid] = pair
    ? [getFormat(pair.from).exts[0] as string, getFormat(pair.to).exts[0] as string, getFormat(pair.to).category]
    : example;

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new index starts the next pour.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFill(1);
      return;
    }
    const start = window.setTimeout(() => setFill(1), 350);
    // A landing page pours its one pair and stops.
    if (pair) return () => window.clearTimeout(start);
    const next = window.setTimeout(
      () => {
        setFill(0);
        setIndex((i) => (i + 1) % PAIRS.length);
      },
      350 + POUR_MS + HOLD_MS,
    );
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(next);
    };
  }, [index, pair]);

  const source = pair ? getFormat(pair.from) : null;
  const target = pair ? getFormat(pair.to) : null;

  return (
    <section aria-labelledby="intro-title" className="pt-[clamp(2.5rem,9vh,6.5rem)] pb-16">
      <h1 id="intro-title" className="sr-only">
        {source && target ? `Convert ${source.label} to ${target.label}` : 'Decant converts files in your browser'}
      </h1>
      <Pour
        from={`.${from}`}
        to={`.${to}`}
        fill={fill}
        pouring={fill > 0 && fill < 1}
        liquid={liquid}
        fillDuration={fill === 0 ? 1 : POUR_MS}
        label={pair ? undefined : `For example, ${from.toUpperCase()} to ${to.toUpperCase()}`}
        sizeFor={pair ? undefined : SIZING}
      />
      <p className="mt-10 max-w-[34ch] text-[clamp(1.2rem,2.2vw,1.45rem)] leading-[1.4] text-ink-2 [text-wrap:pretty]">
        {source && target
          ? `Convert ${source.label} files to ${target.label} without uploading them. No ads, no tracking, no sign-up.`
          : 'Convert photos, audio, video, documents and spreadsheets without uploading them. No ads, no tracking, no sign-up.'}
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={onChoose}
          className="rounded-xl bg-ink px-6 py-3.5 text-[1rem] font-[620] text-on-ink transition-transform active:scale-[0.98]"
        >
          {source ? `Choose ${source.label} files` : 'Choose files'}
        </button>
        <p className="text-ink-3 pointer-coarse:hidden">or drop them anywhere on the page, or paste</p>
      </div>
    </section>
  );
}
