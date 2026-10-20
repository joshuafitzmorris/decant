import { expect, test } from '@playwright/test';

/**
 * What search engines and AI crawlers see: real content in the HTML itself
 * (most AI crawlers don't run JavaScript), page-specific metadata, valid
 * structured data, and the files that list the site.
 */
const PAGES = [
  {
    path: './',
    title: /^Decant: a free file converter/,
    content: 'Is Decant free?',
    types: ['WebApplication', 'WebSite', 'FAQPage'],
  },
  {
    path: 'heic-to-jpg/',
    title: /^HEIC to JPG converter/,
    content: 'How to convert HEIC to JPG',
    types: ['WebApplication', 'HowTo', 'FAQPage', 'BreadcrumbList'],
  },
  {
    path: 'epub-converter/',
    title: /^EPUB converter/,
    content: 'What are EPUB files?',
    types: ['WebApplication', 'WebPage', 'FAQPage', 'BreadcrumbList'],
  },
];

for (const { path, title, content, types } of PAGES) {
  test(`${path} is fully rendered in its HTML`, async ({ request, baseURL }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`<title>${title.source.slice(1)}`));
    expect(html).toContain(content);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    expect(canonical).toMatch(new RegExp(`${path === './' ? '' : path}$`));
    const data = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1] as string),
    );
    expect(data.map((item) => item['@type'])).toEqual(types);
    expect(baseURL).toBeTruthy();
  });
}

test('pages hydrate without errors, and the guide stays until files are added', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  for (const path of ['./', 'heic-to-jpg/', 'epub-converter/']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: /^Choose/ })).toBeVisible();
    await page.waitForTimeout(300);
  }
  expect(errors).toEqual([]);
  await page.goto('heic-to-jpg/');
  await expect(page.getByRole('heading', { name: 'How to convert HEIC to JPG' })).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'x.heic', mimeType: 'image/heic', buffer: Buffer.from('not really') });
  await expect(page.getByRole('heading', { name: 'How to convert HEIC to JPG' })).toBeHidden();
});

test('the sitemap, robots.txt and llms.txt list the site', async ({ request }) => {
  const sitemap = await (await request.get('sitemap.xml')).text();
  expect(sitemap).toContain('/heic-to-jpg/</loc>');
  expect(sitemap).toContain('/epub-converter/</loc>');
  expect(sitemap).toContain('<lastmod>');
  const robots = await (await request.get('robots.txt')).text();
  expect(robots).toMatch(/Sitemap: \S+sitemap\.xml/);
  const llms = await (await request.get('llms.txt')).text();
  expect(llms.startsWith('# Decant\n\n> Decant')).toBe(true);
  expect(llms).toContain('never uploaded');
  expect(llms).toContain('/epub-to-pdf/)');
});
