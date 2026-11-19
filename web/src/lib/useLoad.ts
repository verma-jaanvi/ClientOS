import { useCallback, useEffect, useState } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), deps);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
