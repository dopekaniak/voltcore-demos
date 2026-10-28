/**
 * Pure transition tables. Every state lists the states it may move to; anything else is
 * an invalid transition. Callers write an event row for every accepted transition.
 */
export interface Machine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  readonly terminal: readonly S[];
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: invalid transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function defineMachine<const T extends Record<string, readonly (keyof T & string)[]>>(
  name: string,
  transitions: T,
): Machine<keyof T & string> {
  type S = keyof T & string;
  const states = Object.keys(transitions) as S[];
  for (const [from, tos] of Object.entries(transitions) as [S, readonly S[]][]) {
    for (const to of tos) {
      if (!states.includes(to)) throw new Error(`${name}: ${from} -> unknown state ${to}`);
    }
  }
  const table = transitions as unknown as Record<S, readonly S[]>;
  const terminal = states.filter((s) => table[s].length === 0);
  return { name, states, transitions: table, terminal };
}

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return m.transitions[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S): void {
  if (!canTransition(m, from, to)) throw new InvalidTransitionError(m.name, from, to);
}

export function isTerminal<S extends string>(m: Machine<S>, s: S): boolean {
  return m.terminal.includes(s);
}
