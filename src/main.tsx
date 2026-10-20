import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app/App';
import { pageMeta, routeFromPath, routePath } from './core/seo';
import { holdSessionLock, sweepDisk } from './lib/disk';
import { addFiles, getState, preferTarget, subscribe } from './state/jobs';
import './styles/index.css';

// On a page such as /heic-to-jpg/, files default to that conversion.
const route = routeFromPath(window.location.pathname, import.meta.env.BASE_URL);
if (route.kind === 'pair') preferTarget(route.from, route.to);
// Offline, every URL is answered with the cached home page, so the title is set here too.
document.title = pageMeta(route).title;

const root = document.getElementById('root');
if (root) {
  const app = (
    <StrictMode>
      <App route={route} />
    </StrictMode>
  );
  // Built pages arrive already rendered (scripts/vite-html.ts). Offline, the cached home page can stand in
  // for another URL; then its markup doesn't match and the app renders from scratch.
  if (root.firstElementChild && root.dataset.route === routePath(route)) hydrateRoot(root, app);
  else {
    root.replaceChildren();
    createRoot(root).render(app);
  }
}

if (import.meta.env.PROD) {
  // Offline support. The service worker only caches the app; it never sees your files.
  // A new version is applied straight away if nothing has been added yet, otherwise as
  // soon as the page is empty again, so an update can never interrupt a conversion.
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const whenIdle = (fn: () => void) => {
      if (getState().jobs.length === 0) return fn();
      const unsubscribe = subscribe(() => {
        if (getState().jobs.length > 0) return;
        unsubscribe();
        fn();
      });
    };
    const reloadWhenIdle = () => whenIdle(() => window.location.reload());
    let requested = false;
    const applyWhenIdle = () =>
      whenIdle(() => {
        if (requested) return;
        requested = true;
        void update();
      });

    const update = registerSW({
      immediate: true,
      onNeedRefresh: applyWhenIdle,
      // The new version has taken over this page, possibly from another tab.
      onNeedReload: reloadWhenIdle,
      onRegisteredSW(_url, registration) {
        // A version that began installing before registration, as usually happens on the
        // first visit after a deploy, never reaches onNeedRefresh, so watch for it here.
        const installing = registration?.installing;
        if (!installing || !navigator.serviceWorker.controller) return;
        installing.addEventListener('statechange', () => {
          if (installing.state !== 'installed') return;
          navigator.serviceWorker.addEventListener('controllerchange', reloadWhenIdle, { once: true });
          applyWhenIdle();
        });
      },
    });
  });
} else {
  void import('./dev/harness');
}

// Files opened through the installed app ("Open with Decant").
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(fn: (params: LaunchParams) => void): void } })
  .launchQueue;
launchQueue?.setConsumer(async ({ files }) => {
  if (files.length) addFiles(await Promise.all(files.map((handle) => handle.getFile())));
});

// Very large video conversions write to the browser's private file system; tidy up after closed tabs.
holdSessionLock();
void sweepDisk().catch(() => {});
