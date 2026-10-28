import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { TOPICS } from '@sw/db';
import type { Publisher } from './relay';

export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function makePublisher(conn: Redis): Publisher & { close(): Promise<void> } {
  const queues = new Map(TOPICS.map((t) => [t, new Queue(t, { connection: conn })]));
  return {
    async publish(topic, jobId, payload, delayMs) {
      const q = queues.get(topic as (typeof TOPICS)[number]);
      if (!q) throw new Error(`unknown topic ${topic}`);
      await q.add(topic, payload, {
        jobId,
        delay: delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}

export function startWorker(topic: string, conn: Redis, fn: Processor, concurrency = 4): Worker {
  return new Worker(topic, fn, { connection: conn, concurrency });
}
