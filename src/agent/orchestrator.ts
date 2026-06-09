import { ToolRegistry, type ToolContext } from "./toolRegistry.js";
import { ContextStrategy, type Plan, type ContextSnapshot } from "./contextStrategy.js";

/**
 * Orchestrator — the generic plan executor.
 *
 * It walks a declared `Plan`, resolves each step's input from the call ledger,
 * runs the tool through the registry's generic `execute()` (which traces,
 * validates, rate-limits, retries), and records the result. There is NO
 * per-tool branching here: every step is dispatched by name through the
 * registry. Honors abort signals between steps.
 */
export interface ExecutePlanResult {
  context: ContextStrategy;
  snapshot: ContextSnapshot;
}

export async function executePlan(
  plan: Plan,
  registry: ToolRegistry,
  ctx: ToolContext,
  context: ContextStrategy,
  signal?: AbortSignal,
): Promise<ExecutePlanResult> {
  for (const step of plan.steps) {
    if (signal?.aborted) throw new Error("aborted");
    context.phase(step.phase);
    const { input, consumedFrom } = context.resolveInput(step);
    ctx.logger.debug(
      { event: "plan_step", step: step.id, tool: step.toolName, consumedFrom },
      "executing plan step",
    );
    const output = await registry.execute(step.toolName, input, ctx);
    context.recordCall({ step, input, output, consumedFrom });
  }
  return { context, snapshot: context.snapshot() };
}
