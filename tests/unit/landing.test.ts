import { describe, expect, it } from 'vitest';
import { FORMATS, type FormatId } from '../../src/core/formats';
import { FORMAT_PAGES, LANDING_PAIRS } from '../../src/core/landing';
import { canConvert } from '../../src/core/routes';
import {
  conversionCount,
  FORMAT_ABOUT,
  formatCount,
  pageMeta,
  type Route,
  routeFromPath,
  routePath,
  siteFaq,
} from '../../src/core/seo';

const pages: Route[] = [
  { kind: 'home' },
  ...LANDING_PAIRS.map(([from, to]): Route => ({ kind: 'pair', from, to })),
  ...FORMAT_PAGES.map((format): Route => ({ kind: 'format', format })),
];

describe('landing pages', () => {
  it('only lists conversions the app can actually do, each once', () => {
    for (const [from, to] of LANDING_PAIRS) expect(canConvert(from, to), `${from} → ${to}`).toBe(true);
    expect(new Set(LANDING_PAIRS.map((p) => p.join('>'))).size).toBe(LANDING_PAIRS.length);
  });

  it('reads the page from the path, with or without a trailing slash or a base', () => {
    expect(routeFromPath('/heic-to-jpg/', '/')).toEqual({ kind: 'pair', from: 'heic', to: 'jpg' });
    expect(routeFromPath('/decant/HEIC-to-JPG', '/decant/')).toEqual({ kind: 'pair', from: 'heic', to: 'jpg' });
    expect(routeFromPath('/epub-converter/', '/')).toEqual({ kind: 'format', format: 'epub' });
    for (const path of [
      '/',
      '/jpg-to-jpg/',
      '/pdf-to-docx/',
      '/exe-to-jpg/',
      '/heic-to-jpg/extra',
      '/exe-converter/',
    ]) {
      expect(routeFromPath(path, '/'), path).toEqual({ kind: 'home' });
    }
  });

  it('maps every page to a path and back', () => {
    for (const page of pages) expect(routeFromPath(`/${routePath(page)}`, '/')).toEqual(page);
  });

  it('gives every page its own title and a description that fits a search result', () => {
    const titles = pages.map((page) => pageMeta(page).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const page of pages) {
      const { title, description } = pageMeta(page);
      expect(title.length, title).toBeLessThanOrEqual(65);
      expect(description.length, description).toBeGreaterThanOrEqual(90);
      expect(description.length, description).toBeLessThanOrEqual(165);
    }
  });

  it('describes every format', () => {
    for (const format of FORMATS) expect(FORMAT_ABOUT[format.id as FormatId]?.length, format.id).toBeGreaterThan(40);
  });

  it("quotes the app's real numbers", () => {
    const answer = siteFaq().find((faq) => faq.question.startsWith('Which formats'))?.answer ?? '';
    expect(answer).toContain(`${formatCount()} formats`);
    expect(answer).toContain(`${conversionCount()} conversions`);
  });
});
