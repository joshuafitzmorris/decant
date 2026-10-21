import { displayName } from '../src/core/formats';
import {
  conversionCount,
  type Faq,
  FORMAT_ABOUT,
  formatCount,
  formatFaq,
  pageMeta,
  pairFaq,
  pairSteps,
  type Route,
  routePath,
  siteFaq,
} from '../src/core/seo';

const REPO = 'https://github.com/joshuafitzmorris/decant';
const AUTHOR = { '@type': 'Person', name: 'Joshua Fitz-Morris', url: 'https://github.com/joshuafitzmorris' };

/**
 * schema.org data for a page, matching what the page shows: the app itself,
 * the how-to steps, the questions and where the page sits on the site.
 */
export function structuredData(route: Route, siteUrl: string): object[] {
  const url = `${siteUrl}${routePath(route)}`;
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${siteUrl}#app`,
    name: 'Decant',
    url: siteUrl,
    description: `A free, private file converter that runs in the browser: ${formatCount()} formats and ${conversionCount()} conversions across images, audio, video, documents, ebooks and spreadsheets. Files are never uploaded.`,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (runs in a web browser)',
    browserRequirements: 'Requires a current browser with JavaScript and WebAssembly, such as Chrome, Edge or Safari.',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: REPO,
    author: AUTHOR,
    featureList: [
      'Converts files on your device; nothing is uploaded',
      'No ads, tracking or accounts',
      'No file size limit beyond your device',
      'Works offline once loaded',
      'Images: HEIC, WebP, AVIF, PNG, JPG, SVG and more',
      'Audio and video: MP4, MOV, MKV, MP3, WAV, FLAC and more',
      'Ebooks: EPUB, MOBI, AZW3, FB2 and CBZ',
      'Documents and data: PDF, Word, Markdown, CSV, Excel, JSON, YAML',
    ],
  };
  const faq = (faqs: Faq[]) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  });
  const breadcrumbs = (name: string) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Decant', item: siteUrl },
      { '@type': 'ListItem', position: 2, name, item: url },
    ],
  });

  if (route.kind === 'pair') {
    const s = displayName(route.from);
    const t = displayName(route.to);
    return [
      app,
      {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: `How to convert ${s} to ${t}`,
        description: pageMeta(route).description,
        totalTime: 'PT1M',
        tool: { '@type': 'HowToTool', name: 'Decant, in a web browser' },
        step: pairSteps(route.from, route.to).map((text, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          text,
          url: `${url}#step-${i + 1}`,
        })),
      },
      faq(pairFaq(route.from, route.to)),
      breadcrumbs(`${s} to ${t}`),
    ];
  }
  if (route.kind === 'format') {
    const s = displayName(route.format);
    return [
      app,
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: pageMeta(route).heading,
        url,
        about: { '@type': 'Thing', name: `${s} file`, description: FORMAT_ABOUT[route.format] },
      },
      faq(formatFaq(route.format)),
      breadcrumbs(`${s} converter`),
    ];
  }
  return [
    app,
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Decant', url: siteUrl, inLanguage: 'en' },
    faq(siteFaq()),
  ];
}
