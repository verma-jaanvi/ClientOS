import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { parse, staff, must } from '../lib/http';
import { audit } from '../services/audit';
import { createLink } from '../services/links';
import { brandOf, templates, sendEmail } from '../services/email';

const r = Router();

const find = async (ws: string, id: string) =>
  must(await prisma.request.findFirst({
    where: { id, workspaceId: ws },
    include: { client: { select: { id: true, company: true } }, deliverable: { select: { id: true, title: true, project: { select: { id: true } } } }, owner: { select: { id: true, name: true } } },
  }));

r.get('/requests', async (req, res) => {
  const { workspace } = staff(req);
  const status = z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional().parse(req.query.status || undefined);
  res.json(
    await prisma.request.findMany({
      where: { workspaceId: workspace.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { client: { select: { id: true, company: true } }, deliverable: { select: { id: true, title: true } }, owner: { select: { id: true, name: true } } },
    }),
  );
});

r.get('/requests/:id', async (req, res) => res.json(await find(staff(req).workspace.id, req.params.id)));

r.patch('/requests/:id', async (req, res) => {
  const { workspace } = staff(req);
  const q = await find(workspace.id, req.params.id);
  const b = parse(z.object({ ownerId: z.string().uuid() }), req.body);
  must(await prisma.user.findFirst({ where: { id: b.ownerId, workspaceId: workspace.id } }), 'Owner must be a teammate');
  res.json(await prisma.request.update({ where: { id: q.id }, data: { ownerId: b.ownerId } }));
});

r.post('/requests/:id/reply', async (req, res) => {
  const { workspace, user } = staff(req);
  const q = await find(workspace.id, req.params.id);
  const b = parse(
    z.object({
      reply: z.string().trim().min(1).max(4000),
      decision: z.enum(['AGREE', 'DECLINE']),
      impactTimeline: z.string().trim().max(120).optional(),
      impactCost: z.string().trim().max(120).optional(),
    }),
    req.body,
  );
  const impact = q.type === 'CHANGE' ? { impactTimeline: b.impactTimeline || null, impactCost: b.impactCost || null } : {};
  await prisma.$transaction(async (tx) => {
    // One reply only: the status guard makes this atomic.
    const done = await tx.request.updateMany({
      where: { id: q.id, workspaceId: workspace.id, status: 'OPEN' },
      data: { reply: b.reply, decision: b.decision, status: 'ANSWERED', repliedById: user.id, repliedAt: new Date(), ...impact },
    });
    if (done.count !== 1) throw new HttpError(409, 'This request already has a reply');
    await audit(tx, { workspaceId: workspace.id, clientId: q.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'request.answered', entityType: 'request', entityId: q.id, details: `${b.decision.toLowerCase()}${impact.impactTimeline ? `, timeline ${impact.impactTimeline}` : ''}${impact.impactCost ? `, cost ${impact.impactCost}` : ''}` });
  });

  // Email the client contact with a link to their project page (best effort, never blocks the reply).
  const contact = q.contactId ? await prisma.contact.findFirst({ where: { id: q.contactId, workspaceId: workspace.id } }) : null;
  if (contact) {
    const projectId = q.deliverable?.project.id ?? (await prisma.project.findFirst({ where: { clientId: q.clientId, workspaceId: workspace.id }, orderBy: { createdAt: 'desc' } }))?.id;
    const url = projectId
      ? (await prisma.$transaction((tx) => createLink(tx, { workspaceId: workspace.id, clientId: q.clientId, contactId: contact.id, contactName: contact.name, scope: 'PROJECT', projectId, actor: { type: 'STAFF', id: user.id, name: user.name } }))).url
      : undefined;
    sendEmail({
      to: contact.email, workspaceId: workspace.id,
      ...templates.answered(brandOf(workspace), {
        contactName: contact.name, decision: b.decision === 'AGREE' ? 'Agreed' : 'Declined', reply: b.reply,
        impact: [impact.impactTimeline ? `Timeline: ${impact.impactTimeline}` : '', impact.impactCost ? `Cost: ${impact.impactCost}` : ''].filter(Boolean) as string[],
        url,
      }),
    });
  }
  res.json({ ok: true });
});

r.post('/requests/:id/close', async (req, res) => {
  const { workspace, user } = staff(req);
  const q = await find(workspace.id, req.params.id);
  if (q.status === 'CLOSED') return void res.json({ ok: true });
  await prisma.$transaction(async (tx) => {
    await tx.request.update({ where: { id: q.id }, data: { status: 'CLOSED' } });
    await audit(tx, { workspaceId: workspace.id, clientId: q.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'request.closed', entityType: 'request', entityId: q.id, details: q.type.toLowerCase() });
  });
  res.json({ ok: true });
});

export default r;
