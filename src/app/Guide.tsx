import type { ReactNode } from 'react';
import { type FormatId, getFormat } from '../core/formats';
import { FORMAT_PAGES, formatSlug, LANDING_PAIRS, landingSlug } from '../core/landing';
import { targetsFor } from '../core/routes';
import { type Faq, FORMAT_ABOUT, formatFaq, pairAbout, pairFaq, pairSteps, type Route, siteFaq } from '../core/seo';

const heading = "text-[1.35rem] font-[700] text-ink [font-variation-settings:'wdth'_90]";
const inlineLink = 'text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink';
const landing = new Set(LANDING_PAIRS.map(([from, to]) => `${from}>${to}`));
const href = (slug: string) => `${import.meta.env.BASE_URL}${slug}/`;

/**
 * What a visitor (or a search engine) needs before converting: the steps, what
 * the formats are, and answers to the usual questions. Shown until files are added.
 */
export function Guide({ route }: { route: Route }) {
  if (route.kind === 'pair') return <PairGuide from={route.from} to={route.to} />;
  if (route.kind === 'format') return <FormatGuide format={route.format} />;
  return (
    <Section label="Questions">
      <div className="max-w-[60ch]">
        <h2 className={heading}>Questions</h2>
        <Questions faqs={siteFaq()} />
      </div>
    </Section>
  );
}

function PairGuide({ from, to }: { from: FormatId; to: FormatId }) {
  const s = getFormat(from).label;
  const t = getFormat(to).label;
  const others = targetsFor(from).filter((target) => target !== to && landing.has(`${from}>${target}`));
  return (
    <Section label={`How to convert ${s} to ${t}`}>
      <div className="space-y-4 text-ink-2 [text-wrap:pretty]">
        <h2 className={heading}>
          How to convert {s} to {t}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 marker:font-[620] marker:text-ink">
          {pairSteps(from, to).map((step, i) => (
            <li key={step} id={`step-${i + 1}`}>
              {step}
            </li>
          ))}
        </ol>
        <h2 className={`${heading} pt-6`}>
          About {s} and {t}
        </h2>
        {pairAbout(from, to).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div>
        <h2 className={heading}>Questions</h2>
        <Questions faqs={pairFaq(from, to)} />
        <h2 className={`${heading} mt-10`}>More {s} conversions</h2>
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-ink-2">
          {others.map((target) => (
            <li key={target}>
              <a href={href(landingSlug(from, target))} className={inlineLink}>
                {s} to {getFormat(target).label}
              </a>
            </li>
          ))}
          <li>
            <a href={href(formatSlug(from))} className={inlineLink}>
              Every {s} conversion
            </a>
          </li>
        </ul>
      </div>
    </Section>
  );
}

function FormatGuide({ format }: { format: FormatId }) {
  const s = getFormat(format).label;
  // Formats this one is often converted from, for people who arrived with the other kind of file.
  const sources = FORMAT_PAGES.filter((from) => from !== format && landing.has(`${from}>${format}`));
  return (
    <Section label={`What are ${s} files?`}>
      <div className="space-y-4 text-ink-2 [text-wrap:pretty]">
        <h2 className={heading}>What are {s} files?</h2>
        <p>{FORMAT_ABOUT[format]}</p>
        <h2 className={`${heading} pt-6`}>Convert {s} to</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {targetsFor(format).map((target) => (
            <li key={target}>
              {landing.has(`${format}>${target}`) ? (
                <a href={href(landingSlug(format, target))} className={inlineLink}>
                  {getFormat(target).label}
                </a>
              ) : (
                getFormat(target).label
              )}
            </li>
          ))}
        </ul>
        {sources.length > 0 && (
          <>
            <h2 className={`${heading} pt-6`}>Convert to {s}</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {sources.map((from) => (
                <li key={from}>
                  <a href={href(landingSlug(from, format))} className={inlineLink}>
                    {getFormat(from).label} to {s}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <h2 className={heading}>Questions</h2>
        <Questions faqs={formatFaq(format)} />
      </div>
    </Section>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="mt-4 grid gap-12 border-t border-rule pt-12 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-16"
    >
      {children}
    </section>
  );
}

function Questions({ faqs }: { faqs: Faq[] }) {
  return (
    <dl className="mt-5 space-y-5">
      {faqs.map(({ question, answer }) => (
        <div key={question}>
          <dt className="font-[620] text-ink">{question}</dt>
          <dd className="mt-1 text-ink-2 [text-wrap:pretty]">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
