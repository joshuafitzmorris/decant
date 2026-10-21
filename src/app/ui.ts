/**
 * Shared control styles, so every control comes from one small set of sizes:
 * chips, row actions and quiet buttons are 36px tall, fields 40px, action buttons 44px.
 * Radii step up with size: fields and chips (rounded-field), buttons (rounded-button),
 * and the surfaces that hold them (rounded-panel).
 */

// Primary and secondary share a border and a transition, so a save button promoted to primary fades across.
const buttonBase =
  'inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-button border whitespace-nowrap transition-[scale,opacity,background-color,border-color,color] duration-200 active:scale-[0.98] disabled:active:scale-100';

export const primaryButton = `${buttonBase} h-11 px-5 border-ink bg-ink font-[620] text-on-ink hover:bg-ink/85 disabled:cursor-default disabled:hover:bg-ink`;

export const secondaryButton = `${buttonBase} h-11 px-5 border-rule-strong bg-surface font-[600] text-ink hover:border-ink disabled:opacity-60`;

/** Text buttons for the less important actions, like "Add files" and "Start over". */
export const quietButton =
  'inline-flex h-9 items-center gap-2 rounded-field px-3 font-[560] text-ink-2 transition-colors hover:bg-sunk hover:text-ink disabled:opacity-50';

export const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-field text-ink-2 transition-colors hover:bg-sunk hover:text-ink disabled:opacity-40';

export const field =
  'h-10 rounded-field border border-rule-strong bg-surface px-3 text-ink outline-none transition-colors hover:border-ink-3 focus-visible:border-ink';

export const fieldLabel = 'block text-[0.8125rem] leading-5 text-ink-2';

/** Section headings, set narrower than body text so they echo the pour line. */
export const sectionHeading =
  "text-[clamp(1.5rem,2.3vw,1.875rem)] leading-[1.1] font-[740] tracking-[-0.012em] text-ink [font-variation-settings:'wdth'_82] [text-wrap:balance]";

export const subHeading = 'font-[650] text-ink';

export const inlineLink = 'text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink';

/** Links in lists and directories: quiet until hovered. */
export const listLink =
  'text-ink-2 underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-rule-strong';
