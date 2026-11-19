import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, uploadViaSignedUrl } from '../../lib/api';
import { fmtDate, useLoad } from '../../lib/useLoad';
import { Btn, Card, ErrorText, Field, Pill, inputCls } from '../../components/ui';

export default function DeliverablePage() {
  const { id } = useParams();
  const { data: d, error, reload } = useLoad(() => api(`/api/deliverables/${id}`), [id]);
  const trail = useLoad(() => api(`/api/deliverables/${id}/trail`), [id]);
  const [form, setForm] = useState<{ title: string; description: string } | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const f = form ?? { title: d.title, description: d.description };
  const refresh = async () => { setForm(null); await reload(); await trail.reload(); };
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setErr(''); setNote(''); setBusy(true);
    try { await fn(); if (ok) setNote(ok); await refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const upload = (file: File) => run(async () => {
    const perm = await api(`/api/deliverables/${id}/upload-url`, 'POST', { fileName: file.name });
    await uploadViaSignedUrl(perm, file);
    await api(`/api/deliverables/${id}/versions`, 'POST', { path: perm.path, fileName: file.name });
  });
  const download = async (versionId: string) => {
    try { const r = await api(`/api/files/${versionId}/download-url`); window.open(r.url, '_blank', 'noopener'); } catch (e: any) { setErr(e.message); }
  };
  const current = d.versions[0];
  const dirty = f.title !== d.title || f.description !== d.description;

  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-sm text-slate-500"><Link to="/app">Clients</Link> / <Link to={`/app/clients/${d.project.client.id}`}>{d.project.client.company}</Link> / <Link to={`/app/projects/${d.project.id}`}>{d.project.name}</Link></div>
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <Card>
          <Field label="Title"><input className={inputCls + ' text-lg font-semibold'} value={f.title} onChange={(e) => setForm({ ...f, title: e.target.value })} /></Field>
          <div className="mb-4 flex items-center gap-3 text-sm text-slate-600">
            <Pill status={d.status} />{d.currentVersion > 0 && <span>Version {d.currentVersion}</span>}
            {d.milestone && <span>Milestone: {d.milestone.title}, due {fmtDate(d.milestone.dueDate)}</span>}
          </div>
          <Field label="Description for the client"><textarea className={inputCls} rows={4} value={f.description} onChange={(e) => setForm({ ...f, description: e.target.value })} /></Field>
          {d.status === 'APPROVED' && dirty && <p className="mb-2 text-sm text-amber-700">Saving changes to an approved deliverable creates a new version that needs its own approval.</p>}

          <div className="mb-4 flex items-center justify-between rounded-lg border p-3 text-sm">
            <div>{current ? <><button className="font-medium underline" onClick={() => download(current.id)}>{current.fileName}</button><div className="text-slate-500">Uploaded {fmtDate(current.createdAt)}</div></> : <span className="text-slate-500">No file yet</span>}</div>
            <input ref={fileRef} type="file" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} />
            <Btn disabled={busy} onClick={() => fileRef.current?.click()}>{current ? 'Replace file' : 'Upload file'}</Btn>
          </div>

          <ErrorText text={err} />
          {note && <p className="mb-2 text-sm text-green-700">{note}</p>}
          <div className="flex gap-2">
            <Btn disabled={busy || !dirty} onClick={() => run(() => api(`/api/deliverables/${id}`, 'PATCH', f))}>Save draft</Btn>
            {d.status !== 'APPROVED' && <Btn primary disabled={busy} onClick={() => run(async () => { const r = await api(`/api/deliverables/${id}/share`, 'POST'); setNote(`Shared with ${r.recipients} contact${r.recipients > 1 ? 's' : ''}.`); })}>Share with client</Btn>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Sharing sends the client an email with a magic link.</p>

          {d.versions.length > 1 && (
            <div className="mt-5 border-t pt-3 text-sm">
              <p className="mb-1 font-medium">All versions</p>
              {d.versions.map((v: any) => <button key={v.id} onClick={() => download(v.id)} className="block underline">Version {v.version}: {v.fileName}</button>)}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-medium">Approval trail</h2>
          {trail.data?.events.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          <ol className="space-y-3 border-l pl-4">
            {trail.data?.events.map((e: any, i: number) => (
              <li key={i} className="text-sm"><span className="font-medium">{e.label}</span><div className="text-slate-500">{fmtDate(e.at)}</div></li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-500">Rows are stored as records and cannot be edited.</p>
        </Card>
      </div>
    </div>
  );
}
