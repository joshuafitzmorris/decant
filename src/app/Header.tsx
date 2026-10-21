import { Mark } from './icons';

export const REPO_URL = 'https://github.com/joshuafitzmorris/decant';
export const SUPPORT_URL = 'https://buymeacoffee.com/joshuafitzmorris';
export const AUTHOR_URL = 'https://joshuafitzmorris.github.io';
export const AUTHOR_GITHUB_URL = 'https://github.com/joshuafitzmorris';

export function Header() {
  return (
    <header className="flex h-20 items-center justify-between">
      <a
        href={import.meta.env.BASE_URL}
        className="flex items-center gap-2.5 text-[1.15rem] font-[800] tracking-[0.01em] [font-variation-settings:'wdth'_125]"
      >
        <Mark />
        Decant
      </a>
      <nav className="flex items-center gap-6 text-ink-2">
        <a href="#how" className="hover:text-ink">
          How it works
        </a>
        <a href={REPO_URL} className="hover:text-ink" rel="noopener">
          Source
        </a>
      </nav>
    </header>
  );
}
