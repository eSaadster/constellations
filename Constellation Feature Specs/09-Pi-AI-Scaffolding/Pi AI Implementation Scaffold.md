# pi-core-ai Implementation Scaffold
#production #architecture #pi-core-ai

This scaffold targets **pi-core-ai as the core autonomous agent runtime**. Pi is treated as an optional host adapter, not the center of the architecture.

See also: [[pi-core-ai Runtime Architecture]].

## Layered structure

```txt
.pi/src/constellation/
  core/
    runtime.ts
      # Creates the pi-core-ai-backed Constellation runtime.
    orchestrator.ts
      # Delegates planning/execution to pi-core-ai abstractions.
    planner.ts
      # Model-driven plan construction using registry metadata.
    contextStrategy.ts
      # Plan/call/evidence ledgers and compaction policy.
    toolRegistry.ts
      # 50+ coherent tools with schemas, capabilities, side effects.
    subagentRuntime.ts
      # Isolated subagent spawning through pi-core-ai.
    subagents/
      LinkLabAgent.ts

  domain/
    artifacts/
      Signal.ts
      DotLink.ts
      Constellation.ts
      ContextCard.ts
    graph/
      store.ts
      scoring.ts
      provenance.ts
    safety/
      confidencePolicy.ts
      sourceScopes.ts
      redaction.ts

  connectors/
    slack/
    email/
    calendar/
    meeting/
    docs/

  production/
    observability/
    resilience/
    evals/
    tests/

  pi-adapter/                 # optional host adapter
    tool.ts                   # defineTool wrapper only
    renderPiResult.ts         # host-specific formatting only

.pi/extensions/constellation.ts # optional thin Pi registration only
```

## Optional Pi host style borrowed from `.pi/extensions/workflow.ts`

If exposing the runtime inside Pi:

- Keep registration thin.
- `pi.registerTool(tool)` registers once.
- `session_start` activates the tool when missing.
- Put host-specific schema/rendering in `pi-adapter/` only.

## Critical architectural rule

Constellation should **not** put autonomous-agent runtime ownership in the host adapter. Instead:

- **pi-core-ai owns planning, model-driven tool selection, context management, subagent isolation, execution, eval hooks, and trace collection.**
- Constellation domain code owns Signal/DotLink/Constellation semantics.
- Connectors own source-specific reads.
- Host adapters own only invocation and presentation.

## Optional Pi registration

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createConstellationTool } from "../src/constellation/index.js";

export default function extension(pi: ExtensionAPI) {
  const constellationTool = createConstellationTool();
  pi.registerTool(constellationTool);

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (!active.includes(constellationTool.name)) {
      pi.setActiveTools([...active, constellationTool.name]);
    }
  });
}
```

## Runtime input shape

Host adapters pass a high-level task and scoped sources into pi-core-ai.

```ts
type ConstellationRuntimeInput = {
  task: string;
  anchor?: {
    source: "slack" | "email" | "calendar" | "meeting_transcript" | "doc" | "note";
    externalId?: string;
    url?: string;
  };
  scopes: SourceScope[];
  mode?: "context_card" | "meeting_prep" | "daily_digest" | "graph_update";
  dryRun?: boolean;
};
```

## Required implementation rails

- Use [[pi-core-ai Runtime Architecture]] as the top-level architectural contract.
- Use [[Tool Namespace Registry]] as the registry source of truth.
- Use [[Long-Horizon Execution Strategy]] for pi-core-ai plan/call/evidence ledgers.
- Use [[LinkLabAgent]] for isolated forensic link scoring via pi-core-ai subagent runtime.
- Use [[Production Scaffolding]] for observability, retries, rate limits, typed errors, tests, and evals.
