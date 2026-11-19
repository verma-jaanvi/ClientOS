import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { Btn, Card, Empty, ErrorText, Field, Pill, inputCls } from '../../components/ui';

export default function Dashboard() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, error } = useLoad(() => api(`/api/clients?q=${encodeURIComponent(q)}`), [q]);
  const members = useLoad(() => api<any[]>('/api/workspace/members'), []);
  const [f, setF] = useState({ company: '', website: '', industry: '', ownerId: '' });
  const [err, setErr] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const body: any = { company: f.company };
      if (f.website) body.website = f.website;
      if (f.industry) body.industry = f.industry;
      if (f.ownerId) body.ownerId = f.ownerId;
      const c = await api('/api/clients', 'POST', body);
      nav(`/app/clients/${c.id}`);
    } catch (e: any) { setErr(e.message); }
  }

  const s = data?.summary;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Clients</h1>
        <div className="flex gap-2">
          <input className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
          <Btn primary onClick={() => setAdding(!adding)}>+ Add client</Btn>
        </div>
      </div>

      {s && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {[`Awaiting approval: ${s.awaitingApproval}`, `Open requests: ${s.openRequests}`, `Changes requested: ${s.changesRequested}`].map((t) => (
            <span key={t} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">{t}</span>
          ))}
        </div>
      )}

      {adding && (
        <Card className="mb-4 max-w-xl">
          <form onSubmit={add}>
            <Field label="Company name"><input className={inputCls} required value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Website"><input className={inputCls} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
              <Field label="Industry"><input className={inputCls} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></Field>
            </div>
            <Field label="Owner">
              <select className={inputCls} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
                <option value="">Me</option>
                {members.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <ErrorText text={err} />
            <Btn primary>Save client</Btn>
          </form>
        </Card>
      )}

      <ErrorText text={error} />
      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="p-3 font-normal">Client</th><th className="font-normal">Owner</th><th className="font-normal">Status</th><th className="font-normal">Pending approvals</th><th className="font-normal">Open requests</th></tr></thead>
          <tbody>
            {data?.clients.map((c: any) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="p-3 font-medium"><Link to={`/app/clients/${c.id}`}>{c.company}</Link></td>
                <td>{c.ownerName ?? '–'}</td><td><Pill status={c.status} /></td><td>{c.pendingApprovals}</td><td>{c.openRequests}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.clients.length === 0 && <div className="px-3"><Empty text={q ? 'No clients match your search.' : 'No clients yet. Add your first client.'} /></div>}
      </Card>
    </div>
  );
}
