# Tool Selection Architecture
#architecture #tool #pi-core-ai

Tool selection is model-driven through a registry, planner, and executor owned by **pi-core-ai**. Any host adapter only forwards the user task and renders the runtime result.

## Goals

- Avoid a 50-branch conditional router.
- Preserve coherent behavior at 50+ tools.
- Make tool composition discoverable from typed inputs/outputs.

## Components

1. `core/toolRegistry.ts` stores definitions, schemas, namespace metadata, side effects, consent requirements, and output types.
2. `core/planner.ts` asks the model to propose a tool sequence using registry summaries and current plan state.
3. `core/orchestrator.ts` validates every proposed call against schemas, consent scopes, rate limits, and context budget.
4. `core/contextStrategy.ts` keeps plan state, evidence ledger, summarized history, and unresolved subgoals.
5. Optional host adapters delegate to `core/runtime.ts` and do not select tools themselves.

## Planner prompt responsibilities

The planner must produce:

```ts
type PlannedToolCall = {
  toolName: string;
  reason: string;
  inputFrom: Array<{ sourceCallId: string; path: string; targetPath: string }>;
  literalInput: Record<string, unknown>;
  expectedOutput: string;
  stopCondition?: string;
};
```

## Executor safeguards

- Reject unknown tools.
- Reject input/output schema mismatches.
- Deny graph mutation tools from subagents unless explicitly allowed.
- Attach trace IDs and provenance to every tool result.
- Store structured outputs in a call ledger for downstream composition.
