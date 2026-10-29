import type { WorkerContext } from './context';
import { processForgeBuild, processForgeExport } from './processors/forge';
import { processGeneration } from './processors/generation';
import { processMeshJob } from './processors/mesh';

/** Route a forge-build queue message to the processor for its job kind. */
export async function dispatchForge(c: WorkerContext, jobId: string): Promise<void> {
  const job = await c.db.job.findUnique({ where: { id: jobId }, select: { kind: true } });
  if (job?.kind === 'FORGE_BUILD') await processForgeBuild(c, jobId);
  else if (job?.kind === 'FORGE_EXPORT') await processForgeExport(c, jobId);
}

export async function dispatchGeneration(c: WorkerContext, msg: { jobId: string; poll?: boolean }): Promise<void> {
  await processGeneration(c, msg);
}

export async function dispatchMesh(c: WorkerContext, jobId: string): Promise<void> {
  await processMeshJob(c, jobId);
}
