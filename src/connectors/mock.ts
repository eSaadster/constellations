import type { SignalSource } from "../artifacts/Signal.js";
import { SourceUnavailableError } from "../resilience/errors.js";
import type {
  ConnectorQuery,
  ConnectorRegistry,
  RawSourceItem,
  SourceConnector,
} from "./types.js";

/**
 * Fixture-backed mock connector. Serves `RawSourceItem`s from an in-memory
 * dataset so the whole system runs locally with no credentials. Implements the
 * exact same `SourceConnector` interface as the real mcporter/Composio
 * connectors, so swapping them in requires no changes upstream.
 */
export class MockSourceConnector implements SourceConnector {
  readonly kind = "mock" as const;
  constructor(
    readonly source: SignalSource,
    private readonly items: RawSourceItem[],
  ) {}

  async fetchById(externalId: string): Promise<RawSourceItem | undefined> {
    return this.items.find((i) => i.externalId === externalId);
  }

  async list(query: ConnectorQuery = {}): Promise<RawSourceItem[]> {
    let out = [...this.items];
    if (query.since) out = out.filter((i) => i.timestamp >= query.since!);
    if (query.until) out = out.filter((i) => i.timestamp <= query.until!);
    if (query.containerId) {
      out = out.filter((i) => (i.raw?.containerId as string | undefined) === query.containerId);
    }
    out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return query.limit ? out.slice(0, query.limit) : out;
  }

  async search(query: ConnectorQuery): Promise<RawSourceItem[]> {
    const q = (query.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const all = await this.list(query);
    if (q.length === 0) return all;
    return all.filter((i) => {
      const hay = `${i.title ?? ""} ${i.text}`.toLowerCase();
      return q.some((term) => hay.includes(term));
    });
  }
}

export type ConnectorDataset = Partial<Record<SignalSource, RawSourceItem[]>>;

export class MockConnectorRegistry implements ConnectorRegistry {
  private readonly connectors = new Map<SignalSource, SourceConnector>();

  constructor(dataset: ConnectorDataset = {}) {
    for (const [source, items] of Object.entries(dataset) as [SignalSource, RawSourceItem[]][]) {
      this.connectors.set(source, new MockSourceConnector(source, items ?? []));
    }
  }

  get(source: SignalSource): SourceConnector {
    const c = this.connectors.get(source);
    if (!c) {
      throw new SourceUnavailableError(`no connector configured for source: ${source}`, { source });
    }
    return c;
  }

  has(source: SignalSource): boolean {
    return this.connectors.has(source);
  }

  sources(): SignalSource[] {
    return [...this.connectors.keys()];
  }

  /** Replace or add a connector (used to inject real connectors per source). */
  set(source: SignalSource, connector: SourceConnector): void {
    this.connectors.set(source, connector);
  }
}
