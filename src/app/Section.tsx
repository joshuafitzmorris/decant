import type { ReactNode } from 'react';
import { sectionHeading } from './ui';

interface SectionProps {
  id: string;
  title: ReactNode;
  /** A line under the heading, in the left column on wide screens. */
  aside?: ReactNode;
  /** Content that needs the full width goes under the heading instead of beside it. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * One block of the guide and footer. On wide screens the heading takes the first
 * third and the content the other two, the same split as the intro above.
 */
export function Section({ id, title, aside, wide = false, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-4 border-t border-rule py-12 lg:grid lg:grid-cols-12 lg:gap-x-8 lg:py-16"
    >
      <div className="lg:col-span-4">
        <h2 id={`${id}-title`} className={sectionHeading}>
          {title}
        </h2>
        {aside && <p className="mt-3 max-w-[36ch] text-ink-2 [text-wrap:pretty]">{aside}</p>}
      </div>
      <div className={`mt-7 min-w-0 ${wide ? 'lg:col-span-12 lg:mt-10' : 'lg:col-span-8 lg:mt-1'}`}>{children}</div>
    </section>
  );
}
