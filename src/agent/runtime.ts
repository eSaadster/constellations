import { ToolRegistry, type ToolContext } from "./toolRegistry.js";
import { ContextStrategy, type ContextSnapshot } from "./contextStrategy.js";
import { executePlan } from "./orchestrator.js";
import {
  buildConnectPlan,
  buildContextCardPlan,
  buildFetchStep,
  buildIngestItemSteps,
} from "./planner.js";
import { createToolRegistry } from "../tools/index.js";
import { MemoryGraphStore } from "../graph/memoryStore.js";
import type { GraphStore } from "../graph/store.js";
import { Tracer, type Trace } from "../observability/traces.js";
import { getLogger, type ConstellationLogger } from "../observability/logger.js";
import { metrics as defaultMetrics, type Metrics } from "../observability/metrics.js";
import { RateLimiterRegistry } from "../resilience/rateLimit.js";
import { DefaultSubagentRuntime } from "../subagents/SubagentRuntime.js";
import { createConnectors, type ConnectorRegistry } from "../connectors/index.js";
import type { RawSourceItem } from "../connectors/types.js";
import type { Signal } from "../artifacts/Signal.js";
import type { Constellation } from "../artifacts/Constellation.js";
import type { ContextCard } from "../artifacts/ContextCard.js";
import type { LinkLabResult } from "../subagents/types.js";
import { type SourceScope } from "../safety/sourceScopes.js";
import { DEFAULT_THRESHOLDS, type ConfidenceThresholds } from "../safety/confidencePolicy.js";
import { IdGenerator, systemClock, type Clock } from "../util/ids.js";
import type { SignalSource } from "../artifacts/Signal.js";

const ALL_SOURCES: SignalSource[] = ["slack", "email", "calendar", "meeting_transcript", "doc", "note"];

export interface ConstellationRuntimeOptions {
  store?: GraphStore;
  registry?: ToolRegistry;
  connectors?: ConnectorRegistry;
  logger?: ConstellationLogger;
  metrics?: Metrics;
  rateLimiters?: RateLimiterRegistry;
  scopes?: SourceScope[];
  thresholds?: ConfidenceThresholds;
  clock?: Clock;
  ids?: IdGenerator;
}

export interface ConnectResult {
  anchorSignalId: string;
  linkResult: LinkLabResult;
  constellation: Constellation;
  commit: { confirmed: number; proposed: number; quarantined: number; rejected: number };
  snapshot: ContextSnapshot;
}

export interface ContextCardResult {
  contextCard: ContextCard;
  linkResult: LinkLabResult;
  snapshot: ContextSnapshot;
}

/**
 * ConstellationRuntime — owns the graph store, registry, connectors, and
 * cross-cutting services, and exposes the high-level operations the CLI / RPC /
 * Slack interfaces call. Each operation runs through the orchestrator's generic
 * executor with its own trace + context ledger.
 */
export class ConstellationRuntime {
  readonly store: GraphStore;
  readonly registry: ToolRegistry;
  readonly connectors: ConnectorRegistry;
  private readonly logger: ConstellationLogger;
  private readonly metrics: Metrics;
  private readonly rateLimiters: RateLimiterRegistry;
  private readonly tracer: Tracer;
  private readonly scopes: SourceScope[];
  private readonly thresholds: ConfidenceThresholds;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(opts: ConstellationRuntimeOptions = {}) {
    this.store = opts.store ?? new MemoryGraphStore();
    this.registry = opts.registry ?? createToolRegistry();
    this.connectors = opts.connectors ?? createConnectors();
    this.logger = opts.logger ?? getLogger();
    this.metrics = opts.metrics ?? defaultMetrics;
    this.rateLimiters = opts.rateLimiters ?? new RateLimiterRegistry();
    this.thresholds = opts.thresholds ?? { ...DEFAULT_THRESHOLDS };
    this.clock = opts.clock ?? systemClock;
    this.ids = opts.ids ?? new IdGenerator();
    this.tracer = new Tracer(this.logger, this.metrics);
    this.scopes = opts.scopes ?? ALL_SOURCES.map((source) => ({ source }));
  }

  private buildContext(trace: Trace): ToolContext {
    const subagents = new DefaultSubagentRuntime({
      registry: this.registry,
      trace,
      logger: this.logger,
      metrics: this.metrics,
      rateLimiters: this.rateLimiters,
      clock: this.clock,
    });
    // Route store mutations to this trace for the duration of the operation.
    this.store.setMutationHook((e) =>
      trace.graphMutation({ op: e.op, entityType: e.entityType, entityId: e.entityId }),
    );
    return {
      store: this.store,
      trace,
      logger: this.logger,
      metrics: this.metrics,
      rateLimiters: this.rateLimiters,
      connectors: this.connectors,
      subagents,
      scopes: this.scopes,
      thresholds: this.thresholds,
      dryRun: false,
      ids: this.ids,
      clock: this.clock,
      audit: [],
    };
  }

  /** Health check: registry size, namespaces, connector sources, store counts. */
  health(): {
    ok: boolean;
    tools: number;
    namespaces: string[];
    connectors: string[];
    signals: number;
    links: number;
    constellations: number;
  } {
    return {
      ok: true,
      tools: this.registry.size(),
      namespaces: this.registry.namespaces(),
      connectors: this.connectors.sources(),
      signals: this.store.listSignals().length,
      links: this.store.listLinks().length,
      constellations: this.store.listConstellations().length,
    };
  }

  /** Directly insert pre-built Signals (used by evals/tests). */
  addSignals(signals: Signal[]): void {
    for (const s of signals) this.store.addSignal(s);
  }

  /**
   * Ingest raw items from connectors (within scope) through the full
   * normalize -> extract -> persist pipeline. Returns the created signal ids.
   */
  async ingestFixtures(): Promise<{ signalIds: string[]; signalCount: number; snapshot: ContextSnapshot }> {
    const trace = this.tracer.start({ task: "ingest_fixtures", mode: "graph_update" });
    const ctx = this.buildContext(trace);
    const context = new ContextStrategy(trace.id, "ingest fixtures");

    // Phase 1: fetch raw items per scoped source that has a connector.
    const sources = [...new Set(this.scopes.map((s) => s.source))].filter((s) =>
      this.connectors.has(s as SignalSource),
    ) as SignalSource[];

    const fetchPlan = { goal: "fetch", steps: sources.map((s) => buildFetchStep(s)) };
    await executePlan(fetchPlan, this.registry, ctx, context);

    const rawItems: RawSourceItem[] = [];
    for (const source of sources) {
      const out = context.getOutput<{ items: RawSourceItem[] }>(`fetch_${source}`);
      if (out?.items) rawItems.push(...out.items);
    }

    // Phase 2: per-item pipeline.
    const pipelineSteps = rawItems.flatMap((item, i) => buildIngestItemSteps(item, i));
    await executePlan({ goal: "ingest", steps: pipelineSteps }, this.registry, ctx, context);

    const signalIds = rawItems.map((_item, i) =>
      context.getOutput<{ signalId: string }>(`crt_${rawItems[i]!.source}_${i}`)?.signalId,
    ).filter((id): id is string => Boolean(id));

    trace.complete({ signalCount: signalIds.length });
    return { signalIds, signalCount: signalIds.length, snapshot: context.snapshot() };
  }

  /** Connect dots for an anchor signal (find -> LinkLab -> commit -> cluster). */
  async connect(anchorSignalId: string): Promise<ConnectResult> {
    const trace = this.tracer.start({ task: `connect ${anchorSignalId}`, mode: "graph_update" });
    const ctx = this.buildContext(trace);
    const context = new ContextStrategy(trace.id, `connect ${anchorSignalId}`);

    await executePlan(buildConnectPlan(anchorSignalId), this.registry, ctx, context, undefined);

    const linkResult = context.getOutput<LinkLabResult>("lab")!;
    const cluster = context.getOutput<{ constellation: Constellation }>("cluster")!;
    const commit = context.getOutput<{
      confirmed: number;
      proposed: number;
      quarantined: number;
      rejected: number;
    }>("commit")!;

    trace.complete({ links: linkResult.proposedLinks.length });
    return {
      anchorSignalId,
      linkResult,
      constellation: cluster.constellation,
      commit,
      snapshot: context.snapshot(),
    };
  }

  /** Generate a Context Card (connect chain + render). */
  async generateContextCard(anchorSignalId: string): Promise<ContextCardResult> {
    const trace = this.tracer.start({ task: `context_card ${anchorSignalId}`, mode: "context_card" });
    const ctx = this.buildContext(trace);
    const context = new ContextStrategy(trace.id, `context card ${anchorSignalId}`);

    await executePlan(buildContextCardPlan(anchorSignalId), this.registry, ctx, context);

    const contextCard = context.getOutput<{ contextCard: ContextCard }>("card")!.contextCard;
    const linkResult = context.getOutput<LinkLabResult>("lab")!;

    trace.complete({ connections: contextCard.connections.length });
    return { contextCard, linkResult, snapshot: context.snapshot() };
  }
}

export function createConstellationRuntime(
  opts?: ConstellationRuntimeOptions,
): ConstellationRuntime {
  return new ConstellationRuntime(opts);
}
