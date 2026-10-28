import { describe, expect, it } from 'vitest';
import { makeRepos } from '../src/repos/index';
import { MissingScopeError, SCOPED } from '../src/scope';

// A database stub that fails the test if any query is attempted.
const noDb = new Proxy({}, { get: () => { throw new Error('query attempted without scope'); } }) as never;

describe('owner-scoped repositories', () => {
  const repos = makeRepos(noDb);
  const methods = Object.entries(repos).flatMap(([repo, r]) => Object.entries(r).map(([m, fn]) => [repo, m, fn] as const));

  it('covers at least one repository method', () => {
    expect(methods.length).toBeGreaterThan(5);
  });

  it.each(methods)('%s.%s is wrapped and declares a scope parameter', (_repo, _m, fn) => {
    expect((fn as unknown as Record<symbol, unknown>)[SCOPED]).toBe(true);
  });

  it.each(methods)('%s.%s throws MissingScopeError without a scope', (_repo, _m, fn) => {
    expect(() => (fn as (s: unknown) => unknown)(undefined)).toThrow(MissingScopeError);
    expect(() => (fn as (s: unknown) => unknown)({})).toThrow(MissingScopeError);
  });
});
