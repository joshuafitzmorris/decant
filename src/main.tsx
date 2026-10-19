import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { addFiles } from './state/jobs';
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
  // Offline support. The service worker only caches; it never sees file contents.
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
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

// Very large video conversions write to the browser's private file system; tidy up after earlier visits.
void navigator.storage
  ?.getDirectory?.()
  .then(async (dir) => {
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name.startsWith('decant-')) await dir.removeEntry(name).catch(() => {});
    }
  })
  .catch(() => {});
