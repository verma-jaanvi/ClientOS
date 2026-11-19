import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/errors';
import { parse, staff, must } from '../lib/http';
import { filesBucket, safeFileName, signedFileUrl } from '../lib/supabase';
import { audit } from '../services/audit';
import { createLink } from '../services/links';
import { brandOf, templates, sendEmail } from '../services/email';

const r = Router();

const find = async (ws: string, id: string) => must(await prisma.deliverable.findFirst({ where: { id, workspaceId: ws } }));

r.get('/deliverables/:id', async (req, res) => {
  const { workspace } = staff(req);
  const d = must(
    await prisma.deliverable.findFirst({
      where: { id: req.params.id, workspaceId: workspace.id },
      include: {
        project: { select: { id: true, name: true, client: { select: { id: true, company: true } } } },
        milestone: { select: { id: true, title: true, dueDate: true } },
        versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, fileName: true, createdAt: true } },
      },
    }),
  );
  res.json(d);
});

r.patch('/deliverables/:id', async (req, res) => {
  const { workspace, user } = staff(req);
  const d = await find(workspace.id, req.params.id);
  const b = parse(
    z.object({ title: z.string().trim().min(1).max(160).optional(), description: z.string().max(5000).optional(), milestoneId: z.string().uuid().nullable().optional() }),
    req.body,
  );
  if (b.milestoneId) {
    must(await prisma.milestone.findFirst({ where: { id: b.milestoneId, projectId: d.projectId, workspaceId: workspace.id } }), 'Milestone not found');
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: d.projectId } });
  const textChanged = (b.title !== undefined && b.title !== d.title) || (b.description !== undefined && b.description !== d.description);
  const updated = await prisma.$transaction(async (tx) => {
    let data: Record<string, unknown> = { ...b };
    // Rule: editing an approved deliverable creates a new version and puts it back to Shared.
    if (d.status === 'APPROVED' && textChanged) {
      const current = await tx.deliverableVersion.findFirst({ where: { deliverableId: d.id, version: d.currentVersion } });
      const next = d.currentVersion + 1;
      if (current) {
        await tx.deliverableVersion.create({ data: { workspaceId: workspace.id, deliverableId: d.id, version: next, filePath: current.filePath, fileName: current.fileName, createdById: user.id } });
      }
      data = { ...data, currentVersion: next, status: 'SHARED', sharedAt: new Date() };
      await audit(tx, { workspaceId: workspace.id, clientId: project.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'deliverable.reopened', entityType: 'deliverable', entityId: d.id, details: `Edited after approval; version ${next} needs approval` });
    }
    return tx.deliverable.update({ where: { id: d.id }, data });
  });
  res.json(updated);
});

// 1) browser asks for a short-lived upload permission, 2) uploads straight to private storage, 3) registers the path.
r.post('/deliverables/:id/upload-url', async (req, res) => {
  const { workspace } = staff(req);
  const d = await find(workspace.id, req.params.id);
  const b = parse(z.object({ fileName: z.string().min(1).max(200) }), req.body);
  const path = `${workspace.id}/${d.id}/${crypto.randomUUID()}-${safeFileName(b.fileName)}`;
  const { data, error } = await filesBucket().createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(502, 'Could not create an upload permission');
  res.json({ path, token: data.token, bucket: env.FILES_BUCKET });
});

r.post('/deliverables/:id/versions', async (req, res) => {
  const { workspace, user } = staff(req);
  const d = await find(workspace.id, req.params.id);
  const b = parse(z.object({ path: z.string().min(1).max(400), fileName: z.string().min(1).max(200) }), req.body);
  if (!b.path.startsWith(`${workspace.id}/${d.id}/`)) throw new HttpError(400, 'Invalid file path');
  if (!(await signedFileUrl(b.path, 10))) throw new HttpError(400, 'File was not found in storage');
  const project = await prisma.project.findUniqueOrThrow({ where: { id: d.projectId } });
  const out = await prisma.$transaction(async (tx) => {
    const fresh = await tx.deliverable.findUniqueOrThrow({ where: { id: d.id } });
    const version = fresh.currentVersion + 1; // earlier versions are kept, never overwritten
    await tx.deliverableVersion.create({ data: { workspaceId: workspace.id, deliverableId: d.id, version, filePath: b.path, fileName: b.fileName, createdById: user.id } });
    const reopen = fresh.status === 'APPROVED'; // a new version needs its own approval
    await tx.deliverable.update({ where: { id: d.id }, data: { currentVersion: version, ...(reopen ? { status: 'SHARED', sharedAt: new Date() } : {}) } });
    await audit(tx, { workspaceId: workspace.id, clientId: project.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'deliverable.version_added', entityType: 'deliverable', entityId: d.id, details: `Version ${version}: ${b.fileName}${reopen ? ' (back to Shared)' : ''}` });
    return { version };
  });
  res.status(201).json(out);
});

r.post('/deliverables/:id/share', async (req, res) => {
  const { workspace, user } = staff(req);
  const d = must(
    await prisma.deliverable.findFirst({
      where: { id: req.params.id, workspaceId: workspace.id },
      include: { project: { include: { client: { include: { contacts: true } } } } },
    }),
  );
  const client = d.project.client;
  if (d.currentVersion < 1) throw new HttpError(409, 'Upload a file before sharing');
  if (client.contacts.length === 0) throw new HttpError(409, 'Add a contact to this client before sharing');
  if (client.status !== 'ACTIVE') throw new HttpError(409, 'This client is archived');
  if (d.status === 'APPROVED') throw new HttpError(409, 'Already approved. Upload a new version to share again.');

  const links = await prisma.$transaction(async (tx) => {
    await tx.deliverable.update({ where: { id: d.id }, data: { status: 'SHARED', sharedAt: new Date() } });
    const made = [];
    for (const c of client.contacts) {
      const l = await createLink(tx, { workspaceId: workspace.id, clientId: client.id, contactId: c.id, contactName: c.name, scope: 'DELIVERABLE', deliverableId: d.id, actor: { type: 'STAFF', id: user.id, name: user.name } });
      made.push({ contact: c, url: l.url });
    }
    await audit(tx, { workspaceId: workspace.id, clientId: client.id, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'deliverable.shared', entityType: 'deliverable', entityId: d.id, details: `Version ${d.currentVersion} to ${client.contacts.map((c) => c.email).join(', ')}` });
    return made;
  });

  const brand = brandOf(workspace);
  for (const { contact, url } of links) {
    sendEmail({ to: contact.email, workspaceId: workspace.id, ...templates.shared(brand, { contactName: contact.name, title: d.title, note: d.description, url }) });
  }
  res.json({ shared: true, recipients: links.length });
});

r.get('/deliverables/:id/trail', async (req, res) => {
  const { workspace } = staff(req);
  const d = await find(workspace.id, req.params.id);
  const [versions, approvals, requests] = await Promise.all([
    prisma.deliverableVersion.findMany({ where: { deliverableId: d.id, workspaceId: workspace.id }, orderBy: { version: 'asc' } }),
    prisma.approval.findMany({ where: { deliverableId: d.id, workspaceId: workspace.id }, orderBy: { approvedAt: 'asc' } }),
    prisma.request.findMany({ where: { deliverableId: d.id, workspaceId: workspace.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  const events = [
    ...versions.map((v) => ({ at: v.createdAt, kind: 'version', version: v.version, label: `Version ${v.version} uploaded` })),
    ...approvals.map((a) => ({ at: a.approvedAt, kind: 'approval', version: a.version, label: `Approved by ${a.approverName}` })),
    ...requests.map((q) => ({ at: q.createdAt, kind: 'request', version: null, label: `${q.type.toLowerCase()} request from ${q.contactName}` })),
    ...requests.filter((q) => q.repliedAt).map((q) => ({ at: q.repliedAt!, kind: 'reply', version: null, label: `Reply: ${q.decision?.toLowerCase()}` })),
  ].sort((a, b) => +a.at - +b.at);
  res.json({ versions, approvals, requests, events });
});

r.get('/files/:versionId/download-url', async (req, res) => {
  const { workspace } = staff(req);
  const v = must(await prisma.deliverableVersion.findFirst({ where: { id: req.params.versionId, workspaceId: workspace.id } }));
  const url = await signedFileUrl(v.filePath, 60);
  if (!url) throw new HttpError(404, 'File not found');
  res.json({ url, fileName: v.fileName });
});

export default r;
