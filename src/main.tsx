import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { holdSessionLock, sweepDisk } from './lib/disk';
import { addFiles, getState, subscribe } from './state/jobs';
import './styles/index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.env.PROD) {
  // Offline support. The service worker only caches the app; it never sees your files.
  // A new version is applied straight away if nothing has been added yet, otherwise as
  // soon as the page is empty again, so an update can never interrupt a conversion.
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        const applyWhenIdle = () => {
          if (getState().jobs.length > 0) return false;
          void update(true);
          return true;
        };
        if (applyWhenIdle()) return;
        const unsubscribe = subscribe(() => {
          if (applyWhenIdle()) unsubscribe();
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
