# Template: `.pi/src/constellation/core/orchestrator.ts`
#template #pi-core-ai

```ts
import { selectPlan } from "./planner.js";
import { createContextStrategy } from "./contextStrategy.js";
import { createToolRegistry } from "./toolRegistry.js";
import { checkScopes } from "../domain/safety/sourceScopes.js";
import { traceRun } from "../production/observability/traces.js";

export async function runConstellationCore({ input, deps }: RunConstellationCoreArgs) {
  const registry = createToolRegistry(deps);
  const trace = traceRun({ task: input.task, mode: input.mode });
  const context = createContextStrategy({ traceId: trace.id, task: input.task });

  await checkScopes(input.scopes, { registry, trace });
  context.phase("planning");

  const plan = await selectPlan({
    task: input.task,
    anchor: input.anchor,
    mode: input.mode,
    registry,
    context,
    model: deps.model,
  });

  for (const step of plan.steps) {
    deps.signal?.throwIfAborted?.();
    context.phase(step.phase);
    deps.onUpdate?.({ phase: step.phase, tool: step.toolName, reason: step.reason });

    const tool = registry.get(step.toolName);
    if (!tool) throw new Error(`Unknown constellation tool: ${step.toolName}`);

    const toolInput = context.resolveInput(step);
    const output = await tool.execute(toolInput, {
      trace,
      context,
      dryRun: input.dryRun,
      subagents: deps.subagents,
    });
    context.recordCall({ step, input: toolInput, output });
  }

  const result = context.finalResult();
  trace.complete(result);
  return result;
}
```
