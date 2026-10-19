import { Mark } from './icons';

export const REPO_URL = 'https://github.com/joshuafitzmorris/decant';

interface HeaderProps {
  onHome?: () => void;
}

export function Header({ onHome }: HeaderProps) {
  return (
    <header className="flex h-20 items-center justify-between">
      <a
        href={import.meta.env.BASE_URL}
        onClick={(event) => {
          if (!onHome) return;
          event.preventDefault();
          onHome();
        }}
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
