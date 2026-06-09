# Constellation

> **A connection is not a vibe. It is an evidence-backed claim.**

Constellation is a personal **context-graph agent**. It does not summarize apps — it discovers *defensible* relationships between fragments of your work life (Slack, email, calendar, meeting notes, docs) and explains each connection with structured evidence and a confidence score.

This repository is the **initial production scaffold**: a deployable TypeScript/Node service with clean boundaries, fixture-backed mock connectors, a model-driven tool registry, an isolated forensic subagent, an evaluation harness, and full observability/resilience plumbing. It runs **entirely locally with no credentials**.

---

## Core artifacts

| Artifact | What it is | File |
|---|---|---|
| **Signal** | A raw ingested item (Slack/email/calendar/meeting/doc/note) with extracted facts + provenance (`sourceHash`). | `src/artifacts/Signal.ts` |
| **DotLink** | A proposed connection between two Signals, carrying `evidence` + `confidence` + `status`. | `src/artifacts/DotLink.ts` |
| **Constellation** | A cluster of connected Signals around one matter. | `src/artifacts/Constellation.ts` |
| **ContextCard** | The user-facing answer to *"what is this connected to?"* — every claim cites its Signal/DotLink ids or is marked `unverified`. | `src/artifacts/ContextCard.ts` |

All schemas are [zod](https://zod.dev) schemas (parse + infer).

---

## The product law, encoded

The thesis lives in code in two layers of defense:

1. **Scoring weights** (`src/graph/scoring.ts`): raw topical/semantic overlap is deliberately under-weighted. Corroborating *structured* evidence — shared people, shared artifacts, temporal proximity, exact entity identity — is what drives confidence. A "same words, unrelated matter" pair scores high on semantics but ~0 on corroboration, so it cannot reach the confirm threshold.
2. **Confidence policy** (`src/safety/confidencePolicy.ts`): even if confidence somehow crosses the threshold, a link with **only topical evidence is refused auto-confirmation** and demoted to `proposed` for human review.

This is verified by the `false_friend_topic` eval: the false friend lands at **confidence 0.03 → quarantined**, while a genuinely related signal confirms at **0.75**.

---

## Architecture

```
src/
  agent/
    runtime.ts          # ConstellationRuntime: ingest / connect / context-card / health
    orchestrator.ts     # generic plan executor (no per-tool branching)
    planner.ts          # builds declared tool-call plans (data, not if/else)
    contextStrategy.ts  # plan / call / evidence ledgers (long-horizon coherence)
    toolRegistry.ts     # single source of truth; generic execute() + toPiTools()
    rpcServer.ts        # JSONL RPC service (health/ingest/connect/context-card/eval)
    piModelDriver.ts    # model-driven tool selection via the Pi SDK (optional)
    jsonSchema.ts       # zod -> JSON Schema (for the model-selection seam)
  artifacts/            # Signal, DotLink, Constellation, ContextCard (zod)
  connectors/
    types.ts            # SourceConnector adapter boundary
    mock.ts, fixtures.ts# fixture-backed mock connectors
    mcporter/           # mcporter bridge (lazy, env-config, TODOs)
    composio/           # Composio connector (lazy, via mcporter)
  tools/                # ~89 tools across 12 namespaces (see below)
  subagents/
    SubagentRuntime.ts  # REAL isolation: scoped registry + sealed state
    LinkLabAgent.ts     # forensic link scoring lab
  graph/
    store.ts, memoryStore.ts, fileStore.ts, scoring.ts, provenance.ts
  safety/
    confidencePolicy.ts, sourceScopes.ts, redaction.ts
  observability/
    logger.ts (pino), traces.ts, metrics.ts
  resilience/
    errors.ts (typed taxonomy), retry.ts (backoff+jitter), rateLimit.ts (token bucket)
  interfaces/
    cli/index.ts        # the `constellation` CLI
    slack/              # pi-mom Slack bot scaffold + testable handlers
    pi/extension.ts     # optional thin Pi host adapter
  evals/
    harness.ts, run.ts, cases/{slack_to_calendar,email_to_meeting,doc_to_thread,
                               conflict_detection,false_friend_topic}.ts
  tests/                # unit + integration
```

### Tool registry — model-driven, not hand-routed

The registry (`src/agent/toolRegistry.ts`) is the **single source of truth** for ~89 tools across 12 namespaces (`slack.* email.* calendar.* meeting.* doc.* signal.* link.* graph.* constellation.* brief.* consent.* subagent.*`). Each tool carries: name, namespace, description, zod input/output schemas, `consumes`/`produces` artifact types, `sideEffects`, `riskLevel`, `requiredConsentScopes`, optional `rateLimitKey`/`retryPolicy`, and a handler.

Dispatch is **data-driven**: the orchestrator runs a declared `Plan` (an array of typed steps wired through a call ledger) and every tool is invoked through one generic `registry.execute(name, input, ctx)`. There is **no `switch(toolName)`** anywhere. `registry.toPiTools()` exposes the same registry to a real model (the Pi SDK) so an LLM can choose tools by metadata — verified by a test that asserts every entry yields a valid Pi tool def.

Chain-critical tools have real fixture-backed handlers; the rest are generated by a uniform mock-handler factory (`src/tools/breadth.ts`) so the registry scales past 50 tools without 89 bespoke bodies.

### LinkLabAgent — real isolation

`subagent.spawn_link_lab` hands a payload to `SubagentRuntime` (`src/subagents/SubagentRuntime.ts`), which runs `LinkLabAgent` in a context where:
- its registry is **scoped to exactly 5 tools** (`link.score_semantic_overlap`, `link.score_people_overlap`, `link.score_temporal_proximity`, `link.score_artifact_overlap`, `link.classify_relation`) — any other tool literally cannot resolve;
- `store`, `connectors`, and nested `subagents` are **sealed proxies** that throw `SubagentIsolationError` on any access;
- it gets a fresh id space and only the payload — no parent state;
- it returns structured output only (`proposedLinks` / `exclusions` / `inconclusive`).

### Observability, resilience, safety

- **Observability**: pino structured logs + a `Tracer` whose spans cover the six required surfaces (tool calls, RPC requests, connector calls, subagent runs, graph mutations, confidence decisions) + an in-process metrics registry. The trace hook lives in the generic executor loop and the subagent runtime, so all tools and subagent runs are traced **structurally**.
- **Resilience**: a typed error taxonomy (`ConstellationError` subclasses), `withRetry` (exponential backoff + jitter, honors `Retry-After`), and a token-bucket `RateLimiter` — applied automatically around any tool with a `retryPolicy`/`rateLimitKey` (the source connectors).
- **Safety**: confidence policy (auto-confirm / propose / quarantine), source scopes (consent gating — no implicit reads; source tools assert scope), and redaction (masks emails/phones/tokens). Constellation **never mutates external systems** — no tool performs a source write.

---

## Quick start

```bash
npm install        # installs zod + pino + dev tooling; integrations are optional deps
npm run build      # tsc -> dist/
npm test           # vitest: 63 tests
npm run eval       # run all 5 eval cases
```

> The core runs with **no API keys**. Pi SDK, `@mariozechner/pi-mom`, and `mcporter` are `optionalDependencies` loaded lazily behind adapter interfaces.

### CLI

CLI output is JSON. When piping to `jq`/`python`, use `npm run -s cli` (silent) so
npm's run-banner doesn't precede the JSON — or call `node dist/interfaces/cli/index.js <cmd>` directly.

```bash
# via tsx (dev) — or `node dist/interfaces/cli/index.js <cmd>` after build
npm run cli -- health
npm run cli -- ingest-fixtures        # ingest demo signals (persists to ./.constellation/graph.json)
npm run cli -- signals                # list ingested signals + ids
npm run cli -- connect sig_2          # connect dots for a signal
npm run cli -- context-card sig_2     # generate the evidence-cited Context Card
npm run cli -- eval                   # run all eval cases
npm run cli -- eval false_friend_topic
```

Example: `ingest-fixtures` runs **39 composable tool calls** (normalize → extract×5 → persist, per item) across the call ledger; `context-card sig_2` returns *"2 confirmed, 1 proposed, 0 quarantined connection(s)"* with 3 provenance-verified claims.

### RPC service

A JSONL RPC service over stdio (LF-framed, Pi-compatible). Protocol JSON goes to **stdout**; logs to **stderr**.

```bash
npm run rpc
# then send one JSON command per line on stdin:
{"id":"1","command":"health"}
{"id":"2","command":"ingest"}
{"id":"3","command":"connect","params":{"signalId":"sig_2"}}
{"id":"4","command":"context-card","params":{"signalId":"sig_2"}}
{"id":"5","command":"eval","params":{"caseName":"false_friend_topic"}}
```

Each response is `{"id","type":"response","command","success","data"|"error"}`.

### Model-driven path (optional, Pi SDK)

`src/agent/piModelDriver.ts` exposes the full registry to a Pi `AgentSession` via `registry.toPiTools()`, so an LLM selects tools itself. Requires `@earendil-works/pi-coding-agent` + an API key (e.g. `ANTHROPIC_API_KEY`); otherwise it raises a clear typed error. The deterministic orchestrator remains the supported offline path.

### Slack interface (optional, pi-mom)

`src/interfaces/slack/` scaffolds a Slack bot on `@mariozechner/pi-mom`'s `SlackBot` transport. The bot answers *"what is this connected to?"* on an @mention containing a Slack message link, replying with a Context Card.

```bash
export MOM_SLACK_APP_TOKEN=...   # see pi-mom Slack setup
export MOM_SLACK_BOT_TOKEN=...
npm run slack
```

The reply-building logic (`handlers.ts`) is pure and unit-tested; `piMomBot.ts` is the lazy transport adapter. See `.env.example`.

---

## Connectors (mcporter / Composio)

`SourceConnector` (`src/connectors/types.ts`) is the only thing that talks to a source. The scaffold ships **fixture-backed mocks**; real connectors implement the same interface:

- `src/connectors/mcporter/` — the bridge to MCP/Composio tool servers (lazy import of `mcporter`, env-config via `MCPORTER_*`, no hardcoded creds, wiring left as TODOs).
- `src/connectors/composio/` — `ComposioConnector` talks to Composio **through** mcporter (the five sources: Slack, Email/Gmail, Calendar, Meeting/Drive, Docs/Drive). Swapping mocks for real connectors requires no upstream change.

Set `CONSTELLATION_CONNECTOR_MODE=composio` (+ `COMPOSIO_API_KEY`) to opt in; without a key it stays on mocks.

---

## Evaluation harness

Five fixture worlds (`src/evals/cases/`). Each case asserts: expected links found (right relation + status), forbidden links **not** confirmed, confidence/status in the right band, provenance present, and **a composable tool chain occurred** (a downstream tool consumed a prior tool's structured output).

| Case | Tests |
|---|---|
| `slack_to_calendar` | Slack thread → later calendar invite (`mentions_meeting`, confirmed); noise doc rejected |
| `email_to_meeting` | Email decision → meeting transcript (`explains_decision`, confirmed) |
| `doc_to_thread` | Doc artifact anchors a Slack discussion (`same_topic`, confirmed) |
| `conflict_detection` | Meeting note contradicts a Slack plan (`conflicts_with`, confirmed) |
| `false_friend_topic` | Same word, unrelated matter → **quarantined**, while a real sibling confirms |

```bash
npm run eval                 # all cases, exits non-zero on failure (CI-friendly)
npm run eval -- false_friend_topic
```

---

## Testing

```bash
npm test
```

- **Unit**: artifact schemas, tool registry (+ `toPiTools` seam + scoped registry), confidence policy, LinkLab scoped isolation, graph store, resilience (backoff/retry/rate-limit).
- **Integration**: ingest fixtures, connect Slack→email/calendar/doc, generate Context Card, false-friend quarantine, RPC command flow, Slack handler.

---

## Design notes & decisions

- **`src/` layout** (this repo) follows the build brief; the spec's `.pi/src/constellation/` layout is an alternative host-embedded shape.
- **Deterministic core**: everything CLI/RPC/evals/tests touch runs without an LLM, by design — the model-driven path is additive.
- **Stable ids + fixed clock** are injectable (`src/util/ids.ts`) for reproducible evals.
- Typed error taxonomy, retry, and rate limiting are wired around the connector boundary via registry metadata, not ad-hoc per call.

---

*Constellation says: "This may connect to these things, because…" — and always shows its evidence.*
