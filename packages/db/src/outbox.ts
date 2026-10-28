import type { Prisma } from '@prisma/client';
import type { Tx } from './index';

/** Queue topics. Each topic is a BullMQ queue of the same name (ADR-004). */
export const TOPICS = ['email', 'generation', 'forge-build', 'mesh-analysis', 'print-quote', 'webhook-delivery', 'order'] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * Write an outbox message in the caller's transaction. (topic, key) is unique, so a
 * retried request cannot enqueue the same work twice.
 */
export async function enqueue(tx: Tx, topic: Topic, key: string, payload: Prisma.InputJsonValue, availableAt?: Date): Promise<void> {
  await tx.outboxMessage.upsert({
    where: { topic_key: { topic, key } },
    update: {},
    create: { topic, key, payload, ...(availableAt ? { availableAt } : {}) },
  });
}
