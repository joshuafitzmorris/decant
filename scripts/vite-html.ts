import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

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

/** Production-only additions to index.html: the CSP and a preload for the display font. */
export function htmlExtras(): Plugin {
  let base = '/';
  return {
    name: 'decant:html-extras',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
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
 * Writes a copy of index.html for each popular conversion (/heic-to-jpg/) with
 * its own title and description, plus a sitemap and a 404 page that boots the app.
 */
export function landingPages(options: {
  siteUrl: string;
  pairs: [string, string][];
  copy: (from: string, to: string) => { title: string; description: string };
}): Plugin {
  let outDir = 'dist';
  return {
    name: 'decant:landing-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const index = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const urls = [options.siteUrl];
      for (const [from, to] of options.pairs) {
        const slug = `${from}-to-${to}`;
        const url = `${options.siteUrl}${slug}/`;
        const { title, description } = options.copy(from, to);
        const html = index
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
          .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`)
          .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
        mkdirSync(resolve(outDir, slug), { recursive: true });
        writeFileSync(resolve(outDir, slug, 'index.html'), html);
        urls.push(url);
      }
      writeFileSync(resolve(outDir, '404.html'), index);
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((url) => `  <url><loc>${url}</loc></url>`)
        .join('\n')}\n</urlset>\n`;
      writeFileSync(resolve(outDir, 'sitemap.xml'), sitemap);
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
