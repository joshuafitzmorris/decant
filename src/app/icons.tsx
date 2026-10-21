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

/** Drawn in once when it appears (see .check-draw). */
export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M3.5 8.5l3 3 6-7" />
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

export const ArrowIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M2.5 8h10.5M9.5 4.5 13 8l-3.5 3.5" />
  </svg>
);

/** Files dropping into a tray, for the drop target. */
export const TrayIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} width={24} height={24} viewBox="0 0 24 24" strokeWidth={1.7} {...props}>
    <path d="M12 3.5v10M7.75 9.5 12 13.75l4.25-4.25M4 13.5v4.25c0 .97.78 1.75 1.75 1.75h12.5c.97 0 1.75-.78 1.75-1.75V13.5" />
  </svg>
);

export const LockIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <rect x="3" y="7" width="10" height="7" rx="1.75" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

/** No connection needed. */
export const OfflineIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M1.75 6.25a9 9 0 0 1 3.1-1.9M8 4a9 9 0 0 1 6.25 2.25M4 8.75a5.5 5.5 0 0 1 2.1-1.2M10.6 7.9A5.5 5.5 0 0 1 12 8.75M6.4 11.1a2.4 2.4 0 0 1 3.2 0M2.5 2.5l11 11" />
  </svg>
);

export const CodeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </svg>
);

export const SpinnerIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" {...base} {...props}>
    <path d="M8 2a6 6 0 1 1-6 6" />
  </svg>
);

export const GitHubIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" {...props}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
  </svg>
);

/** A cup of coffee, the one other liquid on the page. It fills up when its link is hovered (see .cup). */
export function CupIcon(props: SVGProps<SVGSVGElement>) {
  const clip = useId();
  return (
    <svg aria-hidden="true" {...base} {...props} className={`cup ${props.className ?? ''}`}>
      <defs>
        <clipPath id={clip}>
          <path d="M2.75 6.25h8.5v3.5a3.75 3.75 0 0 1-3.75 3.75h-1a3.75 3.75 0 0 1-3.75-3.75z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect className="cup-coffee" x="2" y="8.25" width="10" height="6" fill="var(--coffee)" stroke="none" />
      </g>
      <path d="M2.75 6.25h8.5v3.5a3.75 3.75 0 0 1-3.75 3.75h-1a3.75 3.75 0 0 1-3.75-3.75zM11.25 7.25h.75a1.75 1.75 0 0 1 0 3.5h-1" />
      <path className="cup-steam" d="M5.75 1.75c-.5.6.5 1.15 0 1.75M8.25 1.75c-.5.6.5 1.15 0 1.75" strokeWidth="1.3" />
    </svg>
  );
}

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
        <path className="mark-liquid" d="M0 19.5c4-1.6 8-1.6 12 0s8 1.6 12 0 6-1.2 8-.6V32H0z" fill="var(--ink)" />
      </g>
      <path d={VESSEL} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const VESSEL = 'M11 3h10v8.2c4.2 1.9 7 6 7 10.8C28 28.6 22.6 31 16 31S4 28.6 4 22c0-4.8 2.8-8.9 7-10.8z';
