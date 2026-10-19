import { type SVGProps, useId } from 'react';

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const DownloadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>
);

export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const RetryIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </svg>
);

export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const ChevronIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

/** Decant's mark: a vessel, half full. */
export function Mark(props: SVGProps<SVGSVGElement>) {
  const clip = useId();
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <defs>
        <clipPath id={clip}>
          <path d={VESSEL} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="32" height="32" fill="var(--ink)" opacity="0.14" />
        <path d="M0 19.5c4-1.6 8-1.6 12 0s8 1.6 12 0 6-1.2 8-.6V32H0z" fill="var(--ink)" />
      </g>
      <path d={VESSEL} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const VESSEL = 'M11 3h10v8.2c4.2 1.9 7 6 7 10.8C28 28.6 22.6 31 16 31S4 28.6 4 22c0-4.8 2.8-8.9 7-10.8z';
