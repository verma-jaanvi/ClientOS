import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { parse, staff, must } from '../lib/http';
import { audit } from '../services/audit';

const r = Router();

const findProject = async (ws: string, id: string) =>
  must(await prisma.project.findFirst({ where: { id, workspaceId: ws } }));

r.get('/projects/:id', async (req, res) => {
  const { workspace } = staff(req);
  const project = must(
    await prisma.project.findFirst({
      where: { id: req.params.id, workspaceId: workspace.id },
      include: {
        client: { select: { id: true, company: true } },
        milestones: { orderBy: { dueDate: 'asc' } },
        deliverables: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, currentVersion: true, milestoneId: true } },
        updates: { where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' } },
      },
    }),
  );
  res.json(project);
});

r.patch('/projects/:id', async (req, res) => {
  const { workspace } = staff(req);
  const p = await findProject(workspace.id, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED']).optional() }), req.body);
  res.json(await prisma.project.update({ where: { id: p.id }, data: b }));
});

/* milestones */
const milestoneIn = z.object({ title: z.string().trim().min(1).max(120), dueDate: z.coerce.date() });

r.post('/projects/:id/milestones', async (req, res) => {
  const { workspace } = staff(req);
  const p = await findProject(workspace.id, req.params.id);
  const b = parse(milestoneIn, req.body);
  res.status(201).json(await prisma.milestone.create({ data: { ...b, projectId: p.id, workspaceId: workspace.id } }));
});

r.patch('/milestones/:id', async (req, res) => {
  const { workspace } = staff(req);
  const m = must(await prisma.milestone.findFirst({ where: { id: req.params.id, workspaceId: workspace.id } }));
  res.json(await prisma.milestone.update({ where: { id: m.id }, data: parse(milestoneIn.partial(), req.body) }));
});

/* deliverables (create) */
r.post('/projects/:id/deliverables', async (req, res) => {
  const { workspace, user } = staff(req);
  const p = await findProject(workspace.id, req.params.id);
  const b = parse(
    z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(5000).default(''), milestoneId: z.string().uuid().optional() }),
    req.body,
  );
  if (b.milestoneId) must(await prisma.milestone.findFirst({ where: { id: b.milestoneId, projectId: p.id, workspaceId: workspace.id } }), 'Milestone not found');
  const d = await prisma.$transaction(async (tx) => {
    const created = await tx.deliverable.create({ data: { ...b, projectId: p.id, workspaceId: workspace.id } });
    await audit(tx, { workspaceId: workspace.id, clientId: p.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'deliverable.created', entityType: 'deliverable', entityId: created.id, details: created.title });
    return created;
  });
  res.status(201).json(d);
});

/* progress updates: clients only ever see published ones */
r.get('/projects/:id/updates', async (req, res) => {
  const { workspace } = staff(req);
  const p = await findProject(workspace.id, req.params.id);
  res.json(await prisma.progressUpdate.findMany({ where: { projectId: p.id, workspaceId: workspace.id }, orderBy: { createdAt: 'desc' } }));
});

r.post('/projects/:id/updates', async (req, res) => {
  const { workspace, user } = staff(req);
  const p = await findProject(workspace.id, req.params.id);
  const b = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
  const u = await prisma.$transaction(async (tx) => {
    const created = await tx.progressUpdate.create({ data: { text: b.text, projectId: p.id, workspaceId: workspace.id, publishedAt: new Date() } });
    await audit(tx, { workspaceId: workspace.id, clientId: p.clientId, actorType: 'STAFF', actorId: user.id, actorName: user.name, action: 'update.published', entityType: 'progress_update', entityId: created.id, details: b.text.slice(0, 120) });
    return created;
  });
  res.status(201).json(u);
});

export default r;
export { HttpError };
