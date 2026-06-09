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

  /**
   * Advance counters past existing ids so a new process resumes numbering
   * instead of restarting at 1 (which would silently overwrite persisted
   * entities that share the id). Accepts any id shaped `prefix_N` or
   * `prefix_anything_N`; unparseable ids are ignored.
   */
  seedFromIds(ids: Iterable<string>): void {
    for (const id of ids) {
      const match = /^([a-z]+)_(?:.*_)?(\d+)$/i.exec(id);
      if (!match) continue;
      const [, prefix, num] = match;
      const n = Number(num);
      if (!prefix || !Number.isFinite(n)) continue;
      if (n > (this.counters.get(prefix) ?? 0)) this.counters.set(prefix, n);
    }
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
