import type { CSSProperties } from 'react';
import type { Category } from '../core/formats';
import { lineEms } from './vessel';

interface PourProps {
  /** Source label, e.g. ".heic", or "images" for a mix of formats. */
  from: string;
  /** Target extension including the dot, e.g. ".jpg". */
  to: string;
  /** 0 to 1: how full the target vessel is. */
  fill: number;
  pouring: boolean;
  /** Every file is converted: the moment the full glass catches the light. */
  done?: boolean;
  /** Let a new source or target settle in. Off for the first render of a page, so it never delays the first paint. */
  animate?: boolean;
  liquid: Category;
  size?: 'hero' | 'section';
  /** Overrides the fill transition, e.g. for the slower demo pour. */
  fillDuration?: number;
  label?: string;
  /** Label pairs to size the type against (the widest wins), so a cycling demo keeps a steady size. */
  sizeFor?: [string, string][];
}

const MAX_SIZE = { hero: 168, section: 92 };
const MIN_SIZE = 24;

/**
 * The page's centrepiece: ".heic → .jpg" set as large as the column allows.
 * The target extension starts as pale glass and fills with its category's
 * colour as the conversion progresses.
 */
export function Pour({
  from,
  to,
  fill,
  pouring,
  done = false,
  animate = false,
  liquid,
  size = 'hero',
  fillDuration,
  label,
  sizeFor,
}: PourProps) {
  // Fit the line to the column, capped so it never shouts on wide screens. The width comes from the
  // font's metrics (./vessel), so the size is pure CSS and is already right in the server-rendered page.
  const candidates = sizeFor ?? [[from, to]];
  const ems = Math.max(...candidates.map(([a, b]) => lineEms(a, b)));
  const fontSize = `clamp(${MIN_SIZE}px, ${(99 / ems).toFixed(3)}cqi, ${MAX_SIZE[size]}px)`;

  const fillStyle = {
    '--fill': Math.max(0, Math.min(1, fill)),
    ...(fillDuration ? { transitionDuration: `${fillDuration}ms` } : {}),
  } as CSSProperties;

  return (
    <div className={`vessel-frame relative w-full ${animate ? 'pour-animate' : ''}`} data-liquid={liquid}>
      <div
        role="img"
        aria-label={label ?? `${from.replace('.', '').toUpperCase()} to ${to.replace('.', '').toUpperCase()}`}
        className="vessel flex items-center gap-[0.12em] select-none"
        style={{ fontSize }}
      >
        {/* Keyed so a new label mounts fresh and plays its arrival. */}
        <span key={from} className="vessel-from">
          {from}
        </span>
        <Stream active={pouring} />
        <span key={to} className="vessel-slot flex">
          <span className="vessel-fill" style={fillStyle} data-pouring={pouring} data-done={done && fill >= 1}>
            {to}
          </span>
        </span>
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
