import type { SignalSource, ExtractedFacts } from "../artifacts/Signal.js";

/**
 * Connector adapter boundary.
 *
 * A `SourceConnector` is the only thing that talks to an external source. The
 * scaffold ships fixture-backed mock connectors; real connectors (mcporter /
 * Composio) implement the same interface behind this seam. Tools never call an
 * SDK directly — they call a connector, so consent scopes, rate limits, and
 * retries apply uniformly.
 */

export interface RawSourceItem {
  source: SignalSource;
  externalId: string;
  url?: string;
  actorIds: string[];
  /** ISO-8601 timestamp of the source event. */
  timestamp: string;
  title?: string;
  /** Body text (may be long; tools decide what to keep as excerpt). */
  text: string;
  /** Optional source-native payload for debugging/fidelity. */
  raw?: Record<string, unknown>;
  /**
   * Optional extraction hints. In production these would be produced by NLP/LLM
   * extraction over `text`; fixtures provide them so mock extraction is
   * deterministic. Extractors MERGE these with values derived from `text`.
   */
  extractedHints?: Partial<ExtractedFacts>;
}

export interface ConnectorQuery {
  query?: string;
  /** Restrict to items at or after this ISO timestamp. */
  since?: string;
  /** Restrict to items at or before this ISO timestamp. */
  until?: string;
  limit?: number;
  /** Source-native container (channel id, calendar id, folder id, ...). */
  containerId?: string;
}

export interface SourceConnector {
  readonly source: SignalSource;
  readonly kind: "mock" | "mcporter" | "composio";
  fetchById(externalId: string): Promise<RawSourceItem | undefined>;
  search(query: ConnectorQuery): Promise<RawSourceItem[]>;
  list(query?: ConnectorQuery): Promise<RawSourceItem[]>;
}

export interface ConnectorRegistry {
  get(source: SignalSource): SourceConnector;
  has(source: SignalSource): boolean;
  sources(): SignalSource[];
}
