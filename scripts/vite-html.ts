import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { FORMAT_PAGES, LANDING_PAIRS } from '../src/core/landing';
import { pageMeta, type Route, routePath } from '../src/core/seo';
import { llmsTxt } from './llms';
import { structuredData } from './structured-data';

/**
 * The page's Content-Security-Policy. `connect-src 'self'` is the important
 * line: the page cannot send data to any other origin, so files physically
 * cannot be uploaded anywhere. WebAssembly needs 'wasm-unsafe-eval', and some
 * codecs start their workers from blob: URLs.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * index.html additions: the site's public URL in canonical and social tags (always),
 * plus, in production builds, the CSP and a preload for the display font.
 */
export function htmlExtras({ siteUrl }: { siteUrl: string }): Plugin {
  let base = '/';
  let building = false;
  return {
    name: 'decant:html-extras',
    configResolved(config) {
      base = config.base;
      building = config.command === 'build';
    },
    transformIndexHtml: {
      order: 'post',
      handler(rawHtml, context) {
        const html = rawHtml.replaceAll('%SITE_URL%', siteUrl);
        if (!building) return html;
        // Directly after the charset declaration, which must stay first.
        const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;
        const withCsp = html.replace(/<meta charset="UTF-8" \/>/i, (charset) => `${charset}\n    ${csp}`);
        const tags: { tag: string; attrs: Record<string, string | boolean>; injectTo: 'head' }[] = [];
        const font = Object.keys(context.bundle ?? {}).find((file) => /archivo-latin-wdth-normal.*\.woff2$/.test(file));
        if (font) {
          tags.push({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `${base}${font}`, crossorigin: true },
            injectTo: 'head',
          });
        }
        return { html: withCsp, tags };
      },
    },
  };
}

/**
 * Writes every page of the site, each rendered to real HTML with React on the
 * build machine: the home page, a page per popular conversion (/heic-to-jpg/)
 * and a page per format (/heic-converter/). Each gets its own title,
 * description, canonical URL and schema.org data. Also writes the sitemap,
 * robots.txt, llms.txt and a 404 page that boots the app.
 *
 * Runs in writeBundle, before vite-plugin-pwa fingerprints the files in closeBundle.
 */
export function sitePages(options: { siteUrl: string }): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  let base = '/';
  return {
    name: 'decant:site-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      root = config.root;
      base = config.base;
    },
    async writeBundle() {
      const template = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const routes: Route[] = [
        { kind: 'home' },
        ...LANDING_PAIRS.map(([from, to]): Route => ({ kind: 'pair', from, to })),
        ...FORMAT_PAGES.map((format): Route => ({ kind: 'format', format })),
      ];
      const renderer = await loadRenderer(root, base);
      try {
        for (const route of routes) {
          const path = routePath(route);
          const html = page(template, route, options.siteUrl, renderer.render(route));
          mkdirSync(resolve(outDir, path), { recursive: true });
          writeFileSync(resolve(outDir, path, 'index.html'), html);
        }
        // Unknown URLs get the home page, marked so search engines skip it.
        const notFound = page(template, { kind: 'home' }, options.siteUrl, renderer.render({ kind: 'home' }));
        writeFileSync(
          resolve(outDir, '404.html'),
          notFound.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>'),
        );
      } finally {
        await renderer.close();
      }

      const today = new Date().toISOString().slice(0, 10);
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes
        .map((route) => `  <url><loc>${options.siteUrl}${routePath(route)}</loc><lastmod>${today}</lastmod></url>`)
        .join('\n')}\n</urlset>\n`;
      writeFileSync(resolve(outDir, 'sitemap.xml'), sitemap);
      writeFileSync(
        resolve(outDir, 'robots.txt'),
        `User-agent: *\nAllow: /\n\nSitemap: ${options.siteUrl}sitemap.xml\n`,
      );
      writeFileSync(resolve(outDir, 'llms.txt'), llmsTxt(options.siteUrl));
    },
  };
}

/** Fills the built index.html with one page's metadata, structured data and prerendered markup. */
function page(template: string, route: Route, siteUrl: string, markup: string): string {
  const url = `${siteUrl}${routePath(route)}`;
  const { title, description } = pageMeta(route);
  const data = structuredData(route, siteUrl)
    .map((item) => `    <script type="application/ld+json">${JSON.stringify(item).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace('</head>', `${data}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root" data-route="${routePath(route)}">${markup}</div>`);
}

/** React's server renderer for the app, loaded through Vite so TypeScript and JSX just work. */
async function loadRenderer(root: string, base: string) {
  const [{ createServer }, { default: react }] = await Promise.all([import('vite'), import('@vitejs/plugin-react')]);
  const server = await createServer({
    configFile: false,
    root,
    base,
    logLevel: 'error',
    appType: 'custom',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { __VENDOR_FFMPEG__: '""', __VENDOR_PDFJS__: '""' },
  });
  const entry = (await server.ssrLoadModule('/src/entry-server.tsx')) as { render: (route: Route) => string };
  return { render: entry.render, close: () => server.close() };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
