import type { Prisma } from '@prisma/client';
import type { Tx } from './index';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
  requestId?: string | null;
}

/** Append an audit row in the caller's transaction (append-only table). */
export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      reason: e.reason ?? null,
      ...(e.data !== undefined ? { data: e.data } : {}),
      ip: e.ip ?? null,
      requestId: e.requestId ?? null,
    },
  });
}
