# pi-core-ai Runtime Architecture
#pi-core-ai #architecture #production

Constellation is a **pi-core-ai autonomous agent runtime/application**. Pi is only one optional host adapter for invoking the runtime and rendering results.

## Architectural boundary

```txt
.pi/src/constellation/core/
  -> pi-core-ai runtime integration
  -> owns autonomous planning, execution, subagents, context, eval hooks

.pi/src/constellation/domain/
  -> Constellation-specific artifacts and domain services
  -> Signal, DotLink, Constellation, ContextCard, graph, safety

.pi/src/constellation/connectors/
  -> source adapters for Slack, email, calendar, meetings, docs

.pi/src/constellation/production/
  -> observability, resilience, typed errors, eval harness, tests

.pi/src/constellation/pi-adapter/
  -> optional host adapter for Pi sessions
  -> createConstellationTool(), Pi defineTool schema, Pi rendering

.pi/extensions/constellation.ts
  -> optional thin Pi registration only
```

## Ownership model

| Concern | Owner |
|---|---|
| Autonomous planning | pi-core-ai runtime |
| Model-driven tool selection | pi-core-ai runtime |
| Tool registry coherence | pi-core-ai runtime |
| Context strategy and ledgers | pi-core-ai runtime |
| Subagent isolation | pi-core-ai runtime |
| Retry/rate-limit/error policies | pi-core-ai runtime, with connector adapters |
| Observability/eval traces | pi-core-ai runtime |
| Signal/DotLink/Constellation semantics | Constellation domain layer |
| Source-specific reads | Connector layer |
| Host-specific registration/rendering | Optional host adapter |
| Tool registration in Pi | Optional Pi adapter |
| User-facing Pi tool schema | Optional Pi adapter |

## Runtime responsibilities

pi-core-ai must provide or own these abstractions:

```ts
type CoreAgentRuntime = {
  plan(input: RuntimeTask): Promise<RuntimePlan>;
  execute(plan: RuntimePlan, context: RuntimeContext): Promise<RuntimeResult>;
  spawnSubagent<I, O>(spec: SubagentSpec<I, O>, input: I): Promise<O>;
  selectTool(goal: ToolGoal, registry: ToolRegistry): Promise<ToolCallPlan>;
  recordEvidence(claim: EvidenceClaim): void;
  compactContext(policy: ContextCompactionPolicy): void;
};
```

## Optional Pi adapter responsibilities

The Pi adapter should stay thin and replaceable:

```ts
export async function executePiConstellationTool(params, piContext) {
  const runtime = createConstellationRuntime({
    modelRegistry: piContext.modelRegistry,
    model: piContext.model,
    cwd: piContext.cwd,
    onUpdate: piContext.onUpdate,
  });

  const result = await runtime.run({
    task: params.task,
    anchor: params.anchor,
    scopes: params.scopes,
    mode: params.mode,
    dryRun: params.dryRun,
  });

  return renderPiToolResult(result);
}
```

## Non-goals for any host adapter

- No long conditional router.
- No domain scoring logic.
- No source connector business logic.
- No subagent implementation details.
- No independent context strategy separate from pi-core-ai.

## Core invariant

Constellation core must be testable and runnable without importing Pi extension APIs. Only optional host registration and presentation may depend on Pi.
