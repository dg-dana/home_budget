import { useEffect } from 'react';

/** How often a shared page re-reads what other people may have changed. */
export const POLL_INTERVAL_MS = 15_000;

/**
 * Keeps a page current while somebody is looking at it.
 *
 * Shopping lists are the one thing here that several people touch at the same
 * time — a guest at the shop, somebody at home adding to the list — so a page
 * that only loads on mount goes stale in the exact situation the feature is
 * for. Every other page in the app is fine without this: expenses are not
 * edited by two people in the same minute.
 *
 * Two rules beyond "call it on a timer":
 *
 * - **A hidden tab does not poll.** A phone in a pocket with this page open
 *   would otherwise spend the afternoon making requests nobody reads, which is
 *   battery on the phone and load on a 512 MB box.
 * - **Coming back is immediate.** Taking the phone out is exactly when the list
 *   needs to be right, so becoming visible refetches at once rather than
 *   waiting out the rest of an interval.
 *
 * `load` must be stable — `useCallback` — or the effect restarts on every
 * render and the interval never fires.
 */
export function usePoll(load: () => Promise<unknown>, intervalMs = POLL_INTERVAL_MS): void {
  useEffect(() => {
    // A slow response must not let ticks stack up behind it.
    let inFlight = false;
    const refresh = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };

    const timer = window.setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, intervalMs]);
}
