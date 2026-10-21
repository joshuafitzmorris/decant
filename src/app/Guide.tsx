import { displayName, type FormatId, getFormat } from '../core/formats';
import { FORMAT_PAGES, formatSlug, LANDING_PAIRS, landingSlug } from '../core/landing';
import { targetsFor } from '../core/routes';
import { type Faq, FORMAT_ABOUT, formatFaq, pairAbout, pairFaq, pairSteps, type Route, siteFaq } from '../core/seo';
import { Section } from './Section';
import { subHeading } from './ui';

const landing = new Set(LANDING_PAIRS.map(([from, to]) => `${from}>${to}`));
const href = (slug: string) => `${import.meta.env.BASE_URL}${slug}/`;

/** Links to other pages, set as pills. A format without its own page is shown the same way, but quieter. */
const pill = 'inline-flex h-9 items-center rounded-full border px-3.5 transition-colors';
const pillLink = `${pill} border-rule-strong text-ink hover:border-ink`;
const pillText = `${pill} border-rule text-ink-2`;

/**
 * What a visitor (or a search engine) needs before converting: the steps, what
 * the formats are, and answers to the usual questions. Shown until files are added.
 */
export function Guide({ route }: { route: Route }) {
  if (route.kind === 'pair') return <PairGuide from={route.from} to={route.to} />;
  if (route.kind === 'format') return <FormatGuide format={route.format} />;
  return (
    <Section id="questions" title="Questions">
      <Questions faqs={siteFaq()} />
    </Section>
  );
}

function PairGuide({ from, to }: { from: FormatId; to: FormatId }) {
  const s = displayName(from);
  const t = displayName(to);
  const others = targetsFor(from).filter((target) => target !== to && landing.has(`${from}>${target}`));
  const about = pairAbout(from, to);
  return (
    <>
      <Section id="steps" title={`How to convert ${s} to ${t}`}>
        {/* A real sequence, so it's numbered. */}
        <ol className="grid gap-x-8 gap-y-7 sm:grid-cols-3" data-liquid={getFormat(to).category}>
          {pairSteps(from, to).map((step, i) => (
            <li key={step} id={`step-${i + 1}`} className="border-t border-rule-strong pt-4">
              <span
                aria-hidden="true"
                className="block text-[2.5rem] leading-none font-[780] text-liquid tabular [font-variation-settings:'wdth'_78]"
              >
                {i + 1}
              </span>
              <p className="mt-3 text-ink-2 [text-wrap:pretty]">{step}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="about" title={`About ${s} and ${t}`}>
        <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
          {[from, to].map((format, i) => (
            <div key={format} data-liquid={getFormat(format).category}>
              <h3 className={`flex items-center gap-2.5 ${subHeading}`}>
                <span aria-hidden="true" className="size-2 rounded-full bg-liquid" />
                {displayName(format)}
              </h3>
              <p className="mt-2 text-ink-2 [text-wrap:pretty]">{about[i]}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="questions" title="Questions">
        <Questions faqs={pairFaq(from, to)} />
      </Section>

      <Section id="more" title={`More ${s} conversions`}>
        <ul className="flex flex-wrap gap-2">
          {others.map((target) => (
            <li key={target}>
              <a href={href(landingSlug(from, target))} className={pillLink}>
                {s} to {displayName(target)}
              </a>
            </li>
          ))}
          <li>
            <a href={href(formatSlug(from))} className={pillLink}>
              Every {s} conversion
            </a>
          </li>
        </ul>
      </Section>
    </>
  );
}

function FormatGuide({ format }: { format: FormatId }) {
  const s = displayName(format);
  // Formats this one is often converted from, for people who arrived with the other kind of file.
  const sources = FORMAT_PAGES.filter((from) => from !== format && landing.has(`${from}>${format}`));
  return (
    <>
      <Section id="about" title={`What are ${s} files?`}>
        <p className="max-w-[60ch] text-[1.0625rem] leading-relaxed text-ink-2 [text-wrap:pretty]">
          {FORMAT_ABOUT[format]}
        </p>
      </Section>

      <Section id="targets" title={`${s} to other formats`}>
        <ul className="flex flex-wrap gap-2">
          {targetsFor(format).map((target) => (
            <li key={target}>
              {landing.has(`${format}>${target}`) ? (
                <a href={href(landingSlug(format, target))} className={pillLink}>
                  {displayName(target)}
                </a>
              ) : (
                <span className={pillText}>{displayName(target)}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {sources.length > 0 && (
        <Section id="sources" title={`Other formats to ${s}`}>
          <ul className="flex flex-wrap gap-2">
            {sources.map((from) => (
              <li key={from}>
                <a href={href(landingSlug(from, format))} className={pillLink}>
                  {displayName(from)} to {s}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="questions" title="Questions">
        <Questions faqs={formatFaq(format)} />
      </Section>
    </>
  );
}

function Questions({ faqs }: { faqs: Faq[] }) {
  return (
    // Columns rather than a grid, so a long answer doesn't leave a gap beside it.
    <dl className="gap-x-8 sm:columns-2">
      {faqs.map(({ question, answer }) => (
        <div key={question} className="mb-8 break-inside-avoid last:mb-0">
          <dt className={`${subHeading} [text-wrap:balance]`}>{question}</dt>
          <dd className="mt-1.5 text-ink-2 [text-wrap:pretty]">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
