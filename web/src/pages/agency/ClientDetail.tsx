import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDateTime, useLoad } from '../../lib/useLoad';
import { Btn, Card, Empty, ErrorText, Field, Pill, inputCls } from '../../components/ui';

const TABS = ['Overview', 'Projects', 'Contacts', 'Notes'] as const;

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const { data: c, error, reload } = useLoad(() => api(`/api/clients/${id}`), [id]);
  const links = useLoad(() => api<any[]>(`/api/clients/${id}/links`), [id]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  if (error) return <p className="text-red-600">{error}</p>;
  if (!c) return <p className="text-slate-500">Loading…</p>;

  const run = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); await reload(); await links.reload(); } catch (e: any) { setErr(e.message); } };

  return (
    <div className="max-w-4xl">
      <div className="mb-1 text-sm text-slate-500"><Link to="/app">Clients</Link> / {c.company}</div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-xl font-semibold">{c.company} <Pill status={c.status} /></h1>
        {c.status === 'ACTIVE' && <Btn onClick={() => confirm('Archive this client? Live links stop working.') && run(async () => { await api(`/api/clients/${id}/archive`, 'POST'); nav('/app'); })}>Archive</Btn>}
      </div>
      <div className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm ${tab === t ? 'border-b-2 border-blue-600 font-medium' : 'text-slate-600'}`}>{t}</button>
        ))}
      </div>
      <ErrorText text={err} />

      {tab === 'Overview' && <Overview c={c} links={links.data ?? []} run={run} msg={msg} setMsg={setMsg} id={id!} />}
      {tab === 'Projects' && <Projects c={c} run={run} />}
      {tab === 'Contacts' && <Contacts c={c} run={run} />}
      {tab === 'Notes' && <Notes c={c} run={run} />}
    </div>
  );
}

function Overview({ c, links, run, msg, setMsg, id }: any) {
  const [contactId, setContactId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [made, setMade] = useState('');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="mb-2 font-medium">Waiting on a decision</h2>
        {c.waiting.length === 0 && <Empty text="Nothing waiting." />}
        {c.waiting.map((d: any) => (
          <Link key={d.id} to={`/app/deliverables/${d.id}`} className="flex items-center justify-between border-t py-2 text-sm first:border-0">{d.title} <Pill status={d.status} /></Link>
        ))}
        <p className="mt-3 text-sm text-slate-500">Open requests: {c.counts.openRequests}</p>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Contacts</h2>
        {c.contacts.length === 0 && <Empty text="Add a contact (Contacts tab) before sharing." />}
        {c.contacts.map((p: any) => <p key={p.id} className="text-sm">{p.name} <span className="text-slate-500">{p.email}</span></p>)}
      </Card>

      <Card className="md:col-span-2">
        <h2 className="mb-2 font-medium">Client links</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <select className={inputCls + ' !w-auto'} value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Contact…</option>{c.contacts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={inputCls + ' !w-auto'} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Project page…</option>{c.projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Btn disabled={!contactId || !projectId} onClick={() => run(async () => { const l = await api(`/api/clients/${id}/links`, 'POST', { contactId, projectId, scope: 'PROJECT' }); setMade(l.url); })}>Create project link</Btn>
        </div>
        {made && <p className="mb-3 break-all rounded bg-slate-100 p-2 text-xs">Copy now (shown once): {made}</p>}
        {links.map((l: any) => (
          <div key={l.id} className="flex items-center justify-between border-t py-2 text-sm">
            <span>{l.contact.name}, {l.scope.toLowerCase()}, expires {new Date(l.expiresAt).toLocaleDateString()} {l.usedAt ? '(opened)' : ''}</span>
            {l.revokedAt ? <span className="text-slate-500">Revoked</span> : <Btn onClick={() => run(() => api(`/api/links/${l.id}/revoke`, 'POST'))}>Revoke</Btn>}
          </div>
        ))}
      </Card>

      <Card className="md:col-span-2">
        <h2 className="mb-2 font-medium">Weekly digest</h2>
        <label className="mr-4 text-sm"><input type="checkbox" checked={c.digestEnabled} onChange={(e) => run(() => api(`/api/clients/${id}`, 'PATCH', { digestEnabled: e.target.checked }))} /> Send the weekly digest to this client</label>
        <Btn onClick={async () => { try { const r = await api(`/api/clients/${id}/digest/preview`, 'POST'); setMsg(r.sent ? 'Test digest sent to you.' : r.reason); } catch (e: any) { setMsg(e.message); } }}>Send me a test</Btn>
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      </Card>

      <Card className="md:col-span-2">
        <h2 className="mb-2 font-medium">History</h2>
        {c.history.length === 0 && <Empty text="No activity yet." />}
        {c.history.map((h: any) => (
          <p key={h.id} className="border-t py-1.5 text-sm first:border-0"><span className="text-slate-500">{fmtDateTime(h.createdAt)}</span> · {h.actorName ?? h.actorType} · {h.action} {h.details && <span className="text-slate-500">({h.details})</span>}</p>
        ))}
      </Card>
    </div>
  );
}

function Projects({ c, run }: any) {
  const [name, setName] = useState('');
  return (
    <Card>
      {c.projects.length === 0 && <Empty text="No projects yet." />}
      {c.projects.map((p: any) => <Link key={p.id} to={`/app/projects/${p.id}`} className="flex justify-between border-t py-2 text-sm first:border-0">{p.name}<Pill status={p.status} /></Link>)}
      {c.status === 'ACTIVE' && (
        <form className="mt-3 flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await api(`/api/clients/${c.id}/projects`, 'POST', { name }); setName(''); }); }}>
          <input className={inputCls} required placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} /><Btn primary>Add project</Btn>
        </form>
      )}
    </Card>
  );
}

function Contacts({ c, run }: any) {
  const [f, setF] = useState({ name: '', email: '' });
  return (
    <Card>
      {c.contacts.map((p: any) => (
        <div key={p.id} className="flex items-center justify-between border-t py-2 text-sm first:border-0">
          <span>{p.name} <span className="text-slate-500">{p.email}</span></span>
          <Btn onClick={() => confirm(`Remove ${p.name}?`) && run(() => api(`/api/contacts/${p.id}`, 'DELETE'))}>Remove</Btn>
        </div>
      ))}
      <form className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await api(`/api/clients/${c.id}/contacts`, 'POST', f); setF({ name: '', email: '' }); }); }}>
        <input className={inputCls} required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={inputCls} required type="email" placeholder="Email (magic links go here)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Btn primary>Add contact</Btn>
      </form>
    </Card>
  );
}

function Notes({ c, run }: any) {
  const [t, setT] = useState(c.internalNotes ?? '');
  return (
    <Card>
      <Field label="Internal notes (only your team can see these)"><textarea className={inputCls} rows={8} value={t} onChange={(e) => setT(e.target.value)} /></Field>
      <Btn primary onClick={() => run(() => api(`/api/clients/${c.id}`, 'PATCH', { internalNotes: t }))}>Save notes</Btn>
    </Card>
  );
}
