import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
}

export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  const generation = useRef(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;

    setError(undefined);
    if (data === undefined) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    fetcher()
      .then((result) => {
        if (!cancelled && current === generation.current) {
          setData(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled && current === generation.current) {
          setError(caught instanceof ApiError ? caught : undefined);
          if (!(caught instanceof ApiError)) {
            throw caught;
          }
        }
      })
      .finally(() => {
        if (!cancelled && current === generation.current) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  return { data, error, loading, refreshing, reload };
}

export function usePolling(reload: () => void, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const tick = (): void => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    };

    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs, enabled]);
}
