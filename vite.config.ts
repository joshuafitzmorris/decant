/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BASE_PATH, SITE_URL } from './scripts/site.ts';
import { htmlExtras, landingPages } from './scripts/vite-html.ts';
import { vendorAssets } from './scripts/vite-vendor.ts';
import { LANDING_PAIRS, landingCopy } from './src/core/landing.ts';

const base = BASE_PATH;
const siteUrl = SITE_URL;

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
  plugins: [
    react(),
    tailwindcss(),
    vendorAssets(),
    htmlExtras({ siteUrl }),
    landingPages({ siteUrl, pairs: LANDING_PAIRS, copy: (from, to) => landingCopy(from as never, to as never) }),
    VitePWA({
      // Updates are applied by src/main.tsx when the page is idle, never mid-conversion.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Decant',
        short_name: 'Decant',
        description: 'Convert files in your browser. Nothing is uploaded.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#0f1a17',
        background_color: '#f2f4f3',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Installed on desktop, Decant shows up in "Open with" for these files.
        file_handlers: [
          {
            action: '.',
            accept: {
              'image/*': [
                '.heic',
                '.heif',
                '.jpg',
                '.jpeg',
                '.png',
                '.webp',
                '.avif',
                '.gif',
                '.tiff',
                '.bmp',
                '.svg',
                '.jxl',
              ],
              'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.wma'],
              'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv'],
              'application/pdf': ['.pdf'],
              'text/csv': ['.csv'],
            },
          },
        ],
      },
      workbox: {
        // Precache only the app shell; each converter is cached the first time it runs.
        globPatterns: [
          'index.html',
          'favicon.svg',
          'icons/*.png',
          'assets/index-*.{js,css}',
          'assets/archivo-latin-wdth-*.woff2',
        ],
        navigateFallbackDenylist: [/\/vendor\//, /\/assets\//],
        cleanupOutdatedCaches: true,
        // Control the page on first install so the converters it loads are cached right away.
        clientsClaim: true,
        runtimeCaching: [
          {
            // Hashed file names never change, so cached copies are always right.
            urlPattern: ({ url }) => url.pathname.includes('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'decant-assets', expiration: { maxEntries: 400, purgeOnQuotaError: true } },
          },
          {
            // Versioned directories (vendor/ffmpeg-0.12.10/...), so also safe to keep.
            urlPattern: ({ url }) => url.pathname.includes('/vendor/'),
            handler: 'CacheFirst',
            options: { cacheName: 'decant-vendor', expiration: { maxEntries: 600, purgeOnQuotaError: true } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: {
    // Worker and lazily-imported dependencies, listed so the dev server doesn't
    // discover them mid-session and reload the page.
    include: [
      '@joplin/turndown-plugin-gfm',
      '@mediabunny/aac-encoder',
      '@mediabunny/ac3',
      '@mediabunny/dts',
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
