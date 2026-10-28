import type { Db } from '@sw/db';

export interface Publisher {
  /** Enqueue on the topic's queue; `jobId` makes a re-publish a no-op. */
  publish(topic: string, jobId: string, payload: unknown, delayMs: number): Promise<void>;
}

interface Row {
  id: bigint;
  topic: string;
  key: string;
  payload: unknown;
  available_at: Date;
}

/**
 * Publish up to `limit` unpublished outbox rows (ADR-004). Rows are locked with SKIP LOCKED
 * so several relays can run; a row is marked published only after the queue accepted it.
 */
export async function relayOnce(db: Db, pub: Publisher, now = new Date(), limit = 100): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Row[]>`
      SELECT id, topic, key, payload, available_at FROM outbox_messages
      WHERE published_at IS NULL AND available_at <= ${now}
      ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    for (const r of rows) {
      await pub.publish(r.topic, `${r.topic}:${r.key}`.replace(/:/g, '_'), r.payload, 0);
    }
    if (rows.length) {
      await tx.outboxMessage.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { publishedAt: now, attempts: { increment: 1 } },
      });
    }
    return rows.length;
  });
}
