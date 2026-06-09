import { ConstellationRuntime } from "./runtime.js";
import { DefaultSubagentRuntime } from "../subagents/SubagentRuntime.js";
import { RateLimiterRegistry } from "../resilience/rateLimit.js";
import { Tracer } from "../observability/traces.js";
import { getLogger } from "../observability/logger.js";
import { metrics as defaultMetrics } from "../observability/metrics.js";
import { SourceUnavailableError } from "../resilience/errors.js";
import { IdGenerator, systemClock } from "../util/ids.js";
import type { PiToolDefinition, ToolContext } from "./toolRegistry.js";
import type { SourceScope } from "../safety/sourceScopes.js";
import { DEFAULT_THRESHOLDS } from "../safety/confidencePolicy.js";

/**
 * Pi model driver — the model-driven tool-selection seam.
 *
 * This is where "the model chooses tools from the registry" becomes real: the
 * full registry is exposed to a Pi `AgentSession` as custom tools via
 * `registry.toPiTools()`. The model picks tools by their metadata/schemas; there
 * is no hand-routing. The deterministic orchestrator (used by CLI/RPC/evals)
 * remains the offline path; this is the online, LLM-backed path.
 *
 * The Pi SDK is an OPTIONAL dependency, imported lazily so the repo builds and
 * tests run without it. If it (or an API key) is absent, a typed error is
 * raised rather than guessing.
 */

const SYSTEM_PROMPT = `You are Constellation, a personal context-graph agent.
You discover defensible, evidence-backed relationships between fragments of work life.
A connection is not a vibe; it is an evidence-backed claim. Always prefer tools that
produce structured, provenance-bearing artifacts (Signal, DotLink, Constellation,
ContextCard). Never claim a connection without citing the supporting signal/link ids.
Choose tools from the provided registry by their input/output schemas and side effects.`;

/** Build a ToolContext factory bound to one runtime (fresh trace per tool call). */
export function piToolContextFactory(runtime: ConstellationRuntime, scopes?: SourceScope[]): () => ToolContext {
  const logger = getLogger();
  const rateLimiters = new RateLimiterRegistry();
  const tracer = new Tracer(logger, defaultMetrics);
  const ids = new IdGenerator("pi");
  return () => {
    const trace = tracer.start({ task: "pi_tool_call" });
    runtime.store.setMutationHook((e) =>
      trace.graphMutation({ op: e.op, entityType: e.entityType, entityId: e.entityId }),
    );
    return {
      store: runtime.store,
      trace,
      logger,
      metrics: defaultMetrics,
      rateLimiters,
      connectors: runtime.connectors,
      subagents: new DefaultSubagentRuntime({
        registry: runtime.registry,
        trace,
        logger,
        metrics: defaultMetrics,
        rateLimiters,
        clock: systemClock,
      }),
      scopes: scopes ?? [
        { source: "slack" },
        { source: "email" },
        { source: "calendar" },
        { source: "meeting_transcript" },
        { source: "doc" },
      ],
      thresholds: { ...DEFAULT_THRESHOLDS },
      dryRun: false,
      ids,
      clock: systemClock,
      audit: [],
    };
  };
}

/** Produce the Pi-compatible tool catalog for a runtime. */
export function constellationPiTools(runtime: ConstellationRuntime): PiToolDefinition[] {
  return runtime.registry.toPiTools(piToolContextFactory(runtime));
}

export interface RunModelDrivenOptions {
  task: string;
  runtime?: ConstellationRuntime;
  provider?: string;
  modelId?: string;
}

/**
 * Run a model-driven session: hand the registry to a Pi AgentSession and let the
 * model orchestrate. Returns the assistant's final text.
 *
 * NOTE: the JSON-Schema -> Pi tool-parameter bridge is best-effort; see the TODO
 * below. The deterministic orchestrator is the supported path for the scaffold.
 */
export async function runModelDriven(opts: RunModelDrivenOptions): Promise<string> {
  const runtime = opts.runtime ?? new ConstellationRuntime();

  // Lazy, optional import — never required at build time.
  const sdk: any = await import("@earendil-works/pi-coding-agent").catch(() => null);
  if (!sdk?.createAgentSession || !sdk?.defineTool) {
    throw new SourceUnavailableError(
      "@earendil-works/pi-coding-agent not available; install it and configure an API key to use the model-driven path",
      {},
    );
  }

  const piTools = constellationPiTools(runtime);
  const customTools = piTools.map((t) =>
    sdk.defineTool({
      name: t.name,
      label: t.label,
      description: t.description,
      // TODO: convert JSON Schema -> TypeBox precisely. Pi accepts a JSON-Schema-
      // shaped object; we pass it through and validate in our own execute path.
      parameters: t.parameters,
      execute: async (toolCallId: string, params: unknown) => {
        const result = await t.execute(toolCallId, params);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      },
    }),
  );

  const { session } = await sdk.createAgentSession({
    customTools,
    tools: ["read", ...customTools.map((t: { name: string }) => t.name)],
    systemPromptOverride: () => SYSTEM_PROMPT,
    ...(opts.provider && opts.modelId
      ? { model: sdk.getModel?.(opts.provider, opts.modelId) }
      : {}),
  });

  let text = "";
  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    }
  });
  try {
    await session.prompt(opts.task);
  } finally {
    unsubscribe?.();
    session.dispose?.();
  }
  return text;
}
