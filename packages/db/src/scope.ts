/**
 * Owner scope. Every repository method takes one as its first argument; a test walks all
 * repositories and fails if any method skips it.
 */
export interface OwnerScope {
  /** Signed-in user. */
  userId?: string | undefined;
  /** Anonymous visitor (hashed cookie). Only print parts, uploads, and quotes accept it. */
  anonId?: string | undefined;
}

export class MissingScopeError extends Error {
  constructor(repo: string, method: string) {
    super(`${repo}.${method} called without an owner scope`);
    this.name = 'MissingScopeError';
  }
}

export const SCOPED = Symbol.for('sw.scopedRepoMethod');

type AnyFn = (scope: OwnerScope, ...args: never[]) => unknown;

export function assertScope(scope: unknown): asserts scope is OwnerScope {
  const s = scope as OwnerScope | undefined;
  if (!s || typeof s !== 'object' || (!s.userId && !s.anonId)) throw new Error('missing scope');
}

/** Wrap every method so a missing scope throws before any query runs. */
export function defineRepo<T extends Record<string, AnyFn>>(name: string, methods: T): T {
  const out: Record<string, AnyFn> = {};
  for (const [method, fn] of Object.entries(methods)) {
    const wrapped = ((scope: OwnerScope, ...args: never[]) => {
      try {
        assertScope(scope);
      } catch {
        throw new MissingScopeError(name, method);
      }
      return fn(scope, ...args);
    }) as AnyFn & { [SCOPED]?: true };
    wrapped[SCOPED] = true;
    out[method] = wrapped;
  }
  return out as T;
}

/** Prisma `where` fragment for rows owned by this scope. */
export function ownerWhere(scope: OwnerScope): { ownerId: string } | { anonId: string; ownerId: null } {
  if (scope.userId) return { ownerId: scope.userId };
  return { anonId: scope.anonId!, ownerId: null };
}
