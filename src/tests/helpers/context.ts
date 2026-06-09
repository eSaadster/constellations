import { ToolRegistry, type ToolContext } from "../../agent/toolRegistry.js";
import { MemoryGraphStore } from "../../graph/memoryStore.js";
import { MockConnectorRegistry } from "../../connectors/mock.js";
import { Tracer } from "../../observability/traces.js";
import { createLogger } from "../../observability/logger.js";
import { Metrics } from "../../observability/metrics.js";
import { RateLimiterRegistry } from "../../resilience/rateLimit.js";
import { DefaultSubagentRuntime } from "../../subagents/SubagentRuntime.js";
import { DEFAULT_THRESHOLDS } from "../../safety/confidencePolicy.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";
import type { SourceScope } from "../../safety/sourceScopes.js";
import type { GraphStore } from "../../graph/store.js";

/** Build a self-contained ToolContext for unit tests. */
export function makeTestContext(opts: {
  registry?: ToolRegistry;
  store?: GraphStore;
  scopes?: SourceScope[];
} = {}): ToolContext {
  const registry = opts.registry ?? new ToolRegistry();
  const store = opts.store ?? new MemoryGraphStore();
  const logger = createLogger({ level: "silent" });
  const metrics = new Metrics();
  const rateLimiters = new RateLimiterRegistry();
  const trace = new Tracer(logger, metrics).start({ task: "test" });
  return {
    store,
    trace,
    logger,
    metrics,
    rateLimiters,
    connectors: new MockConnectorRegistry({}),
    subagents: new DefaultSubagentRuntime({ registry, trace, logger, metrics, rateLimiters, clock: fixedClock() }),
    scopes: opts.scopes ?? [],
    thresholds: { ...DEFAULT_THRESHOLDS },
    dryRun: false,
    ids: new IdGenerator("test"),
    clock: fixedClock(),
    audit: [],
  };
}
