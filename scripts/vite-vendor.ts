import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Large runtime assets that are fetched on demand rather than bundled:
 * the ffmpeg.wasm core and pdf.js's fonts, character maps and decoders.
 * They are served from node_modules in dev and copied into `vendor/` on build,
 * so the site never has to reach a third-party CDN.
 */
const VENDOR_DIRS: Record<string, string> = {
  ffmpeg: 'node_modules/@ffmpeg/core/dist/esm',
  'pdfjs/cmaps': 'node_modules/pdfjs-dist/cmaps',
  'pdfjs/standard_fonts': 'node_modules/pdfjs-dist/standard_fonts',
  'pdfjs/wasm': 'node_modules/pdfjs-dist/wasm',
  'pdfjs/iccs': 'node_modules/pdfjs-dist/iccs',
};

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
};

export function vendorAssets(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';
  let base = '/';

  return {
    name: 'decant:vendor-assets',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        const prefix = `${base}vendor/`;
        if (!pathname.startsWith(prefix)) return next();
        const rel = decodeURIComponent(pathname.slice(prefix.length));
        for (const [key, dir] of Object.entries(VENDOR_DIRS)) {
          if (!rel.startsWith(`${key}/`)) continue;
          const dirAbs = resolve(root, dir);
          const file = resolve(dirAbs, rel.slice(key.length + 1));
          if (!file.startsWith(dirAbs + sep)) break;
          if (existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            createReadStream(file).pipe(res);
            return;
          }
        }
        next();
      });
    },
    writeBundle() {
      for (const [key, dir] of Object.entries(VENDOR_DIRS)) {
        cpSync(resolve(root, dir), resolve(outDir, 'vendor', key), {
          recursive: true,
          filter: (src) => !src.endsWith('.map') && !src.endsWith('.d.ts'),
        });
      }
    },
  };
}
