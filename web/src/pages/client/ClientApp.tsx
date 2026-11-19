import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, capi } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/useLoad';

type Branding = { name: string; logoUrl: string | null; color: string };
const STATUS: Record<string, string> = { SHARED: 'Waiting for your approval', APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested' };
const TYPES = [['CHANGE', 'Change to agreed work'], ['DOCUMENT', 'Document request'], ['QUESTION', 'Question']] as const;

function Frame({ b, children }: { b?: Branding; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-3 py-6">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-300 bg-white shadow-sm">
        <header className="flex items-center gap-3 border-b px-5 py-4">
          {b?.logoUrl ? <img src={b.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full border" style={{ background: b?.color ?? '#e2e8f0' }} />}
          <span className="font-semibold">{b?.name ?? ' '}</span>
        </header>
        <div className="px-5 py-5">{children}</div>
        <footer className="pb-4 text-center text-xs text-slate-400">Powered by ClientOS</footer>
      </div>
    </div>
  );
}

export default function ClientApp() {
  const { token = '' } = useParams();
  const [view, setView] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid' | 'error'>('loading');
  const load = () => capi(token, '/view').then((v) => { setView(v); setState('ok'); }).catch((e) => setState(e instanceof ApiError && e.status === 401 ? 'invalid' : 'error'));
  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading') return <Frame><p className="text-slate-500">Loading…</p></Frame>;
  if (state === 'invalid') return <Frame><h1 className="mb-2 text-lg font-semibold">This link is no longer active</h1><p className="text-sm text-slate-600">It has expired or been replaced. Please contact your agency and they will send you a new one.</p></Frame>;
  if (state === 'error') return <Frame><p className="text-sm text-slate-600">Something went wrong loading this page. Please try again, or contact your agency.</p></Frame>;
  const color = view.branding.color;
  return <Frame b={view.branding}>{view.scope === 'DELIVERABLE' ? <DeliverableView token={token} v={view} color={color} reload={load} /> : <HomeView token={token} v={view} color={color} reload={load} />}</Frame>;
}

function RequestForm({ token, color, allowed, onDone, title }: { token: string; color: string; allowed: readonly (readonly [string, string])[]; onDone: () => void; title: string }) {
  const [type, setType] = useState(allowed[0][0]); const [text, setText] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr('');
    try { await capi(token, '/requests', 'POST', { type, text }); setText(''); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <label className="mt-2 block text-sm text-slate-600">What kind of request?
        <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" value={type} onChange={(e) => setType(e.target.value as any)}>{allowed.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label className="mt-3 block text-sm text-slate-600">Describe what you need
        <textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <button disabled={busy || text.trim().length < 3} onClick={send} className="mt-3 w-full rounded-xl border-2 py-3 font-medium disabled:opacity-50" style={{ borderColor: color }}>Send request</button>
      <p className="mt-2 text-center text-xs text-slate-500">The agency will reply on this page. You also get an email.</p>
    </div>
  );
}

function Requests({ list }: { list: any[] }) {
  if (!list.length) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-semibold">Your requests</h2>
      {list.map((r) => (
        <div key={r.id} className="mb-2 rounded-xl border p-3 text-sm">
          <p className="font-medium">{r.type === 'CHANGE' ? 'Change request' : r.type === 'DOCUMENT' ? 'Document request' : 'Question'}{r.deliverable && ` · ${r.deliverable.title}`}</p>
          <p className="text-slate-600">{r.text}</p>
          {r.status === 'OPEN' ? <p className="mt-1 text-slate-500">Waiting for a reply</p> : r.reply && (
            <div className="mt-2 rounded-lg bg-slate-50 p-2">
              <p><b>{r.decision === 'AGREE' ? 'Agreed' : 'Declined'}</b>{r.impactTimeline && ` · Timeline: ${r.impactTimeline}`}{r.impactCost && ` · Cost: ${r.impactCost}`}</p>
              <p>{r.reply}</p>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Updates({ list }: { list: any[] }) {
  if (!list.length) return null;
  return <section className="mt-6"><h2 className="mb-2 font-semibold">Progress</h2>{list.map((u) => <p key={u.id} className="border-t py-2 text-sm"><span className="text-slate-500">{fmtDate(u.publishedAt)}</span> {u.text}</p>)}</section>;
}

function DeliverableView({ token, v, color, reload }: any) {
  const d = v.deliverable;
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<{ approverName: string; approvedAt: string } | null>(d.approval);

  async function approve() {
    setBusy(true); setErr('');
    try { const r = await capi(token, '/approve', 'POST', { name, version: d.version }); setDone(r.approval); await reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  if (asking) return <><RequestForm token={token} color={color} allowed={TYPES} title="Request changes" onDone={() => { setAsking(false); void reload(); }} /><button className="mt-3 w-full text-sm text-slate-500 underline" onClick={() => setAsking(false)}>Back</button></>;

  return (
    <>
      <h1 className="text-xl font-semibold">{d.title}</h1>
      <span className="mt-2 inline-block rounded-full border px-3 py-1 text-sm" style={{ borderColor: color }}>{STATUS[d.status] ?? d.status}</span>
      <p className="mt-2 text-sm text-slate-500">Version {d.version}{d.sharedAt && `, shared ${fmtDate(d.sharedAt)}`}</p>
      {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block rounded-xl border p-3 text-sm"><b>{d.fileName}</b><br /><span className="text-slate-500">Opens in a new tab</span></a>}
      {d.description && <p className="mt-3 whitespace-pre-wrap text-sm">{d.description}</p>}

      {d.status === 'APPROVED' || done ? (
        <div className="mt-5 rounded-xl border border-green-600 bg-green-50 p-4 text-sm">
          <p className="font-semibold">Approved</p>
          <p>{(done ?? d.approval)?.approverName ?? 'Approved'}{(done ?? d.approval)?.approvedAt && `, ${fmtDateTime((done ?? d.approval).approvedAt)}`}</p>
        </div>
      ) : d.status === 'CHANGES_REQUESTED' ? (
        <p className="mt-5 rounded-xl border border-amber-500 bg-amber-50 p-4 text-sm">Your change request was sent. The agency will share a new version for approval.</p>
      ) : (
        <div className="mt-5">
          <label className="block text-sm text-slate-600">Type your name to approve
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
          <button disabled={busy || name.trim().length < 2} onClick={approve} className="mt-3 w-full rounded-xl border-2 bg-blue-50 py-3 font-medium disabled:opacity-50" style={{ borderColor: color }}>Approve</button>
          <button onClick={() => setAsking(true)} className="mt-2 w-full rounded-xl border py-3 font-medium">Request changes</button>
        </div>
      )}
      <Requests list={v.requests} />
      <Updates list={v.updates} />
    </>
  );
}

function HomeView({ token, v, color, reload }: any) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <p className="text-sm text-slate-500">Hi {v.contact.name}</p>
      <h1 className="text-xl font-semibold">{v.project.name}</h1>
      <Updates list={v.updates} />
      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Deliverables</h2>
        {v.deliverables.length === 0 && <p className="text-sm text-slate-500">Nothing has been shared yet.</p>}
        {v.deliverables.map((d: any) => <div key={d.id} className="flex items-center justify-between border-t py-2 text-sm">{d.title}<span className="text-slate-500">{STATUS[d.status]}</span></div>)}
        <p className="mt-1 text-xs text-slate-500">To approve something, use the button in the email we sent you for it.</p>
      </section>
      <Requests list={v.requests} />
      <div className="mt-6">
        {asking ? <RequestForm token={token} color={color} allowed={[TYPES[2], TYPES[1]]} title="Send a request" onDone={() => { setAsking(false); void reload(); }} /> : <button onClick={() => setAsking(true)} className="w-full rounded-xl border-2 py-3 font-medium" style={{ borderColor: color }}>Ask a question or request a document</button>}
      </div>
    </>
  );
}
