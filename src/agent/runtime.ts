import { ToolRegistry, type ToolContext } from "./toolRegistry.js";
import { ContextStrategy, type ContextSnapshot } from "./contextStrategy.js";
import { executePlan } from "./orchestrator.js";
import {
  buildConnectPlan,
  buildContextCardPlan,
  buildDiscoverPlan,
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
import type { DotLink } from "../artifacts/DotLink.js";
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

export interface ConnectAllResult {
  anchors: number;
  discovered: number;
  duplicatesRemoved: number;
  commit: { confirmed: number; proposed: number; quarantined: number; rejected: number };
  links: number;
  constellations: number;
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
  async ingestFixtures(): Promise<{
    signalIds: string[];
    signalCount: number;
    skipped: number;
    snapshot: ContextSnapshot;
  }> {
    const trace = this.tracer.start({ task: "ingest_fixtures", mode: "graph_update" });
    const ctx = this.buildContext(trace);
    const context = new ContextStrategy(trace.id, "ingest fixtures");

    // Phase 1: fetch raw items per scoped source that has a connector. Email
    // gets a since-cursor derived from the newest stored email signal (with a
    // 1h overlap; the externalId dedupe below absorbs boundary repeats). Other
    // sources use their connectors' own window policies.
    const sources = [...new Set(this.scopes.map((s) => s.source))].filter((s) =>
      this.connectors.has(s as SignalSource),
    ) as SignalSource[];

    const fetchPlan = {
      goal: "fetch",
      steps: sources.map((s) => buildFetchStep(s, this.fetchQuery(s))),
    };
    await executePlan(fetchPlan, this.registry, ctx, context);

    const fetched: RawSourceItem[] = [];
    for (const source of sources) {
      const out = context.getOutput<{ items: RawSourceItem[] }>(`fetch_${source}`);
      if (out?.items) fetched.push(...out.items);
    }

    // Incremental guard: skip items already in the graph (source + externalId).
    // Without this, re-ingesting would re-create known items — and a fresh id
    // counter would overwrite the originals.
    const rawItems = fetched.filter(
      (item) => !this.store.findSignalByExternalId(item.source, item.externalId),
    );
    const skipped = fetched.length - rawItems.length;

    // Phase 2: per-item pipeline.
    const pipelineSteps = rawItems.flatMap((item, i) => buildIngestItemSteps(item, i));
    await executePlan({ goal: "ingest", steps: pipelineSteps }, this.registry, ctx, context);

    const signalIds = rawItems.map((_item, i) =>
      context.getOutput<{ signalId: string }>(`crt_${rawItems[i]!.source}_${i}`)?.signalId,
    ).filter((id): id is string => Boolean(id));

    trace.complete({ signalCount: signalIds.length, skipped });
    return { signalIds, signalCount: signalIds.length, skipped, snapshot: context.snapshot() };
  }

  /** First-run Slack backfill depth. Slack's default window is only 24h, so a
   * graph with no slack history yet gets one deeper sweep. */
  private static readonly SLACK_BACKFILL_DAYS = 7;

  /** Per-source fetch query for an ingest run. */
  private fetchQuery(source: SignalSource): { since?: string } {
    if (source === "email") return this.sinceCursor(source);
    if (source === "slack") {
      // Only against a real connector (mock fixtures carry old timestamps and
      // would be filtered out by any recency window).
      const live = this.connectors.has(source) && this.connectors.get(source).kind !== "mock";
      const hasHistory = this.store.listSignals().some((s) => s.source === "slack");
      if (live && !hasHistory) {
        const since = new Date(
          Date.now() - ConstellationRuntime.SLACK_BACKFILL_DAYS * 86_400_000,
        ).toISOString();
        return { since };
      }
    }
    return {};
  }

  /** Since-cursor for a source: newest stored signal timestamp minus 1h. */
  private sinceCursor(source: SignalSource): { since?: string } {
    const newest = this.store
      .listSignals()
      .filter((s) => s.source === source)
      .map((s) => s.timestamp)
      .sort()
      .at(-1);
    if (!newest) return {};
    const t = Date.parse(newest);
    if (Number.isNaN(t)) return {};
    return { since: new Date(t - 3_600_000).toISOString() };
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

  /**
   * Connect every ingested signal in one pass: discover candidate links for each
   * anchor, commit them as a single batch, optionally dedupe the resulting graph
   * (highest-confidence link per unordered pair + relation), then (re)build the
   * constellations. `dedupe` collapses the reverse/duplicate links that arise
   * when both A and B are anchored against each other.
   */
  async connectAll(opts: { dedupe?: boolean } = {}): Promise<ConnectAllResult> {
    const dedupe = opts.dedupe ?? false;
    const trace = this.tracer.start({ task: "connect_all", mode: "graph_update" });
    const ctx = this.buildContext(trace);
    const anchorIds = this.store.listSignals().map((s) => s.id);

    // Phase 1: discover candidate links for every anchor (no commit/cluster yet).
    // Each anchor's LinkLab runs in its own isolated "sub" id namespace, so link
    // ids collide across anchors (every lab emits link_sub_1, link_sub_2, ...).
    // Reassign a globally-unique id to each so the single commit below cannot
    // silently overwrite one anchor's link with another's.
    const discovered: DotLink[] = [];
    for (const anchorSignalId of anchorIds) {
      const context = new ContextStrategy(trace.id, `discover ${anchorSignalId}`);
      await executePlan(buildDiscoverPlan(anchorSignalId), this.registry, ctx, context);
      const collected = context.getOutput<{ links: DotLink[] }>("collect");
      for (const link of collected?.links ?? []) {
        discovered.push({ ...link, id: this.ids.next("link") });
      }
    }

    // Phase 2: commit all discovered links in one batch.
    const commitContext = new ContextStrategy(trace.id, "connect-all commit");
    await executePlan(
      {
        goal: "commit all discovered links",
        steps: [
          {
            id: "commit",
            phase: "graph_update",
            toolName: "graph.commit_links",
            reason: "persist all discovered links",
            literalInput: { links: discovered },
          },
        ],
      },
      this.registry,
      ctx,
      commitContext,
    );
    // commit_links also returns the committed ids; keep only the counts so the
    // result stays terse (anchoring 20+ signals commits dozens of links).
    const committed = commitContext.getOutput<
      ConnectAllResult["commit"] & { linkIds: string[] }
    >("commit")!;
    const commit: ConnectAllResult["commit"] = {
      confirmed: committed.confirmed,
      proposed: committed.proposed,
      quarantined: committed.quarantined,
      rejected: committed.rejected,
    };

    // Phase 3: optional dedupe across the whole link set.
    const duplicatesRemoved = dedupe ? this.dedupeStoredLinks() : 0;

    // Phase 4: (re)build constellations from the final link set. One upsert per
    // anchor covers every connected component; update_constellation reads links
    // live, so post-dedupe clusters carry correct summaries + linkIds.
    const clusterContext = new ContextStrategy(trace.id, "connect-all cluster");
    await executePlan(
      {
        goal: "cluster all components",
        steps: anchorIds.map((id, i) => ({
          id: `cluster_${i}`,
          phase: "graph_update",
          toolName: "constellation.update_constellation",
          reason: `cluster around ${id}`,
          literalInput: { anchorSignalId: id },
        })),
      },
      this.registry,
      ctx,
      clusterContext,
    );

    trace.complete({ anchors: anchorIds.length, links: this.store.listLinks().length });
    return {
      anchors: anchorIds.length,
      discovered: discovered.length,
      duplicatesRemoved,
      commit,
      links: this.store.listLinks().length,
      constellations: this.store.listConstellations().length,
    };
  }

  /**
   * Remove duplicate links, keeping the highest-confidence link per unordered
   * (sourceSignalId, targetSignalId) pair + relation. Returns the count removed.
   */
  private dedupeStoredLinks(): number {
    const best = new Map<string, DotLink>();
    const losers: string[] = [];
    for (const link of this.store.listLinks()) {
      const pair = [link.sourceSignalId, link.targetSignalId].sort().join("::");
      const key = `${pair}|${link.relation}`;
      const incumbent = best.get(key);
      if (!incumbent) {
        best.set(key, link);
      } else if (link.confidence > incumbent.confidence) {
        best.set(key, link);
        losers.push(incumbent.id);
      } else {
        losers.push(link.id);
      }
    }
    for (const id of losers) this.store.removeLink(id);
    return losers.length;
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
