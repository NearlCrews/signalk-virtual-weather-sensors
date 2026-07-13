import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelStatusResponse } from '../../types/index.js';
import { fetchJson, toErrorText } from '../api-base.js';

// 10 s poll: the status banner age advances per minute and the quota updates
// on each fetch (default 30 min cadence), so anything faster is wasted.
export const POLL_MS = 10_000;

// A snapshot older than two and a half poll intervals reads as stale: the
// poll has likely stalled (server restart, lost connection), so the dashboard
// shows a dim "updated Ns ago" marker. Defined here because staleness is a
// property of the polling cadence, not of any one component.
const STALE_AFTER_MS = 2.5 * POLL_MS;

export interface UseStatusResult {
  status: PanelStatusResponse | null;
  // Plain-language poll failure, or null while polling succeeds. The panel
  // shows it as a banner line instead of silently presenting stale data.
  error: string | null;
  // Wall-clock timestamp (ms) of the last successful poll, or null before the
  // first success.
  lastUpdatedMs: number | null;
  // Wall-clock timestamp (ms) of the last FAILED poll attempt (0 before any
  // failure). State, not a ref: each failed attempt bumps it so the dashboard
  // re-renders during an outage and its staleness marker keeps advancing.
  lastAttemptMs: number;
  // True once the last successful poll is older than STALE_AFTER_MS,
  // recomputed on every poll attempt.
  stale: boolean;
  // True until the first poll settles, so the dashboard can label the initial
  // placeholders as loading rather than as a dead plugin.
  loading: boolean;
  // One-shot fetch outside the poll loop. Returns the parsed status or null
  // on failure; the save flow uses it to confirm the plugin restarted.
  refresh: () => Promise<PanelStatusResponse | null>;
}

// One status fetch, with the failure folded into the result instead of a
// throw, so the hook's refresh stays a single linear path. `text` is the raw
// body so refresh can skip the setStatus write when nothing changed.
async function fetchStatus(signal: AbortSignal): Promise<{
  data: PanelStatusResponse | null;
  text: string;
  error: string | null;
}> {
  try {
    const { ok, status, text, body } = await fetchJson('/status', { signal });
    if (!ok) return { data: null, text: '', error: `HTTP ${status}` };
    if (body === null) return { data: null, text: '', error: 'invalid JSON in status response' };
    return { data: body as PanelStatusResponse, text, error: null };
  } catch (err) {
    return { data: null, text: '', error: toErrorText(err) };
  }
}

/**
 * Polls `${API_BASE}/status` every 10 s while the admin tab is visible.
 * Polling pauses for hidden tabs (with multiple admin tabs open across the
 * fleet a hidden tab still polling wastes CPU on Pi-class SK servers) and an
 * immediate refresh fires when the tab becomes visible again.
 *
 * Steady state is write-free: a successful poll whose payload matches the
 * previous one performs zero state changes (the setError(null) / setStale /
 * setLoading calls all hit React's same-value bail-out), so a healthy idle
 * panel does not re-render every 10 s.
 */
export function useStatus(): UseStatusResult {
  const [status, setStatus] = useState<PanelStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastAttemptMs, setLastAttemptMs] = useState(0);
  // Raw text of the last successful poll: the changed-payload gate for setStatus.
  const lastTextRef = useRef<string | null>(null);
  // Wall-clock time of the last successful poll. A ref, not state, so a
  // successful unchanged poll stays write-free; consumers read it on render.
  const lastUpdatedRef = useRef<number | null>(null);
  const cancelled = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<PanelStatusResponse | null> | null>(null);

  const refresh = useCallback((): Promise<PanelStatusResponse | null> => {
    if (inFlightRef.current) return inFlightRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = (async (): Promise<PanelStatusResponse | null> => {
      const result = await fetchStatus(controller.signal);
      if (cancelled.current || controller.signal.aborted) return result.data;
      if (result.data) {
        lastUpdatedRef.current = Date.now();
        if (result.text !== lastTextRef.current) {
          lastTextRef.current = result.text;
          setStatus(result.data);
        }
        setError(null);
      } else {
        setError(result.error);
        // Failure-only re-render driver: lets the dashboard's "updated Ns ago"
        // marker advance per attempt while the poll is down.
        setLastAttemptMs(Date.now());
      }
      setStale(
        lastUpdatedRef.current !== null && Date.now() - lastUpdatedRef.current > STALE_AFTER_MS
      );
      setLoading(false);
      return result.data;
    })().finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (inFlightRef.current === request) inFlightRef.current = null;
    });
    inFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    cancelled.current = false;
    const tickIfVisible = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh();
      }
    };
    tickIfVisible();
    const id = setInterval(tickIfVisible, POLL_MS);
    // Fetch immediately on becoming visible so the operator sees fresh state
    // without waiting up to 10 s for the next interval tick.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      cancelled.current = true;
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = null;
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [refresh]);

  return {
    status,
    error,
    lastUpdatedMs: lastUpdatedRef.current,
    lastAttemptMs,
    stale,
    loading,
    refresh,
  };
}
