import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, useLoad } from '../../lib/useLoad';
import { Btn, Card, Empty, ErrorText, Field, Pill, inputCls } from '../../components/ui';

export default function ProjectPage() {
  const { id } = useParams();
  const { data: p, error, reload } = useLoad(() => api(`/api/projects/${id}`), [id]);
  const [ms, setMs] = useState({ title: '', dueDate: '' });
  const [dl, setDl] = useState({ title: '', description: '', milestoneId: '' });
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  if (error) return <p className="text-red-600">{error}</p>;
  if (!p) return <p className="text-slate-500">Loading…</p>;

  const run = (fn: () => Promise<any>) => async (e?: FormEvent) => {
    e?.preventDefault(); setErr('');
    try { await fn(); await reload(); } catch (x: any) { setErr(x.message); }
  };
  const groups = [
    ...p.milestones.map((m: any) => ({ key: m.id, title: `${m.title}, due ${fmtDate(m.dueDate)}`, items: p.deliverables.filter((d: any) => d.milestoneId === m.id) })),
    { key: 'none', title: 'No milestone', items: p.deliverables.filter((d: any) => !d.milestoneId) },
  ];

  return (
    <div className="max-w-4xl">
      <div className="mb-1 text-sm text-slate-500"><Link to="/app">Clients</Link> / <Link to={`/app/clients/${p.client.id}`}>{p.client.company}</Link> / {p.name}</div>
      <h1 className="mb-4 flex items-center gap-3 text-xl font-semibold">{p.name} <Pill status={p.status} /></h1>
      <ErrorText text={err} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <h2 className="mb-2 font-medium">Deliverables</h2>
          {p.deliverables.length === 0 && <Empty text="No deliverables yet." />}
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.key} className="mb-3">
              <p className="text-sm font-medium text-slate-600">{g.title}</p>
              {g.items.map((d: any) => (
                <Link key={d.id} to={`/app/deliverables/${d.id}`} className="flex items-center justify-between border-t py-2 text-sm">{d.title} <span className="flex items-center gap-2 text-slate-500">{d.currentVersion > 0 && `v${d.currentVersion}`}<Pill status={d.status} /></span></Link>
              ))}
            </div>
          ))}
          <form className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]" onSubmit={run(async () => { await api(`/api/projects/${id}/deliverables`, 'POST', { title: dl.title, description: dl.description, ...(dl.milestoneId ? { milestoneId: dl.milestoneId } : {}) }); setDl({ title: '', description: '', milestoneId: '' }); })}>
            <input className={inputCls} required placeholder="New deliverable title" value={dl.title} onChange={(e) => setDl({ ...dl, title: e.target.value })} />
            <input className={inputCls} placeholder="Description for the client" value={dl.description} onChange={(e) => setDl({ ...dl, description: e.target.value })} />
            <select className={inputCls + ' !w-auto'} value={dl.milestoneId} onChange={(e) => setDl({ ...dl, milestoneId: e.target.value })}><option value="">No milestone</option>{p.milestones.map((m: any) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
            <Btn primary>Add</Btn>
          </form>
        </Card>

        <Card>
          <h2 className="mb-2 font-medium">Milestones</h2>
          {p.milestones.length === 0 && <Empty text="No milestones yet." />}
          {p.milestones.map((m: any) => <p key={m.id} className="border-t py-1.5 text-sm first:border-0">{m.title} <span className="text-slate-500">due {fmtDate(m.dueDate)}</span></p>)}
          <form className="mt-3 space-y-2" onSubmit={run(async () => { await api(`/api/projects/${id}/milestones`, 'POST', ms); setMs({ title: '', dueDate: '' }); })}>
            <Field label="Title"><input className={inputCls} required value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} /></Field>
            <Field label="Due date"><input className={inputCls} type="date" required value={ms.dueDate} onChange={(e) => setMs({ ...ms, dueDate: e.target.value })} /></Field>
            <Btn primary>Add milestone</Btn>
          </form>
        </Card>

        <Card>
          <h2 className="mb-2 font-medium">Progress updates</h2>
          <p className="mb-2 text-xs text-slate-500">Clients see published updates only.</p>
          <form onSubmit={run(async () => { await api(`/api/projects/${id}/updates`, 'POST', { text }); setText(''); })}>
            <textarea className={inputCls} rows={3} required placeholder="What happened this week?" value={text} onChange={(e) => setText(e.target.value)} />
            <Btn primary className="mt-2">Publish</Btn>
          </form>
          {p.updates.map((u: any) => <p key={u.id} className="mt-3 border-t pt-2 text-sm"><span className="text-slate-500">{fmtDate(u.publishedAt)}</span> {u.text}</p>)}
        </Card>
      </div>
    </div>
  );
}
