import { CupIcon, GitHubIcon, Mark } from './icons';

export const REPO_URL = 'https://github.com/joshuafitzmorris/decant';
export const SUPPORT_URL = 'https://buymeacoffee.com/joshuafitzmorris';
export const AUTHOR_URL = 'https://joshuafitzmorris.github.io';
export const AUTHOR_GITHUB_URL = 'https://github.com/joshuafitzmorris';

const navLink = 'inline-flex h-9 items-center gap-2 rounded-field px-2.5 text-ink-2 transition-colors hover:text-ink';

export function Header() {
  return (
    <header className="flex h-[4.5rem] items-center justify-between gap-4 sm:h-20">
      <a
        href={import.meta.env.BASE_URL}
        className="-ml-1 flex items-center gap-2.5 rounded-field px-1 py-1 text-[1.15rem] font-[800] tracking-[0.01em] [font-variation-settings:'wdth'_125]"
      >
        <Mark />
        Decant
      </a>
      <nav aria-label="Site" className="-mr-1 flex items-center gap-1 sm:gap-2">
        <a href="#how" className={`${navLink} max-md:hidden`}>
          How it works
        </a>
        <a href="#formats" className={`${navLink} max-md:hidden`}>
          Formats
        </a>
        <a href={REPO_URL} rel="noopener" className={navLink}>
          <GitHubIcon />
          <span className="max-sm:sr-only">Source</span>
        </a>
        <SupportLink className="ml-1" />
      </nav>
    </header>
  );
}

/** "Buy me a coffee", the one ask on the page: always in the header, never in the way. */
export function SupportLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener"
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-rule-strong bg-surface px-3.5 font-[600] text-ink transition-colors hover:border-ink ${className}`}
    >
      <CupIcon />
      Buy me a coffee
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
