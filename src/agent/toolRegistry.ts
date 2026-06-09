import { z } from "zod";
import type { ArtifactType } from "../artifacts/index.js";
import type { GraphStore } from "../graph/store.js";
import type { Trace } from "../observability/traces.js";
import type { ConstellationLogger } from "../observability/logger.js";
import type { Metrics } from "../observability/metrics.js";
import { metrics as defaultMetrics } from "../observability/metrics.js";
import type { RateLimiterRegistry } from "../resilience/rateLimit.js";
import { withRetry } from "../resilience/retry.js";
import { ToolSchemaError } from "../resilience/errors.js";
import type { ConnectorRegistry } from "../connectors/types.js";
import type { SubagentRuntime } from "../subagents/types.js";
import type { SourceScope, AccessAuditEntry } from "../safety/sourceScopes.js";
import type { ConfidenceThresholds } from "../safety/confidencePolicy.js";
import { DEFAULT_THRESHOLDS } from "../safety/confidencePolicy.js";
import type { IdGenerator, Clock } from "../util/ids.js";
import { zodToJsonSchema, type JsonSchema } from "./jsonSchema.js";

/**
 * The tool registry is the single source of truth for what Constellation can
 * do. Tools are selected by metadata (namespace, schemas, side effects, consent
 * scopes), never by a hand-written `switch(toolName)`. The orchestrator runs a
 * declared plan through the generic `execute()` loop; a model-driven host can
 * instead pick tools from `toPiTools()`. Either way, dispatch is data-driven.
 */

export type SideEffect = "none" | "source_read" | "graph_write" | "brief_write";
export type RiskLevel = "low" | "medium" | "high";
export type RetryPolicy = "none" | "source_api" | "embedding";

/** Shared dependencies handed to every tool handler. */
export interface ToolContext {
  store: GraphStore;
  trace: Trace;
  logger: ConstellationLogger;
  metrics: Metrics;
  rateLimiters: RateLimiterRegistry;
  connectors: ConnectorRegistry;
  subagents: SubagentRuntime;
  scopes: SourceScope[];
  thresholds: ConfidenceThresholds;
  dryRun: boolean;
  ids: IdGenerator;
  clock: Clock;
  /** Accumulates consent access decisions for `consent.audit_access`. */
  audit: AccessAuditEntry[];
}

export interface ToolDefinition<
  In extends z.ZodTypeAny = z.ZodTypeAny,
  Out extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  namespace: string;
  description: string;
  inputSchema: In;
  outputSchema: Out;
  consumes: ArtifactType[];
  produces: ArtifactType[];
  sideEffects: SideEffect;
  riskLevel: RiskLevel;
  /** Source permissions required, e.g. ["slack:read"]. */
  requiredConsentScopes: string[];
  rateLimitKey?: string;
  retryPolicy?: RetryPolicy;
  handler: (input: z.infer<In>, ctx: ToolContext) => Promise<z.infer<Out>>;
}

/** Public, model-facing summary of a tool (no handler, no zod). */
export interface ToolSummary {
  name: string;
  namespace: string;
  description: string;
  consumes: ArtifactType[];
  produces: ArtifactType[];
  sideEffects: SideEffect;
  riskLevel: RiskLevel;
  requiredConsentScopes: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/** A Pi-SDK-compatible tool definition produced from a registry entry. */
export interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
}

const RETRY_MAX: Record<RetryPolicy, number> = {
  none: 1,
  source_api: 3,
  embedding: 2,
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register<In extends z.ZodTypeAny, Out extends z.ZodTypeAny>(
    def: ToolDefinition<In, Out>,
  ): void {
    if (this.tools.has(def.name)) {
      throw new Error(`duplicate tool registration: ${def.name}`);
    }
    if (!def.name.startsWith(`${def.namespace}.`)) {
      throw new Error(`tool ${def.name} must be namespaced under "${def.namespace}."`);
    }
    this.tools.set(def.name, def as ToolDefinition<any, any>);
  }

  registerAll(defs: ToolDefinition<any, any>[]): void {
    for (const d of defs) this.register(d);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition<any, any>[] {
    return [...this.tools.values()];
  }

  namespaces(): string[] {
    return [...new Set(this.list().map((t) => t.namespace))].sort();
  }

  listByNamespace(namespace: string): ToolDefinition<any, any>[] {
    return this.list().filter((t) => t.namespace === namespace);
  }

  size(): number {
    return this.tools.size;
  }

  /**
   * Generic, data-driven executor. This is the ONLY path tools are invoked
   * through, so input/output validation, tracing, metrics, rate limiting, and
   * retry are applied uniformly to every tool — including future ones.
   */
  async execute<I = unknown, O = unknown>(
    name: string,
    input: I,
    ctx: ToolContext,
  ): Promise<O> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolSchemaError(`unknown tool: ${name}`, { name });
    }

    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ToolSchemaError(`input schema violation for ${name}`, {
        name,
        issues: parsedInput.error.issues,
      });
    }

    const span = ctx.trace.span("tool_call", name, {
      namespace: tool.namespace,
      sideEffects: tool.sideEffects,
      riskLevel: tool.riskLevel,
      dryRun: ctx.dryRun,
    });
    ctx.metrics.increment("constellation_tool_calls_total", { namespace: tool.namespace });

    try {
      const invoke = async () => {
        const run = () => tool.handler(parsedInput.data, ctx);
        return tool.rateLimitKey
          ? ctx.rateLimiters.run(tool.rateLimitKey, run)
          : run();
      };

      const maxAttempts = RETRY_MAX[tool.retryPolicy ?? "none"];
      const output =
        maxAttempts > 1
          ? await withRetry(invoke, {
              maxAttempts,
              onRetry: ({ attempt, delayMs, error }) =>
                ctx.logger.warn(
                  { event: "tool_retry", tool: name, attempt, delayMs, error: String(error) },
                  "retrying tool",
                ),
            })
          : await invoke();

      const parsedOutput = tool.outputSchema.safeParse(output);
      if (!parsedOutput.success) {
        throw new ToolSchemaError(`output schema violation for ${name}`, {
          name,
          issues: parsedOutput.error.issues,
        });
      }
      span.end({ ok: true });
      return parsedOutput.data as O;
    } catch (err) {
      span.fail(err);
      ctx.metrics.increment("constellation_tool_errors_total", { namespace: tool.namespace });
      throw err;
    }
  }

  /** Model-facing catalog (used by the planner prompt and discovery). */
  summaries(): ToolSummary[] {
    return this.list().map((t) => ({
      name: t.name,
      namespace: t.namespace,
      description: t.description,
      consumes: t.consumes,
      produces: t.produces,
      sideEffects: t.sideEffects,
      riskLevel: t.riskLevel,
      requiredConsentScopes: t.requiredConsentScopes,
      inputSchema: zodToJsonSchema(t.inputSchema),
      outputSchema: zodToJsonSchema(t.outputSchema),
    }));
  }

  /**
   * Convert registry entries into Pi-SDK-compatible tool definitions so a
   * model can choose tools directly. The execute thunk runs through the same
   * generic `execute()` path, preserving validation/tracing/retries.
   */
  toPiTools(ctxFactory: () => ToolContext): PiToolDefinition[] {
    return this.list().map((t) => ({
      name: t.name.replace(/\./g, "__"), // Pi tool names avoid dots
      label: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.inputSchema),
      execute: async (_toolCallId: string, params: unknown) =>
        this.execute(t.name, params, ctxFactory()),
    }));
  }
}

/**
 * Build a scoped registry containing only the named tools. Used by the subagent
 * runtime to enforce tool isolation: a subagent's registry literally cannot
 * resolve a forbidden tool.
 */
export function scopedRegistry(parent: ToolRegistry, allowed: readonly string[]): ToolRegistry {
  const child = new ToolRegistry();
  for (const name of allowed) {
    const def = parent.get(name);
    if (def) child.register(def);
  }
  return child;
}

export function defaultThresholds(): ConfidenceThresholds {
  return { ...DEFAULT_THRESHOLDS };
}

export { defaultMetrics };
