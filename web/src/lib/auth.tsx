import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api } from './api';

type Me = { user: { id: string; name: string; email: string; role: 'ADMIN' | 'MEMBER' }; workspace: { id: string; name: string; brandColor: string; logoUrl: string | null } };
const Ctx = createContext<{ me: Me; reloadMe: () => void } | null>(null);
export const useMe = () => useContext(Ctx)!;

/** Guard: redirects to log in when there is no session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const loc = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = () => api<Me>('/api/me').then(setMe).catch((e) => setError(e.message));
  useEffect(() => { if (session) void loadMe(); else setMe(null); }, [session]);

  if (session === undefined) return <p className="p-8 text-slate-500">Loading…</p>;
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (error) return <p className="p-8 text-red-600">Could not load your workspace: {error}</p>;
  if (!me) return <p className="p-8 text-slate-500">Loading…</p>;
  return <Ctx.Provider value={{ me, reloadMe: loadMe }}>{children}</Ctx.Provider>;
}
