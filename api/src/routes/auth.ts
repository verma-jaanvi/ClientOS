import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { supabase } from '../lib/supabase';
import { HttpError } from '../lib/errors';
import { parse, must } from '../lib/http';
import { hashToken } from '../lib/tokens';
import { audit } from '../services/audit';

const r = Router();

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8).max(72);

async function createLogin(addr: string, pw: string) {
  const { data, error } = await supabase.auth.admin.createUser({ email: addr, password: pw, email_confirm: true });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? '');
    throw new HttpError(taken ? 409 : 400, taken ? 'An account with this email already exists' : 'Could not create the login');
  }
  return data.user.id;
}
async function rollbackLogin(id: string) {
  try {
    await supabase.auth.admin.deleteUser(id);
  } catch {
    /* nothing more we can do */
  }
}

// Creates login + workspace + admin user. The DB part is one transaction; if it fails the login is removed too.
r.post('/signup', async (req, res) => {
  const b = parse(z.object({ agencyName: z.string().trim().min(2).max(80), email, password }), req.body);
  const authId = await createLogin(b.email, b.password);
  try {
    await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: b.agencyName } });
      const user = await tx.user.create({
        data: { workspaceId: workspace.id, authId, email: b.email, name: b.email.split('@')[0], role: 'ADMIN' },
      });
      await audit(tx, {
        workspaceId: workspace.id, actorType: 'STAFF', actorId: user.id, actorName: user.name,
        action: 'workspace.created', entityType: 'workspace', entityId: workspace.id, details: b.agencyName,
      });
    });
  } catch (e) {
    await rollbackLogin(authId);
    throw e;
  }
  res.status(201).json({ ok: true });
});

async function findInvite(token: string) {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { workspace: true } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) throw new HttpError(404, 'This invite is not valid');
  return invite;
}

r.get('/invite/:token', async (req, res) => {
  const invite = await findInvite(req.params.token);
  res.json({ email: invite.email, workspaceName: invite.workspace.name });
});

r.post('/accept-invite', async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20), name: z.string().trim().min(1).max(80), password }), req.body);
  const invite = await findInvite(b.token);
  const authId = await createLogin(invite.email, b.password);
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new HttpError(409, 'This invite was already used');
      const user = await tx.user.create({
        data: { workspaceId: invite.workspaceId, authId, email: invite.email, name: b.name, role: 'MEMBER' },
      });
      await audit(tx, {
        workspaceId: invite.workspaceId, actorType: 'STAFF', actorId: user.id, actorName: user.name,
        action: 'member.joined', entityType: 'user', entityId: user.id, details: invite.email,
      });
    });
  } catch (e) {
    await rollbackLogin(authId);
    throw e;
  }
  res.status(201).json({ ok: true, email: invite.email });
});

export default r;
export { must };
