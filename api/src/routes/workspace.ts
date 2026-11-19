import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { supabase, logoUrl, safeFileName } from '../lib/supabase';
import { HttpError } from '../lib/errors';
import { parse, staff, requireAdmin, must } from '../lib/http';
import { newToken, hashToken } from '../lib/tokens';
import { audit } from '../services/audit';
import { brandOf, templates, sendEmail } from '../services/email';

const r = Router();

const present = (w: { id: string; name: string; logoPath: string | null; brandColor: string }) => ({
  id: w.id, name: w.name, brandColor: w.brandColor, logoUrl: logoUrl(w.logoPath),
});

r.get('/me', (req, res) => {
  const { user, workspace } = staff(req);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, workspace: present(workspace) });
});

r.patch('/workspace', requireAdmin, async (req, res) => {
  const { workspace } = staff(req);
  const b = parse(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoPath: z.string().max(300).nullable().optional(),
    }),
    req.body,
  );
  if (b.logoPath && !b.logoPath.startsWith(`${workspace.id}/logo/`)) throw new HttpError(400, 'Invalid logo path');
  const updated = await prisma.workspace.update({ where: { id: workspace.id }, data: b });
  res.json(present(updated));
});

// Logos live in a separate PUBLIC bucket (they are branding, shown in emails). Deliverables stay private.
r.post('/workspace/logo-upload-url', requireAdmin, async (req, res) => {
  const { workspace } = staff(req);
  const b = parse(z.object({ fileName: z.string().min(1).max(200) }), req.body);
  const path = `${workspace.id}/logo/${crypto.randomUUID()}-${safeFileName(b.fileName)}`;
  const { data, error } = await supabase.storage.from(env.LOGOS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(502, 'Could not create an upload permission');
  res.json({ path, token: data.token, bucket: env.LOGOS_BUCKET });
});

r.get('/workspace/members', async (req, res) => {
  const { workspace } = staff(req);
  const members = await prisma.user.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members);
});

r.post('/workspace/invites', requireAdmin, async (req, res) => {
  const { workspace, user } = staff(req);
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req.body);
  if (await prisma.user.findFirst({ where: { email: b.email } })) throw new HttpError(409, 'That person already has an account');
  const token = newToken();
  await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.create({
      data: { workspaceId: workspace.id, email: b.email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    await audit(tx, {
      workspaceId: workspace.id, actorType: 'STAFF', actorId: user.id, actorName: user.name,
      action: 'member.invited', entityType: 'invite', entityId: invite.id, details: b.email,
    });
  });
  const mail = templates.invite(brandOf(workspace), { url: `${env.APP_URL}/join?token=${token}` });
  sendEmail({ to: b.email, workspaceId: workspace.id, ...mail });
  res.status(201).json({ ok: true });
});

r.delete('/workspace/members/:id', requireAdmin, async (req, res) => {
  const { workspace, user } = staff(req);
  const target = must(await prisma.user.findFirst({ where: { id: req.params.id, workspaceId: workspace.id } }));
  if (target.id === user.id) throw new HttpError(400, 'You cannot remove yourself');
  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: target.id } });
    await audit(tx, {
      workspaceId: workspace.id, actorType: 'STAFF', actorId: user.id, actorName: user.name,
      action: 'member.removed', entityType: 'user', entityId: target.id, details: target.email,
    });
  });
  try {
    await supabase.auth.admin.deleteUser(target.authId);
  } catch {
    /* login cleanup is best effort; the users row is already gone so access is revoked */
  }
  res.json({ ok: true });
});

export default r;
