/**
 * Deterministic interleaving control for D1 and the fake chain. Every statement first waits a seeded-random number
 * of microtask turns, so a given seed always produces the same interleaving of concurrent requests.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scheduler(seed: number, maxTurns = 8) {
  const rnd = mulberry32(seed);
  return async () => {
    const n = Math.floor(rnd() * (maxTurns + 1));
    for (let i = 0; i < n; i++) await Promise.resolve();
  };
}

type Stmt = { bind(...p: unknown[]): Stmt; all(): Promise<unknown>; first(c?: string): Promise<unknown>; run(): Promise<unknown>; raw(o?: unknown): Promise<unknown> };

/** Wraps a D1 look-alike so each statement yields to the scheduler before it runs. */
export function jitterD1<T extends { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown> }>(db: T, tick: () => Promise<void>): T {
  const wrap = (s: Stmt): Stmt => ({
    bind: (...p) => wrap(s.bind(...p)),
    all: async () => (await tick(), s.all()),
    first: async (c) => (await tick(), s.first(c)),
    run: async () => (await tick(), s.run()),
    raw: async (o) => (await tick(), s.raw(o)),
  });
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") return async (stmts: Stmt[]) => (await tick(), target.batch(stmts));
      return Reflect.get(target, prop, recv);
    },
  });
}
