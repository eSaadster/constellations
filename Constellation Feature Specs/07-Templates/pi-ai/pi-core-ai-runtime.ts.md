# Template: `.pi/src/constellation/core/runtime.ts`
#template #pi-core-ai

```ts
import { createPlanner } from "./planner.js";
import { createContextStrategy } from "./contextStrategy.js";
import { createToolRegistry } from "./toolRegistry.js";
import { createSubagentRuntime } from "./subagentRuntime.js";
import { createTraceSink } from "../production/observability/traces.js";

export type ConstellationRuntimeInput = {
  task: string;
  anchor?: SourceAnchor;
  scopes: SourceScope[];
  mode?: "context_card" | "meeting_prep" | "daily_digest" | "graph_update";
  dryRun?: boolean;
};

export function createConstellationRuntime(deps: PiCoreRuntimeDeps) {
  const registry = createToolRegistry(deps);
  const planner = createPlanner({ model: deps.model, registry });
  const subagents = createSubagentRuntime(deps);
  const traces = createTraceSink(deps);

  return {
    async run(input: ConstellationRuntimeInput) {
      const trace = traces.start({ task: input.task, mode: input.mode });
      const context = createContextStrategy({ traceId: trace.id, task: input.task });

      const plan = await planner.plan({ input, context });
      const result = await executePlan({ plan, input, context, registry, subagents, trace });

      trace.complete(result);
      return result;
    },
  };
}

async function executePlan(args: ExecutePlanArgs) {
  // pi-core-ai owns plan execution, tool selection validation,
  // context compaction, subagent isolation, evidence ledger writes,
  // retries, rate limits, and typed error handling.
}
```
