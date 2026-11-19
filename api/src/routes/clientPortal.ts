import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { parse, magic, must } from '../lib/http';
import { logoUrl, signedFileUrl } from '../lib/supabase';
import { audit } from '../services/audit';
import { brandOf, templates, sendEmail } from '../services/email';

/** Everything under /api/c. Mounted behind requireMagicLink. Only selects fields a client may see. */
const r = Router();

const requestView = {
  id: true, type: true, text: true, status: true, decision: true, reply: true,
  impactTimeline: true, impactCost: true, createdAt: true, repliedAt: true,
  deliverable: { select: { title: true } },
} satisfies Prisma.RequestSelect;

async function loadScopedDeliverable(m: ReturnType<typeof magic>) {
  if (m.link.scope !== 'DELIVERABLE' || !m.link.deliverableId) throw new HttpError(403, 'This link is for a different page');
  // id + workspace + client together: a link can never reach another deliverable.
  return must(await prisma.deliverable.findFirst({
    where: { id: m.link.deliverableId, workspaceId: m.workspace.id, project: { clientId: m.client.id }, status: { not: 'DRAFT' } },
  }));
}

r.get('/view', async (req, res) => {
  const m = magic(req);
  const branding = { name: m.workspace.name, logoUrl: logoUrl(m.workspace.logoPath), color: brandOf(m.workspace).color };
  const base = { branding, contact: { name: m.contact.name }, scope: m.link.scope };

  if (m.link.scope === 'DELIVERABLE') {
    const d = await loadScopedDeliverable(m);
    const [version, approval, updates, requests] = await Promise.all([
      prisma.deliverableVersion.findFirst({ where: { deliverableId: d.id, version: d.currentVersion } }),
      prisma.approval.findFirst({ where: { deliverableId: d.id, version: d.currentVersion }, select: { approverName: true, approvedAt: true } }),
      prisma.progressUpdate.findMany({ where: { projectId: d.projectId, workspaceId: m.workspace.id, publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, take: 10, select: { id: true, text: true, publishedAt: true } }),
      prisma.request.findMany({ where: { deliverableId: d.id, clientId: m.client.id, workspaceId: m.workspace.id }, orderBy: { createdAt: 'desc' }, select: requestView }),
    ]);
    return void res.json({
      ...base,
      deliverable: {
        id: d.id, title: d.title, description: d.description, status: d.status, version: d.currentVersion, sharedAt: d.sharedAt,
        fileName: version?.fileName ?? null, fileUrl: version ? await signedFileUrl(version.filePath, 300) : null,
        approval,
      },
      updates, requests,
    });
  }

  const project = must(await prisma.project.findFirst({ where: { id: m.link.projectId!, workspaceId: m.workspace.id, clientId: m.client.id } }));
  const [updates, deliverables, requests] = await Promise.all([
    prisma.progressUpdate.findMany({ where: { projectId: project.id, workspaceId: m.workspace.id, publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { id: true, text: true, publishedAt: true } }),
    prisma.deliverable.findMany({ where: { projectId: project.id, workspaceId: m.workspace.id, status: { not: 'DRAFT' } }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, currentVersion: true } }),
    prisma.request.findMany({ where: { clientId: m.client.id, workspaceId: m.workspace.id }, orderBy: { createdAt: 'desc' }, select: requestView }),
  ]);
  res.json({ ...base, project: { name: project.name }, updates, deliverables, requests });
});

r.get('/files/:versionId', async (req, res) => {
  const m = magic(req);
  const d = await loadScopedDeliverable(m);
  const v = must(await prisma.deliverableVersion.findFirst({ where: { id: req.params.versionId, deliverableId: d.id } }));
  const url = await signedFileUrl(v.filePath, 120);
  if (!url) throw new HttpError(404, 'File not found');
  res.json({ url });
});

r.post('/approve', async (req, res) => {
  const m = magic(req);
  const b = parse(z.object({ name: z.string().trim().min(2).max(100), version: z.number().int().positive() }), req.body);
  const d = await loadScopedDeliverable(m);

  const existing = () => prisma.approval.findFirst({ where: { deliverableId: d.id, version: b.version }, select: { approverName: true, approvedAt: true, version: true } });
  // Double-tap safety: a second approval for the same version returns the existing record.
  const already = await existing();
  if (already) return void res.json({ approval: already, alreadyApproved: true });

  try {
    const approval = await prisma.$transaction(async (tx) => {
      const fresh = await tx.deliverable.findUniqueOrThrow({ where: { id: d.id } });
      if (fresh.status !== 'SHARED') throw new HttpError(409, 'This deliverable is not waiting for approval');
      if (fresh.currentVersion !== b.version) throw new HttpError(409, 'A newer version exists. Please reload the page.');
      const a = await tx.approval.create({
        data: { workspaceId: m.workspace.id, deliverableId: d.id, version: b.version, approverName: b.name, contactId: m.contact.id },
        select: { approverName: true, approvedAt: true, version: true },
      });
      await tx.deliverable.update({ where: { id: d.id }, data: { status: 'APPROVED' } });
      await audit(tx, { workspaceId: m.workspace.id, clientId: m.client.id, actorType: 'CLIENT', actorId: m.contact.id, actorName: b.name, action: 'deliverable.approved', entityType: 'deliverable', entityId: d.id, details: `${b.name} approved version ${b.version}` });
      return a;
    });
    // Notify the client's assigned owner after the commit; failures never block the approval.
    const owner = m.client.ownerId ? await prisma.user.findUnique({ where: { id: m.client.ownerId } }) : null;
    if (owner) sendEmail({ to: owner.email, workspaceId: m.workspace.id, ...templates.approvedStaff(brandOf(m.workspace), { who: b.name, title: d.title, version: b.version, client: m.client.company }) });
    res.json({ approval, alreadyApproved: false });
  } catch (e) {
    // Lost a race with a concurrent approval of the same version: return the stored record.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const a = await existing();
      if (a) return void res.json({ approval: a, alreadyApproved: true });
    }
    throw e;
  }
});

r.get('/requests', async (req, res) => {
  const m = magic(req);
  res.json(await prisma.request.findMany({ where: { clientId: m.client.id, workspaceId: m.workspace.id }, orderBy: { createdAt: 'desc' }, select: requestView }));
});

r.post('/requests', async (req, res) => {
  const m = magic(req);
  const b = parse(z.object({ type: z.enum(['CHANGE', 'DOCUMENT', 'QUESTION']), text: z.string().trim().min(3).max(4000) }), req.body);
  // A deliverable-scoped link always targets its own deliverable; project links have no deliverable target.
  const target = m.link.scope === 'DELIVERABLE' ? await loadScopedDeliverable(m) : null;
  const q = await prisma.$transaction(async (tx) => {
    const created = await tx.request.create({
      data: {
        workspaceId: m.workspace.id, clientId: m.client.id, deliverableId: target?.id ?? null,
        contactId: m.contact.id, contactName: m.contact.name, type: b.type, text: b.text, ownerId: m.client.ownerId,
      },
    });
    // Same transaction, so the request and the deliverable status can never disagree.
    if (b.type === 'CHANGE' && target) {
      await tx.deliverable.updateMany({ where: { id: target.id, status: 'SHARED' }, data: { status: 'CHANGES_REQUESTED' } });
    }
    await audit(tx, { workspaceId: m.workspace.id, clientId: m.client.id, actorType: 'CLIENT', actorId: m.contact.id, actorName: m.contact.name, action: 'request.submitted', entityType: 'request', entityId: created.id, details: `${b.type.toLowerCase()}${target ? ` on ${target.title}` : ''}` });
    return created;
  });
  const owner = m.client.ownerId ? await prisma.user.findUnique({ where: { id: m.client.ownerId } }) : null;
  if (owner) sendEmail({ to: owner.email, workspaceId: m.workspace.id, ...templates.requestStaff(brandOf(m.workspace), { who: m.contact.name, client: m.client.company, type: b.type, text: b.text, title: target?.title }) });
  res.status(201).json({ id: q.id });
});

export default r;
