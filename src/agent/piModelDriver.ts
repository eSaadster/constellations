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
  /** Logical provider name registered with the model registry. Defaults to "constellation-gateway". */
  provider?: string;
  /** Wire model id sent to the gateway. Defaults to env CONSTELLATION_MODEL or "glm-5.1". */
  modelId?: string;
  /** Anthropic-compatible gateway base URL. Defaults to env ANTHROPIC_BASE_URL. */
  baseUrl?: string;
  /** API key for the gateway. Defaults to env ANTHROPIC_API_KEY. */
  apiKey?: string;
}

const DEFAULT_PROVIDER = "constellation-gateway";
const DEFAULT_MODEL_ID = "glm-5.1";

/**
 * Run a model-driven session: hand the registry to a Pi AgentSession and let the
 * model orchestrate. Returns the assistant's final text.
 *
 * The base URL + API key + model id reach the wire through a Model object built
 * by an in-memory ModelRegistry (registerProvider -> find), NOT through env vars
 * read by the SDK: on the direct-session path the Anthropic provider always
 * passes `baseURL`/`apiKey` explicitly, so ANTHROPIC_BASE_URL is ignored. We
 * therefore read the gateway config ourselves and register it as a custom
 * provider. `authHeader` is left UNSET so the gateway gets Anthropic-native
 * `x-api-key` auth (setting it would send `Authorization: Bearer`, the OpenAI
 * convention, which an Anthropic-compatible gateway does not expect).
 *
 * The deterministic orchestrator remains the supported offline path.
 */
export async function runModelDriven(opts: RunModelDrivenOptions): Promise<string> {
  const runtime = opts.runtime ?? new ConstellationRuntime();

  // Lazy, optional import — never required at build time.
  const sdk: any = await import("@earendil-works/pi-coding-agent").catch(() => null);
  if (!sdk?.createAgentSession || !sdk?.defineTool || !sdk?.ModelRegistry || !sdk?.AuthStorage) {
    throw new SourceUnavailableError(
      "@earendil-works/pi-coding-agent not available; install it and configure an API key to use the model-driven path",
      {},
    );
  }

  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const modelId = opts.modelId ?? process.env.CONSTELLATION_MODEL ?? DEFAULT_MODEL_ID;
  const baseUrl = opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new SourceUnavailableError(
      "model-driven path requires a gateway base URL and API key; set ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY (see .env.example)",
      { hasBaseUrl: Boolean(baseUrl), hasApiKey: Boolean(apiKey) },
    );
  }

  // Build the Model via an in-memory registry: registerProvider() pushes the
  // model (with our gateway baseUrl) into the registry, find() reads it back,
  // and createAgentSession resolves the key via getApiKeyAndHeaders.
  const authStorage = sdk.AuthStorage.inMemory();
  const modelRegistry = sdk.ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(provider, {
    baseUrl,
    apiKey,
    api: "anthropic-messages",
    // NOTE: authHeader intentionally unset -> Anthropic-native x-api-key.
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 65536,
      },
    ],
  });
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    throw new SourceUnavailableError(
      `model-driven path could not resolve model ${provider}/${modelId} from the registry`,
      { provider, modelId },
    );
  }

  const piTools = constellationPiTools(runtime);
  const customTools = piTools.map((t) =>
    sdk.defineTool({
      name: t.name,
      label: t.label,
      description: t.description,
      // `t.parameters` is a faithful JSON Schema from zodToJsonSchema (bounds,
      // formats, defaults, enums, nested objects/arrays preserved). The Pi
      // Anthropic provider forwards `.properties`/`.required` verbatim into the
      // model-facing `input_schema`, so no TypeBox compilation happens at this
      // seam — passing the JSON-Schema object through is exactly correct. Inputs
      // are re-validated against the real Zod schema in our own execute() path.
      parameters: t.parameters,
      execute: async (toolCallId: string, params: unknown) => {
        const result = await t.execute(toolCallId, params);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      },
    }),
  );

  const { session } = await sdk.createAgentSession({
    model,
    modelRegistry,
    authStorage,
    customTools,
    tools: ["read", ...customTools.map((t: { name: string }) => t.name)],
    systemPromptOverride: () => SYSTEM_PROMPT,
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
