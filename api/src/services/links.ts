import { env } from '../env';
import { newToken, hashToken } from '../lib/tokens';
import { audit, Tx } from './audit';
import type { LinkScope } from '@prisma/client';

export const linkUrl = (token: string) => `${env.APP_URL}/c/${token}`;

type Actor = { type: 'STAFF' | 'SYSTEM'; id?: string; name?: string };

/** Creates a magic link and returns the one-time URL. Only the hash is stored. */
export async function createLink(
  tx: Tx,
  a: {
    workspaceId: string;
    clientId: string;
    contactId: string;
    contactName: string;
    scope: LinkScope;
    deliverableId?: string;
    projectId?: string;
    actor: Actor;
  },
) {
  const token = newToken();
  const link = await tx.magicLink.create({
    data: {
      workspaceId: a.workspaceId,
      clientId: a.clientId,
      contactId: a.contactId,
      scope: a.scope,
      deliverableId: a.scope === 'DELIVERABLE' ? a.deliverableId : null,
      projectId: a.scope === 'PROJECT' ? a.projectId : null,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.LINK_TTL_DAYS * 86_400_000),
    },
  });
  await audit(tx, {
    workspaceId: a.workspaceId,
    clientId: a.clientId,
    actorType: a.actor.type,
    actorId: a.actor.id,
    actorName: a.actor.name,
    action: 'link.created',
    entityType: 'magic_link',
    entityId: link.id,
    details: `${a.contactName}, ${a.scope.toLowerCase()} scope`,
  });
  return { id: link.id, url: linkUrl(token) };
}
