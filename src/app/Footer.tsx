import { CATEGORY_NAMES, type Category, FORMATS, type FormatId, getFormat } from '../core/formats';
import { formatSlug, LANDING_PAIRS, landingSlug } from '../core/landing';
import { readableFormats } from '../core/routes';
import { REPO_URL, SUPPORT_URL } from './Header';

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
            Decant does all of its work inside this browser tab. Your files are read from your disk, converted with
            WebAssembly and your device's own media encoders, and saved straight back. There is no server to upload to,
            and the page's security policy blocks connections to any other site.
          </p>
          <p>
            Video and audio use hardware-accelerated WebCodecs where your browser supports them, so a phone video
            usually converts faster than it plays. Formats that need it fall back to a copy of ffmpeg that is downloaded
            once and then cached.
          </p>
          <p>Converters you've used keep working offline: the page and its code stay in your browser's cache.</p>

          <h2 className="pt-6 text-[1.35rem] font-[700] text-ink [font-variation-settings:'wdth'_90]">
            No ads, no tracking
          </h2>
          <p>
            There are no ads, no analytics, no cookies and no accounts. Decant doesn't know who you are or what you
            convert, because your files never leave your device.
          </p>
          <p>
            It's free and open source under the MIT licence:{' '}
            <a href={REPO_URL} className={inlineLink}>
              read the code on GitHub
            </a>
            .
          </p>
          <p>
            How does it make money? It doesn't. If it saved you some hassle,{' '}
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
                      {f.label}
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
                          {getFormat(from).label} to {getFormat(to).label}
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
    </footer>
  );
}
