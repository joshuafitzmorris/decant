import { displayName } from '../src/core/formats';
import { formatSlug, LANDING_PAIRS, landingSlug } from '../src/core/landing';
import { targetsFor } from '../src/core/routes';
import { categoryName, conversionCount, formatCount, readableByCategory, siteFaq } from '../src/core/seo';

/**
 * /llms.txt (https://llmstxt.org): a plain summary for AI assistants and answer
 * engines, with the facts people ask about and links to every page.
 */
export function llmsTxt(siteUrl: string): string {
  const lines = [
    '# Decant',
    '',
    `> Decant (${siteUrl}) is a free, open-source file converter that runs entirely in the web browser. Files are converted on the user's own device and are never uploaded. There are no ads, no tracking, no accounts and no file size limits.`,
    '',
    `It converts between ${formatCount()} formats (${conversionCount()} conversions) across images, audio, video, documents, ebooks and spreadsheets, including HEIC to JPG, MOV to MP4, MP4 to MP3, PDF to JPG, EPUB to PDF, MOBI to EPUB and CSV to Excel.`,
    '',
    '## Key facts',
    '',
    "- Privacy: conversions run inside the browser tab. The page's Content-Security-Policy only allows connections back to decant.dev, a static site with no upload endpoint, so files never leave the device.",
    '- Cost: free. No ads, no premium tier, no account, no limit on the number of files.',
    "- Size: no fixed file size limit; the device's memory is the only limit.",
    '- Offline: works without a connection once the page and the converters used have loaded.',
    "- Speed: no upload or queue; video uses the device's hardware encoders through WebCodecs.",
    "- Browsers: current Chrome, Edge and Safari, including Safari on iPhone; tested in Chrome and WebKit (Safari's engine).",
    '- Ebooks: DRM-free EPUB, MOBI, AZW3, FB2 and CBZ. DRM-protected books cannot be converted.',
    '- Source code: https://github.com/joshuafitzmorris/decant (MIT licence). Made by Joshua Fitz-Morris.',
    '',
    '## Formats',
    '',
  ];
  for (const [category, formats] of readableByCategory()) {
    const links = formats.map((f) => `[${displayName(f)}](${siteUrl}${formatSlug(f)}/)`);
    lines.push(`- ${categoryName(category)}: ${links.join(', ')}`);
  }
  lines.push('', '## Popular conversions', '');
  for (const [from, to] of LANDING_PAIRS) {
    lines.push(`- [${displayName(from)} to ${displayName(to)}](${siteUrl}${landingSlug(from, to)}/)`);
  }
  lines.push('', '## Every conversion', '');
  for (const [, formats] of readableByCategory()) {
    for (const from of formats) {
      lines.push(`- ${displayName(from)} to ${targetsFor(from).map(displayName).join(', ')}`);
    }
  }
  lines.push('', '## Questions', '');
  for (const { question, answer } of siteFaq()) lines.push(`### ${question}`, '', answer, '');
  return `${lines.join('\n').trim()}\n`;
}
