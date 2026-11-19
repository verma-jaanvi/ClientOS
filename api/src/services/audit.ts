import type { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export type AuditInput = {
  workspaceId: string;
  clientId?: string | null;
  actorType: 'STAFF' | 'CLIENT' | 'SYSTEM';
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
};

/** Always call with the transaction handle of the action being logged. */
export const audit = (tx: Tx, e: AuditInput) =>
  tx.auditLog.create({ data: { ...e, details: e.details ?? '' } });
