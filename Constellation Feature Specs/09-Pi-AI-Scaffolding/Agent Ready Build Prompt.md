# Agent Ready Build Prompt
#pi-core-ai #implementation

Paste this into a fresh Pi coding-agent session when ready to implement.

```txt
You are implementing Constellation as a pi-core-ai autonomous agent runtime/application. Pi is only one optional host adapter for invoking and displaying the runtime.

Read first:
1. Constellation Feature Specs/09-Pi-AI-Scaffolding/pi-core-ai Runtime Architecture.md
2. Constellation Feature Specs/09-Pi-AI-Scaffolding/Pi AI Implementation Scaffold.md
3. Constellation Feature Specs/09-Pi-AI-Scaffolding/Seven Dimension Implementation Map.md
4. Constellation Feature Specs/03-Tools/Tool Namespace Registry.md
5. Constellation Feature Specs/02-Architecture/Long-Horizon Execution Strategy.md
6. Constellation Feature Specs/04-Subagents/LinkLabAgent.md
7. Optional Pi host-adapter style references:
   - .pi/extensions/workflow.ts
   - .pi/src/workflow-tool.ts
   - .pi/src/workflow.ts
   - .pi/src/agent.ts
   - .pi/src/display.ts

Goal: Build Constellation as a pi-core-ai runtime that owns autonomous planning, model-selected tool execution, context ledgers, subagent isolation, observability/eval hooks, and long-horizon behavior. Add a thin Pi host adapter only to expose that runtime inside Pi.

Deliverables:
- .pi/src/constellation/core/runtime.ts — pi-core-ai-backed runtime factory and `run()` entrypoint.
- .pi/src/constellation/core/orchestrator.ts — pi-core-ai plan execution, validation, evidence recording.
- .pi/src/constellation/core/planner.ts — model-driven plan construction using registry metadata.
- .pi/src/constellation/core/contextStrategy.ts — plan ledger, call ledger, evidence ledger, compaction refs.
- .pi/src/constellation/core/toolRegistry.ts — coherent registry for 50+ tools across 4+ namespaces.
- .pi/src/constellation/core/subagentRuntime.ts — pi-core-ai isolated subagent spawning.
- .pi/src/constellation/core/subagents/LinkLabAgent.ts — isolated comparison subagent with scoped tools.
- .pi/src/constellation/domain/artifacts/{Signal,DotLink,Constellation,ContextCard}.ts — domain artifacts.
- .pi/src/constellation/domain/graph/{store,scoring,provenance}.ts — context graph domain services.
- .pi/src/constellation/domain/safety/{confidencePolicy,sourceScopes,redaction}.ts — safety and permission policy.
- .pi/src/constellation/connectors/{slack,email,calendar,meeting,docs}/ — source connector adapters or fixtures.
- .pi/src/constellation/production/resilience/{retry,rateLimit,errors}.ts — production resilience.
- .pi/src/constellation/production/observability/traces.ts — trace every source read, score, graph mutation, and brief claim.
- .pi/src/constellation/production/evals/harness.ts — fixture eval runner.
- Optional Pi host adapter:
  - .pi/extensions/constellation.ts — thin registration only.
  - .pi/src/constellation/pi-adapter/tool.ts — defineTool wrapper delegating to core runtime.
  - .pi/src/constellation/pi-adapter/renderPiResult.ts — convert runtime result to Pi tool content/details.
- Tests for unit scoring/registry/schema behavior and integration tool-chain behavior.

Acceptance criteria:
- [ ] Constellation core can run in tests without importing Pi extension APIs.
- [ ] pi-core-ai runtime owns tool selection, execution, context strategy, subagent isolation, eval hooks, and trace collection.
- [ ] Optional Pi adapter contains no autonomous planning logic; it delegates to `.pi/src/constellation/core/runtime.ts`.
- [ ] Registry contains at least 50 tools across at least 4 namespaces and is selected through metadata/schemas, not a long conditional router.
- [ ] At least one tool spawns `LinkLabAgent` in an isolated pi-core-ai subagent context with scoped tool access and structured output.
- [ ] A fixture run executes 20+ composable tool calls while preserving plan/call/evidence ledgers.
- [ ] At least one downstream tool consumes structured output from a prior tool.
- [ ] Observability, exponential backoff, rate limiting, typed errors, eval harness, and unit/integration tests are present.
- [ ] User-visible claims cite Signal/DotLink provenance or are marked unverified/quarantined.

Out of scope:
- Building real Slack/email/calendar OAuth flows in the first pass.
- Sending messages or mutating external source systems.
- Building a full graphical web app.
- Ingesting unscoped personal data.
- Putting planner/orchestrator/subagent logic inside any host adapter.

Before writing code, restate the implementation plan in 5–10 bullets and ask for confirmation.
```
