import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import type { Category } from '../core/formats';

interface PourProps {
  /** Source label, e.g. ".heic", or "images" for a mix of formats. */
  from: string;
  /** Target extension including the dot, e.g. ".jpg". */
  to: string;
  /** 0 to 1: how full the target vessel is. */
  fill: number;
  pouring: boolean;
  liquid: Category;
  size?: 'hero' | 'section';
  /** Overrides the fill transition, e.g. for the slower demo pour. */
  fillDuration?: number;
  label?: string;
  /** Label pairs to size the type against (the widest wins), so a cycling demo keeps a steady size. */
  sizeFor?: [string, string][];
}

const MAX_SIZE = { hero: 168, section: 92 };
const REFERENCE = 100;

/**
 * The page's centrepiece: ".heic → .jpg" set as large as the column allows.
 * The target extension is an outline that fills with its category's colour as
 * the conversion progresses.
 */
export function Pour({ from, to, fill, pouring, liquid, size = 'hero', fillDuration, label, sizeFor }: PourProps) {
  const frame = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);
  const candidates = sizeFor ?? [[from, to]];
  const sizingKey = candidates.map((pair) => pair.join('>')).join('|');

  // Fit the line to the column width, capped so it never shouts on wide screens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the labels being sized change.
  useLayoutEffect(() => {
    const frameEl = frame.current;
    const rulerEl = ruler.current;
    if (!frameEl || !rulerEl) return;
    const measure = () => {
      const natural = Math.max(0, ...Array.from(rulerEl.children, (row) => (row as HTMLElement).scrollWidth));
      if (!natural) return;
      const fitted = Math.floor((frameEl.clientWidth / natural) * REFERENCE * 0.99);
      setFontSize(Math.max(24, Math.min(MAX_SIZE[size], fitted)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frameEl);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [sizingKey, size]);

  const fillStyle = {
    '--fill': Math.max(0, Math.min(1, fill)),
    ...(fillDuration ? { transitionDuration: `${fillDuration}ms` } : {}),
  } as CSSProperties;

  return (
    <div ref={frame} className="relative w-full" data-liquid={liquid}>
      <div
        role="img"
        aria-label={label ?? `${from.replace('.', '').toUpperCase()} to ${to.replace('.', '').toUpperCase()}`}
        className="vessel flex items-center gap-[0.12em] select-none"
        style={{
          fontSize: fontSize ?? (size === 'hero' ? 'clamp(3.25rem, 12vw, 10.5rem)' : 'clamp(2.5rem, 8vw, 5.75rem)'),
        }}
      >
        <span>{from}</span>
        <Stream active={pouring} />
        <span className="vessel-fill" style={fillStyle} data-full={fill >= 1}>
          {to}
        </span>
      </div>
      {/* Invisible copies at a reference size, used only for measuring. */}
      <div
        ref={ruler}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden"
      >
        {candidates.map(([a, b]) => (
          <div
            key={`${a}>${b}`}
            className="vessel flex w-max items-center gap-[0.12em]"
            style={{ fontSize: REFERENCE }}
          >
            <span>{a}</span>
            <Stream active={false} />
            <span className="vessel-empty">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stream({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 100 60"
      aria-hidden="true"
      className="h-[0.42em] w-[0.7em] shrink-0 overflow-visible"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M4 30 H90"
        stroke={active ? 'var(--liquid)' : 'var(--ink-3)'}
        strokeWidth={active ? 9 : 6}
        className={active ? 'pour-stream' : undefined}
      />
      <path d="M68 10 L92 30 L68 50" stroke={active ? 'var(--liquid)' : 'var(--ink-3)'} strokeWidth="6" />
    </svg>
  );
}
