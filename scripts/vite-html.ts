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
