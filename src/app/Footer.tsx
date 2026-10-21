import type { ReactNode } from 'react';
import { CATEGORY_NAMES, type Category, displayName, type FormatId, getFormat } from '../core/formats';
import { formatSlug, LANDING_PAIRS, landingSlug } from '../core/landing';
import { readableByCategory } from '../core/seo';
import { AUTHOR_GITHUB_URL, AUTHOR_URL, REPO_URL, SupportLink } from './Header';
import { ArrowIcon, CupIcon, Mark } from './icons';
import { Section } from './Section';
import { inlineLink, listLink, subHeading } from './ui';

const CREDITS: [string, string][] = [
  ['Mediabunny', 'https://mediabunny.dev'],
  ['ffmpeg.wasm', 'https://ffmpegwasm.netlify.app'],
  ['Squoosh codecs', 'https://github.com/jamsinclair/jSquash'],
  ['libheif', 'https://github.com/strukturag/libheif'],
  ['pdf.js', 'https://mozilla.github.io/pdf.js/'],
  ['pdf-lib', 'https://pdf-lib.js.org'],
  ['SheetJS', 'https://sheetjs.com'],
  ['Mammoth', 'https://github.com/mwilliamson/mammoth.js'],
  ['foliate-js', 'https://github.com/johnfactotum/foliate-js'],
];

const href = (slug: string) => `${import.meta.env.BASE_URL}${slug}/`;

/** Paired long with short, so the directory's columns come out close to even. */
const DIRECTORY_ORDER: Category[] = ['image', 'document', 'video', 'ebook', 'audio', 'data'];

/** The popular conversions from each format, which have pages of their own. */
const PAGES_FROM = new Map<FormatId, FormatId[]>();
for (const [from, to] of LANDING_PAIRS) PAGES_FROM.set(from, [...(PAGES_FROM.get(from) ?? []), to]);

export function Footer() {
  return (
    <footer>
      <Section id="how" title="How it works">
        <div className="gap-x-8 sm:columns-2">
          <Point title="Everything stays in this tab">
            Decant reads your files, converts them with WebAssembly and your device’s own media encoders, and hands the
            results straight back. There’s no server to upload to, and the page’s security policy blocks connections to
            other sites.
          </Point>
          <Point title="Fast, on your own hardware">
            Video and audio use your device’s media hardware through WebCodecs, so a phone video usually converts faster
            than it plays. Older formats fall back to ffmpeg, which downloads the first time it’s needed and then stays
            cached.
          </Point>
          <Point title="Works offline">Once you’ve used a converter, it keeps working without a connection.</Point>
          <Point title="No ads, no tracking">
            Decant has no analytics, cookies or accounts, and doesn’t know who you are or what you convert. It’s open
            source under the MIT licence, so you can check all of this against{' '}
            <a href={REPO_URL} className={inlineLink}>
              the code on GitHub
            </a>
            .
          </Point>
        </div>
      </Section>

      <Section
        id="formats"
        title="Formats"
        aside="Every format Decant reads, and the conversions people look for most."
        wide
      >
        <Directory />
      </Section>

      <div className="grid gap-x-8 gap-y-8 border-t border-rule pt-10 pb-14 sm:pt-12 md:grid-cols-2 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-4 lg:row-start-1">
          <p className="flex items-center gap-2 text-[1rem] font-[800] tracking-[0.01em] [font-variation-settings:'wdth'_125]">
            <Mark width={20} height={20} />
            Decant
          </p>
          <p className="text-ink-2">
            Made in Vancouver by{' '}
            <a href={AUTHOR_URL} rel="author" className={inlineLink}>
              Joshua Fitz-Morris
            </a>
          </p>
          <p className="flex gap-5 text-ink-2">
            <a href={REPO_URL} rel="noopener" className="hover:text-ink">
              Source code
            </a>
            <a href={AUTHOR_GITHUB_URL} rel="noopener" className="hover:text-ink">
              Joshua on GitHub
            </a>
          </p>
        </div>

        <p className="text-[0.8125rem] leading-relaxed text-ink-3 [text-wrap:pretty] md:row-start-2 lg:col-span-4 lg:col-start-5 lg:row-start-1">
          Built on{' '}
          {CREDITS.map(([name, url], i) => (
            <span key={name}>
              <a
                href={url}
                rel="noopener"
                className="underline decoration-rule-strong underline-offset-2 hover:text-ink-2"
              >
                {name}
              </a>
              {i < CREDITS.length - 2 ? ', ' : i === CREDITS.length - 2 ? ' and ' : '.'}
            </span>
          ))}
        </p>

        <div className="rounded-panel border border-rule bg-surface p-6 md:col-start-2 md:row-span-2 md:row-start-1 md:self-start lg:col-span-4 lg:col-start-9">
          <p className={`flex items-center gap-2.5 ${subHeading}`}>
            <CupIcon width={20} height={20} />
            Decant is free
          </p>
          <p className="mt-2 text-ink-2 [text-wrap:pretty]">
            How does it make money? It doesn’t. If it saved you some hassle, a coffee is always welcome.
          </p>
          <SupportLink className="mt-5" />
        </div>
      </div>
    </footer>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-8 break-inside-avoid last:mb-0">
      <h3 className={subHeading}>{title}</h3>
      <p className="mt-1.5 text-ink-2 [text-wrap:pretty]">{children}</p>
    </div>
  );
}

/**
 * Every readable format, by kind, each linking to its converter page and then to its popular
 * conversions. Plain links in the server-rendered page, so search engines can follow all of them.
 */
function Directory() {
  const byCategory = new Map(readableByCategory());
  return (
    <div className="gap-x-8 sm:columns-2 lg:columns-3">
      {DIRECTORY_ORDER.map((category) => (
        <div key={category} data-liquid={category} className="mb-10 break-inside-avoid last:mb-0">
          <h3 className={`flex items-center gap-2.5 ${subHeading}`}>
            <span aria-hidden="true" className="size-2 rounded-full bg-liquid" />
            {CATEGORY_NAMES[category]}
          </h3>
          <dl className="mt-3 border-t border-rule">
            {(byCategory.get(category) ?? []).map((format) => {
              const name = displayName(format);
              const pages = PAGES_FROM.get(format) ?? [];
              return (
                <div
                  key={format}
                  className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-rule py-1.5"
                >
                  <dt>
                    <a
                      href={href(formatSlug(format))}
                      title={`${getFormat(format).name} converter`}
                      className="font-[600] text-ink underline decoration-transparent underline-offset-4 hover:decoration-rule-strong"
                    >
                      {name}
                    </a>
                  </dt>
                  <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    {pages.length > 0 && <ArrowIcon className="size-3.5 shrink-0 self-center text-ink-3" />}
                    {pages.map((to) => (
                      <a key={to} href={href(landingSlug(format, to))} className={listLink}>
                        <span className="sr-only">{name} to </span>
                        {displayName(to)}
                      </a>
                    ))}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
