import { useEffect, useRef, useState } from 'react';
import type { Job } from '../state/jobs';

const isActive = (job: Job) => job.status === 'queued' || job.status === 'working';

/**
 * Shows a long conversion's progress in the tab's title, so it can be watched
 * from another tab, and says when the results are ready if the tab is hidden.
 */
export function useTabTitle(jobs: Job[], pageTitle: string) {
  // Every file in the current run, so the percentage covers the whole batch rather than what's left of it.
  const batch = useRef(new Set<string>());
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.hidden);
      if (!document.hidden) setReady(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const active = jobs.filter(isActive);
    if (active.length === 0) {
      const finished = batch.current.size > 0;
      batch.current.clear();
      if (finished && document.hidden && jobs.some((job) => job.outputs.some((output) => !output.saved)))
        setReady(true);
      if (jobs.length === 0) setReady(false);
      return;
    }
    setReady(false);
    for (const job of active) batch.current.add(job.id);
  }, [jobs]);

  useEffect(() => {
    const active = jobs.some(isActive);
    if (!active) {
      document.title = ready && hidden ? 'Ready to save | Decant' : pageTitle;
      return;
    }
    let total = 0;
    let known = false;
    for (const id of batch.current) {
      const job = jobs.find((j) => j.id === id);
      if (!job || !isActive(job)) {
        total += 1;
        known = true;
      } else if (job.status === 'working' && job.progress !== null) {
        total += job.progress;
        known = true;
      }
    }
    const percent = Math.floor((total / Math.max(1, batch.current.size)) * 100);
    document.title = known ? `${percent}% converted | Decant` : 'Converting… | Decant';
  }, [jobs, pageTitle, ready, hidden]);
}
