import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, useLoad } from '../../lib/useLoad';
import { Btn, Card, Empty, ErrorText, Pill, inputCls } from '../../components/ui';

const TYPE: Record<string, string> = { CHANGE: 'Change request', DOCUMENT: 'Document request', QUESTION: 'Question' };

export default function RequestsPage() {
  const { data, error, reload } = useLoad(() => api<any[]>('/api/requests'), []);
  const members = useLoad(() => api<any[]>('/api/workspace/members'), []);
  const [sel, setSel] = useState<string | null>(null);
  const req = data?.find((r) => r.id === sel);

  return (
    <div className="grid max-w-6xl gap-4 md:grid-cols-[360px_1fr]">
      <div>
        <h1 className="mb-3 text-xl font-semibold">Requests</h1>
        <ErrorText text={error} />
        {(['OPEN', 'ANSWERED', 'CLOSED'] as const).map((s) => {
          const rows = data?.filter((r) => r.status === s) ?? [];
          return (
            <div key={s} className="mb-4">
              <h2 className="mb-1 text-sm font-medium text-slate-600">{s === 'OPEN' ? 'Open' : s === 'ANSWERED' ? 'Answered' : 'Closed'} ({rows.length})</h2>
              {rows.length === 0 && <Empty text="None." />}
              {rows.map((r) => (
                <button key={r.id} onClick={() => setSel(r.id)} className={`mb-1 block w-full rounded-lg border bg-white p-3 text-left text-sm ${sel === r.id ? 'border-blue-500' : 'border-slate-200'}`}>
                  <div className="font-medium">{TYPE[r.type]}, {r.client.company}</div>
                  <div className="truncate text-slate-500">{r.text}</div>
                  <div className="text-xs text-slate-400">{fmtDate(r.createdAt)} · {r.owner?.name ?? 'Unassigned'}</div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div>{req ? <Detail key={req.id} r={req} members={members.data ?? []} done={reload} /> : <Card><Empty text="Select a request to read and reply." /></Card>}</div>
    </div>
  );
}

function Detail({ r, members, done }: { r: any; members: any[]; done: () => void }) {
  const [reply, setReply] = useState(''); const [timeline, setTimeline] = useState(''); const [cost, setCost] = useState('');
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); done(); } catch (e: any) { setErr(e.message); } };
  const send = (decision: 'AGREE' | 'DECLINE') => act(() => api(`/api/requests/${r.id}/reply`, 'POST', { reply, decision, ...(r.type === 'CHANGE' ? { impactTimeline: timeline, impactCost: cost } : {}) }));

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between"><h2 className="font-medium">{TYPE[r.type]}</h2><Pill status={r.status} /></div>
      <p className="mb-3 text-sm text-slate-500">From {r.contactName}, <Link className="underline" to={`/app/clients/${r.client.id}`}>{r.client.company}</Link>, {fmtDate(r.createdAt)}{r.deliverable && <> · <Link className="underline" to={`/app/deliverables/${r.deliverable.id}`}>{r.deliverable.title}</Link></>}</p>
      <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm">{r.text}</p>
      <div className="mb-4 text-sm">Owner: <select className="rounded border px-2 py-1" value={r.ownerId ?? ''} onChange={(e) => act(() => api(`/api/requests/${r.id}`, 'PATCH', { ownerId: e.target.value }))}><option value="" disabled>Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <ErrorText text={err} />

      {r.status === 'OPEN' ? (
        <>
          {r.type === 'CHANGE' && (
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <label>Timeline impact<input className={inputCls} placeholder="+2 days" value={timeline} onChange={(e) => setTimeline(e.target.value)} /></label>
              <label>Cost impact<input className={inputCls} placeholder="No extra cost" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
            </div>
          )}
          <label className="text-sm">Your reply<textarea className={inputCls} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
          <div className="mt-3 flex items-center gap-2">
            <Btn primary disabled={!reply.trim()} onClick={() => send('AGREE')}>Agree and send reply</Btn>
            <Btn disabled={!reply.trim()} onClick={() => send('DECLINE')}>Decline and send reply</Btn>
          </div>
          <p className="mt-2 text-xs text-slate-500">The reply is emailed to the client. A request gets one reply.</p>
        </>
      ) : (
        <div className="text-sm">
          <p><b>{r.decision === 'AGREE' ? 'Agreed' : 'Declined'}</b>{r.impactTimeline && ` · Timeline ${r.impactTimeline}`}{r.impactCost && ` · Cost ${r.impactCost}`}</p>
          <p className="mt-1">{r.reply}</p>
          {r.status === 'ANSWERED' && <><p className="mt-3 text-xs text-slate-500">If you agreed to a change, upload a new version and share it again.</p><Btn className="mt-2" onClick={() => act(() => api(`/api/requests/${r.id}/close`, 'POST'))}>Mark closed</Btn></>}
        </div>
      )}
    </Card>
  );
}
