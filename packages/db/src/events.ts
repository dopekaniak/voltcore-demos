import type { Prisma } from '@prisma/client';
import type { Tx } from './index';
import { enqueue } from './outbox';

/** Fan a developer event out to the owner's active webhook endpoints that subscribe to it. */
export async function emitUserEvent(tx: Tx, ownerId: string, event: string, data: Prisma.InputJsonValue): Promise<number> {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { ownerId, status: 'ACTIVE', events: { has: event } } });
  for (const ep of endpoints) {
    const d = await tx.webhookDelivery.create({
      data: { endpointId: ep.id, event, payload: { type: event, created: Math.floor(Date.now() / 1000), data } },
    });
    await enqueue(tx, 'webhook-delivery', d.id, { deliveryId: d.id });
  }
  return endpoints.length;
}
