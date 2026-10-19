/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { vendorAssets } from './scripts/vite-vendor.ts';

// GitHub Pages serves the site from /decant/. Override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/decant/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? base : '/',
  plugins: [react(), tailwindcss(), vendorAssets()],
  worker: { format: 'es' },
  optimizeDeps: {
    // Worker and lazily-imported dependencies, listed so the dev server doesn't
    // discover them mid-session and reload the page.
    include: [
      '@joplin/turndown-plugin-gfm',
      '@mediabunny/aac-encoder',
      '@mediabunny/ac3',
      '@mediabunny/flac-encoder',
      '@mediabunny/mp3-encoder',
      '@mediabunny/prores',
      'fast-xml-parser',
      'fflate',
      'gifenc',
      'libheif-js/libheif-wasm/libheif-bundle.mjs',
      'mammoth',
      'marked',
      'mediabunny',
      'pdf-lib',
      'pdfjs-dist',
      'smol-toml',
      'turndown',
      'utif2',
      'xlsx',
      'xlsx/dist/cpexcel.full.mjs',
      'yaml',
    ],
    // These locate their .wasm files relative to their own module URL, which
    // pre-bundling would break.
    exclude: [
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util',
      '@jsquash/avif',
      '@jsquash/jpeg',
      '@jsquash/jxl',
      '@jsquash/oxipng',
      '@jsquash/webp',
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
}));
