import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObdErrorInfo, Result } from '../../shared/types';

/** Load a Result-returning bridge call; re-runs when deps change. Never throws. */
export function useResult<T>(fn: (() => Promise<Result<T>>) | null, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ObdErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const f = fnRef.current;
    if (!f) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await f();
      if (my !== seq.current) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.error);
    } catch (e) {
      if (my === seq.current) setError({ code: 'INTERNAL', detail: String((e as Error)?.message ?? e) });
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

/** Run a bridge call; returns data or null, and reports errors through onError. */
export async function run<T>(p: Promise<Result<T>>, onError: (e: ObdErrorInfo) => void): Promise<T | null> {
  try {
    const r = await p;
    if (r.ok) return r.data;
    if (r.error.code !== 'CANCELLED') onError(r.error);
    return null;
  } catch (e) {
    onError({ code: 'INTERNAL', detail: String((e as Error)?.message ?? e) });
    return null;
  }
}
