import type { FastifyInstance } from 'fastify';
import { AppError, isTerminal, jobMachine, jobsApi, type JobStatus } from '@sw/shared';
import { cancelJob, retryAsNewJob } from '@sw/db';
import type { AppContext } from '../context';
import { idOr404 } from '../lib/access';
import { FORGE_BUILD_TIMEOUT_MS, forgeCosts } from '../lib/costs';
import { requireUser, route } from '../lib/route';
import { serializeJob } from '../lib/serialize';

export function jobRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function ownJob(apiId: string, userId: string) {
    const job = await ctx.db.job.findUnique({ where: { id: idOr404('job', apiId, 'Job') } });
    if (!job || job.ownerId !== userId) throw new AppError('NOT_FOUND', 'Job not found');
    return job;
  }

  route(app, ctx, jobsApi.getJob, async ({ params }, req) => serializeJob(await ownJob(params.id, requireUser(req))));

  route(app, ctx, jobsApi.cancelJob, async ({ params }, req) => {
    const userId = requireUser(req);
    const job = await ownJob(params.id, userId);
    return serializeJob(await cancelJob(ctx.db, job.id, userId));
  });

  route(app, ctx, jobsApi.retryJob, async ({ params }, req) => {
    const job = await ownJob(params.id, requireUser(req));
    let reserve = job.reservedCredits;
    if (job.kind === 'FORGE_BUILD') reserve = (job.input as { prompt?: string }).prompt ? (await forgeCosts(ctx.db)).author : 0;
    const next = await ctx.db.$transaction((tx) => retryAsNewJob(tx, job, reserve, FORGE_BUILD_TIMEOUT_MS));
    return serializeJob(next);
  });

  /** SSE: replays events after Last-Event-ID, then streams new ones until the job is final. */
  route(app, ctx, jobsApi.jobEvents, async ({ params }, req, reply) => {
    const job = await ownJob(params.id, requireUser(req));
    const header = req.headers['last-event-id'];
    let after = BigInt(0);
    if (typeof header === 'string' && /^\d{1,19}$/.test(header)) after = BigInt(header);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': req.id,
    });
    res.write(': connected\n\nretry: 2000\n\n');
    let closed = false;
    req.raw.on('close', () => (closed = true));
    const started = Date.now();
    while (!closed && Date.now() - started < 10 * 60_000) {
      const events = await ctx.db.jobEvent.findMany({ where: { jobId: job.id, seq: { gt: after } }, orderBy: { seq: 'asc' }, take: 100 });
      for (const e of events) {
        after = e.seq;
        const data = { type: e.type, from: e.fromStatus, to: e.toStatus, progress: e.progress, data: e.data, at: e.createdAt.toISOString() };
        res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(data)}\n\n`);
      }
      const current = await ctx.db.job.findUnique({ where: { id: job.id } });
      if (!current || isTerminal(jobMachine, current.status as JobStatus)) {
        const rest = await ctx.db.jobEvent.count({ where: { jobId: job.id, seq: { gt: after } } });
        if (rest === 0) {
          res.write(`event: end\ndata: ${JSON.stringify(current ? serializeJob(current) : null)}\n\n`);
          break;
        }
        continue;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    res.end();
  });
}
