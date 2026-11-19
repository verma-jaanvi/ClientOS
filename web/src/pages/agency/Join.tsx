import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { Btn, Card, ErrorText, Field, inputCls } from '../../components/ui';

export default function Join() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const nav = useNavigate();
  const [info, setInfo] = useState<{ email: string; workspaceName: string } | null>(null);
  const [f, setF] = useState({ name: '', password: '' });
  const [err, setErr] = useState('');

  useEffect(() => { api(`/api/auth/invite/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    try {
      await api('/api/auth/accept-invite', 'POST', { token, ...f });
      const { error } = await supabase.auth.signInWithPassword({ email: info!.email, password: f.password });
      if (error) throw error;
      nav('/app');
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <h1 className="text-center text-lg font-semibold">{info ? `Join ${info.workspaceName}` : 'Invite'}</h1>
        <ErrorText text={err} />
        {info && (
          <form onSubmit={submit} className="mt-4">
            <p className="mb-3 text-sm text-slate-600">{info.email}</p>
            <Field label="Your name"><input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Password"><input className={inputCls} type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Btn primary className="w-full">Join workspace</Btn>
          </form>
        )}
      </Card>
    </main>
  );
}
