import { FormEvent, useRef, useState } from 'react';
import { api, uploadViaSignedUrl } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { useLoad } from '../../lib/useLoad';
import { Btn, Card, ErrorText, Field, inputCls } from '../../components/ui';

export default function Settings() {
  const { me, reloadMe } = useMe();
  const admin = me.user.role === 'ADMIN';
  const members = useLoad(() => api<any[]>('/api/workspace/members'), []);
  const [name, setName] = useState(me.workspace.name);
  const [color, setColor] = useState(me.workspace.brandColor);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const act = async (fn: () => Promise<any>, ok: string) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); reloadMe(); members.reload(); } catch (e: any) { setErr(e.message); } };
  const uploadLogo = (file: File) => act(async () => {
    const perm = await api('/api/workspace/logo-upload-url', 'POST', { fileName: file.name });
    await uploadViaSignedUrl(perm, file);
    await api('/api/workspace', 'PATCH', { logoPath: perm.path });
  }, 'Logo updated.');

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ErrorText text={err} />{msg && <p className="text-sm text-green-700">{msg}</p>}
      {!admin && <p className="text-sm text-slate-500">Only admins can change workspace settings.</p>}
      <Card>
        <h2 className="mb-3 font-medium">Agency</h2>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void act(() => api('/api/workspace', 'PATCH', { name, brandColor: color }), 'Saved.'); }}>
          <Field label="Agency name"><input className={inputCls} disabled={!admin} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Brand colour"><input type="color" disabled={!admin} value={color} onChange={(e) => setColor(e.target.value)} /></Field>
          <div className="mb-3 flex items-center gap-3 text-sm">
            {me.workspace.logoUrl ? <img src={me.workspace.logoUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="text-slate-500">No logo yet</span>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
            <Btn type="button" disabled={!admin} onClick={() => fileRef.current?.click()}>Upload logo</Btn>
          </div>
          <Btn primary disabled={!admin}>Save</Btn>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 font-medium">Team</h2>
        {members.data?.map((m) => (
          <div key={m.id} className="flex items-center justify-between border-t py-2 text-sm first:border-0">
            <span>{m.name} <span className="text-slate-500">{m.email} · {m.role.toLowerCase()}</span></span>
            {admin && m.id !== me.user.id && <Btn onClick={() => confirm(`Remove ${m.name}?`) && act(() => api(`/api/workspace/members/${m.id}`, 'DELETE'), 'Member removed.')}>Remove</Btn>}
          </div>
        ))}
        {admin && (
          <form className="mt-3 flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void act(async () => { await api('/api/workspace/invites', 'POST', { email }); setEmail(''); }, 'Invite sent.'); }}>
            <input className={inputCls} type="email" required placeholder="teammate@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} /><Btn primary>Invite</Btn>
          </form>
        )}
      </Card>
    </div>
  );
}
