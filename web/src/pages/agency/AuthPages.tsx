import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { Btn, Card, ErrorText, Field, inputCls } from '../../components/ui';

function Shell({ title, sub, children, foot }: { title: string; sub?: string; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <span className="font-semibold">ClientOS</span>
        <Link to="/login" className="text-sm text-slate-600">Log in</Link>
      </header>
      <main className="mx-auto mt-16 max-w-sm px-4">
        <Card>
          <h1 className="text-center text-lg font-semibold">{title}</h1>
          {sub && <p className="mb-4 text-center text-sm text-slate-500">{sub}</p>}
          {children}
          <p className="mt-3 text-center text-sm text-slate-600">{foot}</p>
        </Card>
      </main>
    </div>
  );
}

export function Signup() {
  const nav = useNavigate();
  const [f, setF] = useState({ agencyName: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/api/auth/signup', 'POST', f);
      const { error } = await supabase.auth.signInWithPassword({ email: f.email, password: f.password });
      if (error) throw error;
      nav('/app');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Create your workspace" sub="Takes about two minutes" foot={<>Already have an account? <Link to="/login" className="underline">Log in</Link></>}>
      <form onSubmit={submit}>
        <Field label="Agency name"><input className={inputCls} required minLength={2} value={f.agencyName} onChange={(e) => setF({ ...f, agencyName: e.target.value })} placeholder="Northwind Digital" /></Field>
        <Field label="Work email"><input className={inputCls} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@northwind.com" /></Field>
        <Field label="Password"><input className={inputCls} type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="At least 8 characters" /></Field>
        <ErrorText text={err} />
        <Btn primary className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</Btn>
      </form>
    </Shell>
  );
}

export function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword(f);
    setBusy(false);
    if (error) return setErr(error.message);
    nav('/app');
  }
  return (
    <Shell title="Log in" foot={<>New here? <Link to="/signup" className="underline">Create a workspace</Link></>}>
      <form onSubmit={submit} className="mt-4">
        <Field label="Work email"><input className={inputCls} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><input className={inputCls} type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorText text={err} />
        <Btn primary className="w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</Btn>
      </form>
    </Shell>
  );
}
