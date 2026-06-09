# Seven Dimension Implementation Map
#feature-spec #pi-ai #pi-core-ai

Use this as the build checklist for every Constellation feature implemented on **pi-core-ai**. Host adapters expose the feature; pi-core-ai owns autonomous runtime behavior.

## 1. User flow & states

### Scaffold files

```txt
.pi/src/constellation/core/flows/
  connectContextFlow.ts
  meetingPrepFlow.ts
  dailyDigestFlow.ts
  state.ts
```

### State model

```ts
type FlowState =
  | "idle"
  | "scope_checking"
  | "source_reading"
  | "signal_normalizing"
  | "candidate_finding"
  | "subagent_scoring"
  | "graph_updating"
  | "brief_generating"
  | "completed"
  | "failed"
  | "quarantined";
```

### Required transitions

`entry → consent check → source read → Signal creation → candidate discovery → LinkLabAgent → graph mutation decision → Constellation update → brief/card output → audit trace`

Entry conditions:
- A user task, anchor source item, scheduled digest trigger, or meeting-prep event.

Exit conditions:
- Structured `ContextCard`, `MeetingPrepBrief`, or `DailyDotDigest` returned.
- No irreversible source-system mutations.

Failure/retry states:
- Source auth failure.
- Rate limit retry with exponential backoff.
- Weak evidence quarantine.
- Subagent isolation violation.

## 2. Information architecture

### Scaffold files

```txt
.pi/src/constellation/pi-adapter/surfaces/
  contextCard.ts
  meetingPrep.ts
  dotDigest.ts
  graphExplorer.ts
```

### Surfaces

- Host-rendered output for context cards and digests; Pi is one optional host.
- Obsidian vault specs: planning and implementation documentation.
- Optional future UI: source item side panel, graph explorer, review queue.

### Discovery paths

- User asks Pi: “what is this connected to?”
- Scheduled pre-meeting job invokes meeting prep.
- Daily digest command invokes `brief.generate_daily_dot_digest`.
- Review queue exposes proposed/quarantined DotLinks.

## 3. Data model

### Scaffold files

```txt
.pi/src/constellation/domain/artifacts/
  Signal.ts
  DotLink.ts
  Constellation.ts
  ContextCard.ts
.pi/src/constellation/domain/storage/
  store.ts
  migrations.ts
```

### Core entities

- `Signal`: normalized source item with extracted fields and provenance.
- `DotLink`: evidence-backed connection between signals.
- `Constellation`: cluster of connected signals around one matter.
- `ContextCard`: generated brief with claim-level citations.

### Constraints

- `(source, externalId)` unique for Signal.
- DotLink confidence in `[0, 1]`.
- Every user-visible claim cites `signalIds` or `linkIds`.
- Tenant/workspace/user scope must be part of every persistence key.

### Ownership/privacy

- Store only consented source data.
- Redact signals when source scope requires it.
- Preserve deletion hooks for source disconnect or user deletion.

## 4. Permissions & access control

### Scaffold files

```txt
.pi/src/constellation/domain/safety/
  sourceScopes.ts
  permissions.ts
  redaction.ts
  confidencePolicy.ts
```

### Actors

- User: can read approved sources and request briefs.
- Parent agent: can orchestrate reads, scoring, graph mutation decisions.
- LinkLabAgent: can only compare provided signals with scoped link tools.
- Source connectors: can read only explicitly consented source scopes.

### Permission matrix

| Actor | Read sources | Read graph | Write graph | Spawn subagent | Send external messages |
|---|---:|---:|---:|---:|---:|
| User | scoped | yes | corrections | yes | opt-in only |
| Parent agent | scoped | yes | policy-gated | yes | no by default |
| LinkLabAgent | no | provided payload only | no | no | no |
| Connector | its source only | no | no | no | no |

## 5. API / integration surface

### Scaffold files

```txt
.pi/src/constellation/core/tools/
  slack/
  email/
  calendar/
  meeting/
  doc/
  signal/
  link/
  graph/
  constellation/
  brief/
  consent/
  subagent/
.pi/src/constellation/core/toolRegistry.ts
.pi/src/constellation/pi-adapter/tool.ts
```

### Runtime and optional host-adapter contract

```ts
type ConstellationToolInput = {
  task: string;
  anchor?: SourceAnchor;
  scopes: SourceScope[];
  mode?: "context_card" | "meeting_prep" | "daily_digest" | "graph_update";
  dryRun?: boolean;
};

type ConstellationToolOutput = {
  mode: string;
  result: ContextCard | MeetingPrepBrief | DailyDotDigest | GraphUpdateSummary;
  traceId: string;
  evidence: EvidenceReference[];
  quarantined?: DotLink[];
};
```

### Side effects

- Source reads.
- Local graph writes, if not dry-run and confidence policy passes.
- Audit logs and eval traces.
- No source-system writes by default.

## 6. Embedding in current codebase

### Optional Pi host-adapter style references

- `.pi/extensions/workflow.ts` — optional thin Pi host registration reference.
- `.pi/src/workflow-tool.ts` — `defineTool` wrapper and display integration.
- `.pi/src/workflow.ts` — deterministic orchestration primitives.
- `.pi/src/agent.ts` — subagent execution boundary.
- `.pi/src/display.ts` — TUI snapshot rendering pattern.

### New files to add

```txt
.pi/extensions/constellation.ts
.pi/src/constellation/index.ts
.pi/src/constellation/pi-adapter/tool.ts
.pi/src/constellation/orchestrator.ts
.pi/src/constellation/planner.ts
.pi/src/constellation/contextStrategy.ts
.pi/src/constellation/core/toolRegistry.ts
.pi/src/constellation/subagents/LinkLabAgent.ts
.pi/src/constellation/resilience/retry.ts
.pi/src/constellation/resilience/rateLimit.ts
.pi/src/constellation/resilience/errors.ts
.pi/src/constellation/observability/traces.ts
.pi/src/constellation/evals/harness.ts
```

### Backwards compatibility

- Additive runtime/application only.
- If adding the optional Pi host adapter, do not modify existing `workflow` behavior.
- Reuse workflow-style registration, schema validation, labels, and status display only if adding the optional Pi adapter.
- Keep planning, execution, context ledgers, and subagent isolation inside pi-core-ai runtime code.

## 7. UX / design states

### Scaffold files

```txt
.pi/src/constellation/pi-adapter/display.ts
.pi/src/constellation/pi-adapter/renderers/
  contextCardRenderer.ts
  digestRenderer.ts
  meetingPrepRenderer.ts
  traceRenderer.ts
```

### States to render

- Loading: show current phase and source being processed.
- Partial: show available evidence and list skipped sources.
- Empty: “No strong connections found in approved scopes.”
- Low confidence: separate “possible connections” from confirmed connections.
- Error: source-specific auth/rate-limit/schema failure with recovery hint.
- Completed: provenance-backed card with why/evidence/open asks/decisions.

### Responsive/accessibility notes

- TUI output should be readable as plain text.
- Evidence should be grouped under headings, not color-only.
- Confidence labels should include numeric confidence and status text.
