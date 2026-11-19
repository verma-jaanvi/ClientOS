import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { hashToken } from '../lib/tokens';
import { HttpError } from '../lib/errors';

/**
 * Magic-link check for /api/c/*. Reads ONLY the x-magic-token header, so a staff
 * login cannot be used here. Rejects unknown, expired, revoked and archived-client links.
 */
export async function requireMagicLink(req: Request, _res: Response, next: NextFunction) {
  const raw = req.headers['x-magic-token'];
  if (typeof raw !== 'string' || raw.length < 20) throw new HttpError(401, 'Link not valid', 'LINK_INVALID');
  const link = await prisma.magicLink.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { contact: { include: { client: true } }, workspace: true },
  });
  if (
    !link ||
    link.revokedAt ||
    link.expiresAt.getTime() < Date.now() ||
    link.contact.client.status !== 'ACTIVE' ||
    link.contact.client.workspaceId !== link.workspaceId
  ) {
    throw new HttpError(401, 'This link has expired or was revoked', 'LINK_INVALID');
  }
  if (!link.usedAt) {
    await prisma.magicLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  }
  const { contact, workspace, ...plain } = link;
  const { client, ...contactOnly } = contact;
  req.magic = { link: plain, contact: contactOnly, client, workspace };
  next();
}
