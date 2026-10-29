import { claimJob, failJob, jobProgress, succeedJob, type Prisma } from '@sw/db';
import type { WorkerContext } from '../context';
import { storeFile } from './forge';

/** REMESH and MESH_ANALYZE (repair) jobs: always write a new version, never overwrite. */
export async function processMeshJob(ctx: WorkerContext, jobId: string): Promise<void> {
  const job = await claimJob(ctx.db, jobId, ctx.workerId);
  if (!job) return;
  const pin = job.input as { print_part_id?: string };
  if (pin.print_part_id) return repairPrintPart(ctx, job.id, pin.print_part_id);
  try {
    const src = await ctx.db.assetVersion.findUniqueOrThrow({ where: { id: job.assetVersionId! }, include: { files: true } });
    const f = src.files.find((x) => x.role === 'STL') ?? src.files.find((x) => x.role === 'PREVIEW_MESH') ?? src.files.find((x) => x.role === 'GLB') ?? src.files.find((x) => x.role === 'REPAIRED');
    if (!f) throw new Error('this version has no mesh file');
    const fmt = f.role === 'GLB' ? 'glb' : 'stl';
    const body = await ctx.storage.get(f.storageKey);
    await jobProgress(ctx.db, job.id, 20);
    const input = job.input as { op: 'repair' | 'remesh'; target_faces?: number };
    const result = input.op === 'remesh' ? await ctx.mesh.remesh(body, fmt, input.target_faces ?? 20000, 'stl') : await ctx.mesh.repair(body, fmt, 'stl');
    const stl = result.file;
    const glb = await ctx.mesh.convert(stl, 'stl', 'glb');
    const analysis = result.report.after;
    await succeedJob(ctx.db, job.id, { actualCredits: job.reservedCredits }, async (tx, j) => {
      const last = await tx.assetVersion.findFirst({ where: { assetId: src.assetId }, orderBy: { number: 'desc' } });
      const v = await tx.assetVersion.create({
        data: {
          assetId: src.assetId,
          number: (last?.number ?? 0) + 1,
          stage: input.op === 'remesh' ? 'REMESHED' : 'REPAIRED',
          parentVersionId: src.id,
          jobId: j.id,
          triangles: analysis.triangles,
          bboxMm: analysis.bbox_mm,
          isWatertight: analysis.watertight,
          analysis: { ...analysis, actions: result.report.actions, before: result.report.before ?? null } as unknown as Prisma.InputJsonValue,
        },
      });
      const prefix = `assets/${src.assetId}/${v.id}`;
      await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: v.id, role: 'STL', body: stl, contentType: 'model/stl', filename: 'model.stl', keyPrefix: prefix, ext: 'stl' });
      await storeFile(ctx, tx, { ownerId: j.ownerId, assetVersionId: v.id, role: 'GLB', body: glb, contentType: 'model/gltf-binary', filename: 'model.glb', keyPrefix: prefix, ext: 'glb' });
      await tx.asset.update({ where: { id: src.assetId }, data: { currentVersionId: v.id } });
      await tx.job.update({ where: { id: j.id }, data: { output: { asset_id: src.assetId, version_id: v.id, actions: result.report.actions } } });
    });
  } catch (e) {
    await failJob(ctx.db, job.id, { code: 'MESH_SERVICE_ERROR', message: (e as Error).message });
  }
}

/** Repair a print part's mesh. The original stays; the part points at both. */
async function repairPrintPart(ctx: WorkerContext, jobId: string, partId: string): Promise<void> {
  try {
    const part = await ctx.db.printPart.findUniqueOrThrow({ where: { id: partId } });
    let key: string;
    let fmt: 'stl' | 'obj' | '3mf' = 'stl';
    if (part.uploadId) {
      const up = await ctx.db.upload.findUniqueOrThrow({ where: { id: part.uploadId } });
      key = up.storageKey;
      fmt = up.filename.toLowerCase().split('.').pop() as typeof fmt;
    } else {
      key = (await ctx.db.assetFile.findUniqueOrThrow({ where: { id: part.sourceFileId! } })).storageKey;
    }
    const { file, report } = await ctx.mesh.repair(await ctx.storage.get(key), fmt, 'stl');
    await succeedJob(ctx.db, jobId, { actualCredits: 0 }, async (tx, j) => {
      const f = await storeFile(ctx, tx, { ownerId: part.ownerId, assetVersionId: null, role: 'REPAIRED', body: file, contentType: 'model/stl', filename: 'repaired.stl', keyPrefix: `print-parts/${part.id}`, ext: 'stl' });
      await tx.printPart.update({
        where: { id: part.id },
        data: { repairedFileId: f.id, repairReport: report as object, useRepaired: true, status: report.after.watertight && report.after.manifold ? 'READY' : 'NEEDS_REPAIR' },
      });
      await tx.job.update({ where: { id: j.id }, data: { output: { part_id: part.id, actions: report.actions } } });
    });
  } catch (e) {
    await ctx.db.printPart.updateMany({ where: { id: partId, status: 'REPAIRING' }, data: { status: 'NEEDS_REPAIR' } });
    await failJob(ctx.db, jobId, { code: 'MESH_SERVICE_ERROR', message: (e as Error).message });
  }
}
