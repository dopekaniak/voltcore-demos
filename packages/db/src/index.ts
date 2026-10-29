import { Prisma, PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient };
export * from '@prisma/client';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient;

/** Create a Prisma client. Each service owns one client for its process lifetime. */
export function createDb(url?: string, opts: { log?: boolean } = {}): PrismaClient {
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: opts.log ? ['warn', 'error'] : ['error'],
  });
}

/** True when the error is a unique-constraint violation (P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export * from './credits';
export * from './scope';
export * from './users';
export { makeRepos, type Repos } from './repos/index';
export * from './outbox';
export * from './audit';
export * from './jobs';
export * from './events';
