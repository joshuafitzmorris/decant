import { CATEGORY_NAMES, type Category, displayName, FORMATS, type FormatId, getFormat } from '../core/formats';
import { formatSlug, LANDING_PAIRS, landingSlug } from '../core/landing';
import { readableFormats } from '../core/routes';
import { AUTHOR_GITHUB_URL, AUTHOR_URL, REPO_URL, SUPPORT_URL } from './Header';

const CATEGORIES: Category[] = ['image', 'audio', 'video', 'document', 'ebook', 'data'];

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

const inlineLink = 'text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink';

export function Footer() {
  const readable = new Set<FormatId>(readableFormats());

  return (
    <footer id="how" className="mt-16 border-t border-rule pt-12 pb-16 sm:mt-24">
      <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-16">
        <div className="max-w-[56ch] space-y-4 text-ink-2 [text-wrap:pretty]">
          <h2 className="text-[1.35rem] font-[700] text-ink [font-variation-settings:'wdth'_90]">How it works</h2>
          <p>
            Everything happens inside this browser tab. Decant reads your files from disk, converts them with
            WebAssembly and your device’s own media encoders, and hands the results straight back. There’s no server to
            upload to, and the page’s security policy blocks connections to any other site.
          </p>
          <p>
            Video and audio go through WebCodecs, which uses your device’s media hardware where the browser supports it,
            so a phone video usually converts faster than it plays. Older formats fall back to a copy of ffmpeg that
            downloads the first time it’s needed and then stays cached.
          </p>
          <p>Once you’ve used a converter, it keeps working offline.</p>

          <h2 className="pt-6 text-[1.35rem] font-[700] text-ink [font-variation-settings:'wdth'_90]">
            No ads, no tracking
          </h2>
          <p>
            Decant has no analytics, cookies or accounts. It doesn’t know who you are or what you convert, because your
            files never leave your device.
          </p>
          <p>
            It’s open source under the MIT licence, so you can check all of this against{' '}
            <a href={REPO_URL} className={inlineLink}>
              the code on GitHub
            </a>
            .
          </p>
          <p>
            How does it make money? It doesn’t. If it saved you some hassle,{' '}
            <a href={SUPPORT_URL} className={inlineLink} rel="noopener">
              buy me a coffee
            </a>
            .
          </p>
          <p className="pt-2 text-[0.8125rem] text-ink-3">
            Built on{' '}
            {CREDITS.map(([name, url], i) => (
              <span key={name}>
                <a href={url} rel="noopener" className="underline decoration-rule underline-offset-2 hover:text-ink-2">
                  {name}
                </a>
                {i < CREDITS.length - 2 ? ', ' : i === CREDITS.length - 2 ? ' and ' : '.'}
              </span>
            ))}
          </p>
        </div>

        <div>
          <h2 className="text-[1.35rem] font-[700] [font-variation-settings:'wdth'_90]">What it reads</h2>
          <dl className="mt-5 divide-y divide-rule border-y border-rule">
            {CATEGORIES.map((category) => (
              <div key={category} data-liquid={category} className="grid grid-cols-[7.5rem_1fr] gap-4 py-3">
                <dt className="flex items-center gap-2.5 font-[560]">
                  <span className="size-2 rounded-full bg-liquid" aria-hidden="true" />
                  {CATEGORY_NAMES[category]}
                </dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 text-ink-2 tabular [font-variation-settings:'wdth'_88]">
                  {FORMATS.filter((f) => f.category === category && readable.has(f.id as FormatId)).map((f) => (
                    <a
                      key={f.id}
                      href={`${import.meta.env.BASE_URL}${formatSlug(f.id as FormatId)}/`}
                      title={`${f.name} converter`}
                      className="hover:text-ink hover:underline hover:underline-offset-4"
                    >
                      {displayName(f.id as FormatId)}
                    </a>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <h2 className="mt-10 text-[1.35rem] font-[700] [font-variation-settings:'wdth'_90]">Common conversions</h2>
          <div className="mt-4 space-y-4">
            {CATEGORIES.map((category) => {
              const pairs = LANDING_PAIRS.filter(([from]) => getFormat(from).category === category);
              if (!pairs.length) return null;
              return (
                <div key={category}>
                  <h3 className="text-[0.8125rem] font-[620] text-ink-3">{CATEGORY_NAMES[category]}</h3>
                  <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-ink-2">
                    {pairs.map(([from, to]) => (
                      <li key={`${from}-${to}`}>
                        <a
                          href={`${import.meta.env.BASE_URL}${landingSlug(from, to)}/`}
                          className="underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink-3"
                        >
                          {displayName(from)} to {displayName(to)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-16 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-6 text-[0.8125rem] text-ink-3">
        <p>
          Made in Vancouver by{' '}
          <a href={AUTHOR_URL} rel="author" className="font-[600] text-ink-2 hover:text-ink">
            Joshua Fitz-Morris
          </a>
        </p>
        <a href={AUTHOR_GITHUB_URL} rel="noopener" aria-label="Joshua Fitz-Morris on GitHub" className="hover:text-ink">
          GitHub
        </a>
      </div>
    </footer>
  );
}
