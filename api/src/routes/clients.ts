import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { parse, staff, must } from '../lib/http';
import { audit } from '../services/audit';
import { createLink } from '../services/links';
import { sendDigestForClient } from '../services/digest';

const r = Router();

const text = (max: number) => z.string().trim().max(max);
const clientCreate = z.object({
  company: z.string().trim().min(1).max(120),
  website: text(200).optional(),
  industry: text(80).optional(),
  ownerId: z.string().uuid().optional(),
});
const clientPatch = clientCreate.partial().extend({
  internalNotes: z.string().max(10_000).nullable().optional(),
  digestEnabled: z.boolean().optional(),
});
const contactIn = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
});

// Every lookup uses id AND workspace together. Another workspace's record behaves as if it does not exist.
const findClient = async (ws: string, id: string) =>
  must(await prisma.client.findFirst({ where: { id, workspaceId: ws } }));

async function assertOwner(ws: string, ownerId?: string) {
  if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, workspaceId: ws } }))) {
    throw new HttpError(400, 'Owner must be a teammate in this workspace');
  }
}

r.get('/clients', async (req, res) => {
  const { workspace } = staff(req);
  const q = String(req.query.q ?? '').trim();
  const [clients, open, reqs] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId: workspace.id, ...(q ? { company: { contains: q, mode: 'insensitive' } } : {}) },
      select: { id: true, company: true, status: true, owner: { select: { name: true } } },
      orderBy: { company: 'asc' },
    }),
    prisma.deliverable.findMany({
      where: { workspaceId: workspace.id, status: { in: ['SHARED', 'CHANGES_REQUESTED'] } },
      select: { status: true, project: { select: { clientId: true } } },
    }),
    prisma.request.groupBy({ by: ['clientId'], where: { workspaceId: workspace.id, status: 'OPEN' }, _count: { _all: true } }),
  ]);
  const pending = new Map<string, number>();
  let changes = 0;
  for (const d of open) {
    if (d.status === 'SHARED') pending.set(d.project.clientId, (pending.get(d.project.clientId) ?? 0) + 1);
    else changes++;
  }
  const openReq = new Map(reqs.map((x) => [x.clientId, x._count._all]));
  res.json({
    summary: {
      awaitingApproval: [...pending.values()].reduce((a, b) => a + b, 0),
      openRequests: [...openReq.values()].reduce((a, b) => a + b, 0),
      changesRequested: changes,
    },
    clients: clients.map((c) => ({
      id: c.id, company: c.company, status: c.status, ownerName: c.owner?.name ?? null,
      pendingApprovals: pending.get(c.id) ?? 0, openRequests: openReq.get(c.id) ?? 0,
    })),
  });
});

r.post('/clients', async (req, res) => {
  const { workspace, user } = staff(req);
  const b = parse(clientCreate, req.body);
  await assertOwner(workspace.id, b.ownerId);
  const client = await prisma.$transaction(async (tx) => {
    const c = await tx.client.create({ data: { ...b, workspaceId: workspace.id, ownerId: b.ownerId ?? user.id } });
    await audit(tx, { workspaceId: workspace.id, clientId: c.id, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'client.created', entityType: 'client', entityId: c.id, details: c.company });
    return c;
  });
  res.status(201).json(client);
});

r.get('/clients/:id', async (req, res) => {
  const { workspace } = staff(req);
  const client = must(
    await prisma.client.findFirst({
      where: { id: req.params.id, workspaceId: workspace.id },
      include: {
        owner: { select: { id: true, name: true } },
        contacts: { orderBy: { createdAt: 'asc' } },
        projects: { orderBy: { createdAt: 'desc' }, select: { id: true, name: true, status: true } },
      },
    }),
  );
  const [waiting, openRequests, history] = await Promise.all([
    prisma.deliverable.findMany({
      where: { workspaceId: workspace.id, status: { in: ['SHARED', 'CHANGES_REQUESTED'] }, project: { clientId: client.id } },
      select: { id: true, title: true, status: true, currentVersion: true },
    }),
    prisma.request.count({ where: { workspaceId: workspace.id, clientId: client.id, status: 'OPEN' } }),
    prisma.auditLog.findMany({
      where: { workspaceId: workspace.id, clientId: client.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, actorType: true, actorName: true, details: true, createdAt: true },
    }),
  ]);
  res.json({ ...client, counts: { pendingApprovals: waiting.filter((d) => d.status === 'SHARED').length, openRequests }, waiting, history });
});

r.patch('/clients/:id', async (req, res) => {
  const { workspace, user } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  const b = parse(clientPatch, req.body);
  await assertOwner(workspace.id, b.ownerId);
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.client.update({ where: { id: client.id }, data: b });
    const what = Object.keys(b).filter((k) => k !== 'internalNotes').join(', ') || 'notes';
    await audit(tx, { workspaceId: workspace.id, clientId: client.id, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'client.updated', entityType: 'client', entityId: client.id, details: what });
    return c;
  });
  res.json(updated);
});

r.post('/clients/:id/archive', async (req, res) => {
  const { workspace, user } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: client.id }, data: { status: 'ARCHIVED' } });
    // Archiving also kills any live links for this client.
    await tx.magicLink.updateMany({ where: { clientId: client.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { workspaceId: workspace.id, clientId: client.id, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'client.archived', entityType: 'client', entityId: client.id, details: client.company });
  });
  res.json({ ok: true });
});

/* ---------- contacts ---------- */
r.post('/clients/:id/contacts', async (req, res) => {
  const { workspace } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  const b = parse(contactIn, req.body);
  const contact = await prisma.contact.create({ data: { ...b, clientId: client.id, workspaceId: workspace.id } });
  res.status(201).json(contact);
});

r.patch('/contacts/:id', async (req, res) => {
  const { workspace } = staff(req);
  const c = must(await prisma.contact.findFirst({ where: { id: req.params.id, workspaceId: workspace.id } }));
  res.json(await prisma.contact.update({ where: { id: c.id }, data: parse(contactIn.partial(), req.body) }));
});

r.delete('/contacts/:id', async (req, res) => {
  const { workspace } = staff(req);
  const c = must(await prisma.contact.findFirst({ where: { id: req.params.id, workspaceId: workspace.id } }));
  await prisma.contact.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

/* ---------- projects (create) ---------- */
r.get('/clients/:id/projects', async (req, res) => {
  const { workspace } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  res.json(await prisma.project.findMany({ where: { workspaceId: workspace.id, clientId: client.id }, orderBy: { createdAt: 'desc' } }));
});

r.post('/clients/:id/projects', async (req, res) => {
  const { workspace, user } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  if (client.status === 'ARCHIVED') throw new HttpError(409, 'This client is archived');
  const b = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({ data: { name: b.name, clientId: client.id, workspaceId: workspace.id } });
    await audit(tx, { workspaceId: workspace.id, clientId: client.id, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'project.created', entityType: 'project', entityId: p.id, details: p.name });
    return p;
  });
  res.status(201).json(project);
});

/* ---------- magic links (staff side) ---------- */
r.get('/clients/:id/links', async (req, res) => {
  const { workspace } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  const links = await prisma.magicLink.findMany({
    where: { workspaceId: workspace.id, clientId: client.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, scope: true, expiresAt: true, revokedAt: true, usedAt: true, createdAt: true, contact: { select: { name: true } } },
  });
  res.json(links);
});

r.post('/clients/:id/links', async (req, res) => {
  const { workspace, user } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  if (client.status === 'ARCHIVED') throw new HttpError(409, 'This client is archived');
  const b = parse(
    z.object({ contactId: z.string().uuid(), scope: z.enum(['DELIVERABLE', 'PROJECT']), deliverableId: z.string().uuid().optional(), projectId: z.string().uuid().optional() })
      .refine((v) => (v.scope === 'DELIVERABLE' ? !!v.deliverableId : !!v.projectId), 'Scope needs a deliverable or project'),
    req.body,
  );
  const contact = must(await prisma.contact.findFirst({ where: { id: b.contactId, clientId: client.id, workspaceId: workspace.id } }));
  if (b.deliverableId) must(await prisma.deliverable.findFirst({ where: { id: b.deliverableId, workspaceId: workspace.id, project: { clientId: client.id } } }));
  if (b.projectId) must(await prisma.project.findFirst({ where: { id: b.projectId, workspaceId: workspace.id, clientId: client.id } }));
  const link = await prisma.$transaction((tx) =>
    createLink(tx, {
      workspaceId: workspace.id, clientId: client.id, contactId: contact.id, contactName: contact.name,
      scope: b.scope, deliverableId: b.deliverableId, projectId: b.projectId, actor: { type: 'STAFF', id: user.id, name: user.name },
    }),
  );
  res.status(201).json(link);
});

r.post('/links/:id/revoke', async (req, res) => {
  const { workspace, user } = staff(req);
  const link = must(await prisma.magicLink.findFirst({ where: { id: req.params.id, workspaceId: workspace.id }, include: { contact: true } }));
  await prisma.$transaction(async (tx) => {
    await tx.magicLink.update({ where: { id: link.id }, data: { revokedAt: link.revokedAt ?? new Date() } });
    await audit(tx, { workspaceId: workspace.id, clientId: link.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'link.revoked', entityType: 'magic_link', entityId: link.id, details: `${link.contact.name}, ${link.scope.toLowerCase()} scope` });
  });
  res.json({ ok: true });
});

/* ---------- digest ---------- */
r.post('/clients/:id/digest/preview', async (req, res) => {
  const { workspace, user } = staff(req);
  const client = await findClient(workspace.id, req.params.id);
  res.json(await sendDigestForClient(client.id, { previewTo: user.email }));
});

export default r;
