/**
 * Minimal in-process metrics registry: counters + histograms.
 *
 * This is intentionally dependency-free (no Prometheus client) so the scaffold
 * runs locally. The `snapshot()` shape is Prometheus-friendly for a future
 * exporter. Metrics are tagged with labels and aggregated by label set.
 */

export type Labels = Record<string, string | number | boolean>;

function labelKey(name: string, labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${String(labels[k])}`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
}

export class Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, HistogramState>();
  private labelSets = new Map<string, { name: string; labels: Labels }>();

  increment(name: string, labels: Labels = {}, by = 1): void {
    const key = labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
    this.labelSets.set(key, { name, labels });
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const key = labelKey(name, labels);
    const h = this.histograms.get(key) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    };
    h.count += 1;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);
    this.histograms.set(key, h);
    this.labelSets.set(key, { name, labels });
  }

  getCounter(name: string, labels: Labels = {}): number {
    return this.counters.get(labelKey(name, labels)) ?? 0;
  }

  getHistogram(name: string, labels: Labels = {}): HistogramState | undefined {
    return this.histograms.get(labelKey(name, labels));
  }

  snapshot(): {
    counters: Array<{ name: string; labels: Labels; value: number }>;
    histograms: Array<{ name: string; labels: Labels } & HistogramState>;
  } {
    const counters = [...this.counters.entries()].map(([key, value]) => {
      const meta = this.labelSets.get(key)!;
      return { name: meta.name, labels: meta.labels, value };
    });
    const histograms = [...this.histograms.entries()].map(([key, state]) => {
      const meta = this.labelSets.get(key)!;
      return { name: meta.name, labels: meta.labels, ...state };
    });
    return { counters, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.labelSets.clear();
  }
}

/** Process-wide default metrics registry. */
export const metrics = new Metrics();
