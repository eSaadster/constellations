/**
 * Deterministic id generator. Tests and evals need reproducible ids, so the
 * generator is seeded and monotonic per prefix rather than random.
 */
export class IdGenerator {
  private counters = new Map<string, number>();
  constructor(private readonly seed = "") {}

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return this.seed ? `${prefix}_${this.seed}_${n}` : `${prefix}_${n}`;
  }

  reset(): void {
    this.counters.clear();
  }
}

/** ISO clock helper (injectable for determinism). */
export type Clock = () => string;
export const systemClock: Clock = () => new Date().toISOString();

/** A fixed clock for tests/evals: advances by `stepMs` on each call. */
export function fixedClock(startIso = "2026-01-01T00:00:00.000Z", stepMs = 0): Clock {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += stepMs;
    return iso;
  };
}
