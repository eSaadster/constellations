import { ToolRegistry, scopedRegistry, type ToolContext } from "../agent/toolRegistry.js";
import type { Trace } from "../observability/traces.js";
import type { ConstellationLogger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import type { RateLimiterRegistry } from "../resilience/rateLimit.js";
import { SubagentIsolationError } from "../resilience/errors.js";
import { IdGenerator, type Clock } from "../util/ids.js";
import type { GraphStore } from "../graph/store.js";
import type { ConnectorRegistry } from "../connectors/types.js";
import {
  LINK_LAB_ALLOWED_TOOLS,
  type LinkLabInput,
  type LinkLabResult,
  type SubagentRuntime as ISubagentRuntime,
} from "./types.js";
import { runLinkLab } from "./LinkLabAgent.js";

/**
 * SubagentRuntime — spawns subagents in an isolated, scoped context.
 *
 * The isolation boundary is REAL in code, not by convention:
 *   - A subagent gets a `scopedRegistry` containing ONLY its allowed tools.
 *     Any other tool name simply does not resolve.
 *   - Its `store`, `connectors`, and nested-`subagents` capabilities are SEALED
 *     proxies that throw `SubagentIsolationError` on any access. The subagent
 *     cannot read the graph, read sources, or spawn further subagents.
 *   - It gets a fresh `IdGenerator` and only the payload handed to it — no
 *     reference to parent state.
 *   - It returns structured output only.
 */

export interface SubagentRuntimeDeps {
  registry: ToolRegistry;
  trace: Trace;
  logger: ConstellationLogger;
  metrics: Metrics;
  rateLimiters: RateLimiterRegistry;
  clock: Clock;
}

function sealed<T extends object>(capability: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      throw new SubagentIsolationError(
        `subagent attempted to access forbidden capability: ${capability}.${String(prop)}`,
        { capability, member: String(prop) },
      );
    },
  });
}

export class DefaultSubagentRuntime implements ISubagentRuntime {
  constructor(private readonly deps: SubagentRuntimeDeps) {}

  private buildScopedContext(allowed: readonly string[]): {
    registry: ToolRegistry;
    ctx: ToolContext;
  } {
    const registry = scopedRegistry(this.deps.registry, allowed);
    const ctx: ToolContext = {
      // Sealed: subagents cannot touch graph, sources, or spawn subagents.
      store: sealed<GraphStore>("store"),
      connectors: sealed<ConnectorRegistry>("connectors"),
      subagents: sealed<ISubagentRuntime>("subagents"),
      // Shared, safe observability + resilience.
      trace: this.deps.trace,
      logger: this.deps.logger.child({ subagent: true }),
      metrics: this.deps.metrics,
      rateLimiters: this.deps.rateLimiters,
      clock: this.deps.clock,
      // Fresh, isolated id space and a default empty scope/audit.
      ids: new IdGenerator("sub"),
      scopes: [],
      thresholds: { autoConfirmAbove: 0.7, quarantineBelow: 0.35 },
      dryRun: false,
      audit: [],
    };
    return { registry, ctx };
  }

  async runLinkLab(input: LinkLabInput): Promise<LinkLabResult> {
    const span = this.deps.trace.span("subagent_run", "LinkLabAgent", {
      candidateCount: input.candidateSignals.length,
      allowedTools: LINK_LAB_ALLOWED_TOOLS.length,
    });
    this.deps.metrics.increment("constellation_subagent_runs_total", { agent: "LinkLabAgent" });
    try {
      const { registry, ctx } = this.buildScopedContext(LINK_LAB_ALLOWED_TOOLS);
      // Apply the caller-provided threshold policy inside the isolated context.
      ctx.thresholds = input.thresholdPolicy;
      const result = await runLinkLab(input, { registry, ctx });
      span.end({
        proposed: result.proposedLinks.length,
        excluded: result.exclusions.length,
        inconclusive: result.inconclusive.length,
      });
      return result;
    } catch (err) {
      span.fail(err);
      throw err;
    }
  }
}
