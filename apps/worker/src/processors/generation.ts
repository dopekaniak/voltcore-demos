import { claimJob, enqueue, failJob, jobProgress, succeedJob, type Job, type Prisma } from '@sw/db';
import { ProviderError, type NormalizedTask, type ProviderInput } from '@sw/providers';
import type { WorkerContext } from '../context';
import { storeFile } from './forge';

const LEASE_MS = 30_000;
const DEFAULT_POLL: Record<string, number> = { mock: 1000, meshy: 5000 };

interface GenInput {
  op: 'preview' | 'refine' | 'image' | 'retexture';
  prompt?: string;
  style?: string;
  topology?: 'triangle' | 'quad';
  polycount?: number;
  texture_prompt?: string;
  upload_ids?: string[];
  remove_background?: boolean;
  title?: string;
}

function pollMs(ctx: WorkerContext, key: string): number {
  return ctx.pollMs?.[key] ?? DEFAULT_POLL[key] ?? 5000;
}

async function schedulePoll(ctx: WorkerContext, job: Job, delay?: number) {
  const at = new Date(Date.now() + (delay ?? pollMs(ctx, job.providerKey ?? '')));
  await enqueue(ctx.db, 'generation', `${job.id}:poll:${at.getTime()}`, { jobId: job.id, poll: true }, at);
}

/**
 * Generation jobs (GENERATE, REFINE, RETEXTURE). A queued job is claimed and its provider
 * task created; then the job is polled (scheduled polls plus webhook-triggered ones) until
 * the provider reports a final state. The provider is always asked directly: webhook bodies
 * never move state on their own (ADR-006). State only moves forward.
 */
export async function processGeneration(ctx: WorkerContext, msg: { jobId: string; poll?: boolean }): Promise<void> {
  const job = await ctx.db.job.findUnique({ where: { id: msg.jobId } });
  if (!job) return;
  if (job.status === 'QUEUED' && !msg.poll) {
    const claimed = await claimJob(ctx.db, job.id, ctx.workerId);
    if (claimed) await start(ctx, claimed);
    return;
  }
  if (job.status === 'RUNNING' && job.providerTaskId) await poll(ctx, job);
}

async function start(ctx: WorkerContext, job: Job): Promise<void> {
  const provider = ctx.providers.get(job.providerKey ?? '');
  if (!provider) return void (await failJob(ctx.db, job.id, { code: 'PROVIDER_ERROR', message: `Provider ${job.providerKey} is not configured` }));
  const input = job.input as unknown as GenInput;
  let pin: ProviderInput;
  try {
    pin = await providerInput(ctx, job, input);
  } catch (e) {
    return void (await failJob(ctx.db, job.id, { code: 'PROVIDER_ERROR', message: (e as Error).message }));
  }
  let taskId: string;
  try {
    taskId = (await provider.createTask(pin, { idempotencyKey: job.id })).providerTaskId;
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null;
    // An uncertain create is not retried automatically: the provider may already have made
    // (and billed) the task. The job fails, credits are released, and ops reconcile.
    return void (await failJob(ctx.db, job.id, { code: pe?.code ?? 'PROVIDER_ERROR', message: (e as Error).message }));
  }
  // Release the claim lock so polls can take the short lease.
  const updated = await ctx.db.job.update({ where: { id: job.id }, data: { providerTaskId: taskId, lockedAt: null } });
  await ctx.db.jobEvent.create({ data: { jobId: job.id, type: 'provider_task', data: { provider: provider.key } } });
  await jobProgress(ctx.db, job.id, 2);
  await schedulePoll(ctx, updated);
}

async function providerInput(ctx: WorkerContext, job: Job, input: GenInput): Promise<ProviderInput> {
  const modelCode = job.modelCode ?? 'mock-standard';
  if (input.op === 'preview') {
    const styled = input.style ? `${input.prompt}, ${input.style} style` : input.prompt!;
    return { kind: 'preview', modelCode, prompt: styled, topology: input.topology, polycount: input.polycount };
  }
  if (input.op === 'refine') {
    const parent = await ctx.db.job.findUniqueOrThrow({ where: { id: job.parentJobId! } });
    return { kind: 'refine', modelCode, previewTaskId: parent.providerTaskId!, texturePrompt: input.texture_prompt };
  }
  if (input.op === 'image') {
    const uploads = await ctx.db.upload.findMany({ where: { id: { in: input.upload_ids ?? [] } } });
    const imageUrls = await Promise.all(uploads.map((u) => ctx.storage.signedGetUrl(u.storageKey, { ttlS: 3600 })));
    return { kind: 'image', modelCode, imageUrls, removeBackground: input.remove_background };
  }
  const src = await ctx.db.assetVersion.findUniqueOrThrow({ where: { id: job.assetVersionId! }, include: { files: true } });
  const srcJob = src.jobId ? await ctx.db.job.findUnique({ where: { id: src.jobId } }) : null;
  const glb = src.files.find((f) => f.role === 'GLB');
  return {
    kind: 'retexture',
    modelCode,
    texturePrompt: input.prompt ?? '',
    ...(srcJob?.providerKey === job.providerKey && srcJob?.providerTaskId ? { sourceTaskId: srcJob.providerTaskId } : {}),
    ...(glb ? { sourceModelUrl: await ctx.storage.signedGetUrl(glb.storageKey, { ttlS: 3600 }) } : {}),
  };
}

async function poll(ctx: WorkerContext, job: Job): Promise<void> {
  // A short lease keeps webhook-triggered and scheduled polls from overlapping.
  const lease = await ctx.db.job.updateMany({
    where: { id: job.id, status: 'RUNNING', OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LEASE_MS) } }] },
    data: { lockedAt: new Date(), lockedBy: ctx.workerId },
  });
  if (lease.count === 0) return void (await schedulePoll(ctx, job));
  const release = () => ctx.db.job.updateMany({ where: { id: job.id, lockedBy: ctx.workerId }, data: { lockedAt: null } });
  const provider = ctx.providers.get(job.providerKey ?? '');
  if (!provider) return void (await failJob(ctx.db, job.id, { code: 'PROVIDER_ERROR', message: 'Provider is no longer configured' }));
  let task: NormalizedTask;
  try {
    task = await provider.getTask(job.providerTaskId!);
  } catch (e) {
    await release();
    if (e instanceof ProviderError && !e.retryable) return void (await failJob(ctx.db, job.id, { code: 'PROVIDER_ERROR', message: e.message }));
    return void (await schedulePoll(ctx, job, 2 * pollMs(ctx, job.providerKey ?? '')));
  }
  if (task.status === 'QUEUED' || task.status === 'RUNNING') {
    if (task.progress > job.progress) await jobProgress(ctx.db, job.id, Math.min(95, task.progress));
    await release();
    if (job.timeoutAt && job.timeoutAt < new Date()) return void (await failJob(ctx.db, job.id, { code: 'JOB_TIMEOUT', message: 'The provider did not finish in time' }));
    return void (await schedulePoll(ctx, job));
  }
  if (task.status === 'FAILED' || task.status === 'CANCELED') {
    return void (await failJob(ctx.db, job.id, { code: task.status === 'FAILED' ? (task.error?.code ?? 'PROVIDER_TASK_FAILED') : 'PROVIDER_CANCELED', message: task.error?.message ?? 'The provider did not complete the task' }));
  }
  try {
    await finish(ctx, job, task);
  } catch (e) {
    await release();
    // Downloads or analysis failed: retry the finishing step later; the provider result stays.
    await schedulePoll(ctx, job, 3 * pollMs(ctx, job.providerKey ?? ''));
    ctx.log('finish failed; will retry', { job: job.id, err: (e as Error).message });
  }
}

const STAGE = { GENERATE: 'PREVIEW', REFINE: 'REFINED', RETEXTURE: 'RETEXTURED' } as const;

async function finish(ctx: WorkerContext, job: Job, task: NormalizedTask): Promise<void> {
  const provider = ctx.providers.get(job.providerKey!)!;
  if (!task.outputs.glb) throw new Error('the provider returned no GLB');
  const glb = await provider.download(task.outputs.glb);
  const stl = await ctx.mesh.convert(glb, 'glb', 'stl');
  const analysis = await ctx.mesh.analyze(stl, 'stl');
  const thumb = task.outputs.thumbnail ? await provider.download(task.outputs.thumbnail).catch(() => null) : null;
  const input = job.input as unknown as GenInput;
  const kind = job.kind as keyof typeof STAGE;
  await succeedJob(ctx.db, job.id, { actualCredits: job.reservedCredits }, async (tx, j) => {
    let assetId = j.assetId;
    if (kind === 'GENERATE') {
      const title = (input.title ?? input.prompt ?? 'Generated model').replace(/\s+/g, ' ').trim().slice(0, 120);
      const a = await tx.asset.create({ data: { ownerId: j.ownerId!, kind: 'GENERATED', title: title.charAt(0).toUpperCase() + title.slice(1), prompt: input.prompt ?? null } });
      assetId = a.id;
    }
    const last = await tx.assetVersion.findFirst({ where: { assetId: assetId! }, orderBy: { number: 'desc' } });
    const v = await tx.assetVersion.create({
      data: {
        assetId: assetId!,
        number: (last?.number ?? 0) + 1,
        stage: STAGE[kind],
        provider: job.providerKey,
        modelCode: job.modelCode,
        parentVersionId: kind === 'GENERATE' ? null : j.assetVersionId,
        jobId: j.id,
        triangles: analysis.triangles,
        bboxMm: analysis.bbox_mm,
        isWatertight: analysis.watertight,
        analysis: analysis as unknown as Prisma.InputJsonValue,
      },
    });
    const prefix = `assets/${assetId}/${v.id}`;
    await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: v.id, role: 'GLB', body: glb, contentType: 'model/gltf-binary', filename: 'model.glb', keyPrefix: prefix, ext: 'glb' });
    await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: v.id, role: 'STL', body: stl, contentType: 'model/stl', filename: 'model.stl', keyPrefix: prefix, ext: 'stl' });
    if (thumb) await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: v.id, role: 'THUMBNAIL', body: thumb, contentType: 'image/png', filename: 'thumbnail.png', keyPrefix: prefix, ext: 'png' });
    await tx.asset.update({ where: { id: assetId! }, data: { currentVersionId: v.id } });
    await tx.job.update({ where: { id: j.id }, data: { assetId, assetVersionId: v.id, output: { asset_id: assetId, version_id: v.id, printable: analysis.printable } } });
  });
}
