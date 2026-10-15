import { useEffect, useRef } from 'react';

export const POLL_MS = 2000;

// Calls `callback` every `intervalMs` while `active` is true and the browser tab is visible.
// Stops as soon as `active` turns false (the job finished) or the tab is hidden, and polls once
// right away when a hidden tab becomes visible again.
export default function usePolling(callback, active, intervalMs = POLL_MS) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!active) return undefined;
    let timer = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer || document.hidden) return;
      timer = setInterval(() => saved.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        saved.current();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs]);
}
