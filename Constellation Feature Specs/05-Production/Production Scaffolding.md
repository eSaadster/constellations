# Production Scaffolding
#production

## Repo structure

```txt
src/
  agent/
    orchestrator.ts
    planner.ts
    contextStrategy.ts
    toolRegistry.ts
  artifacts/
    Signal.ts
    DotLink.ts
    Constellation.ts
    ContextCard.ts
  connectors/
    slack/
    email/
    calendar/
    meeting/
    docs/
  tools/
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
  subagents/
    LinkLabAgent.ts
    SourceScoutAgent.ts
  graph/
    store.ts
    cluster.ts
    scoring.ts
    provenance.ts
  safety/
    confidencePolicy.ts
    redaction.ts
    sourceScopes.ts
  observability/
    logger.ts
    traces.ts
    metrics.ts
  resilience/
    retry.ts
    rateLimit.ts
    errors.ts
  evals/
    harness.ts
    cases/
      slack_to_calendar/
      email_to_meeting/
      doc_to_thread/
      conflict_detection/
      false_friend_topic/
  tests/
    unit/
    integration/
```

## Required scaffolding

- Observability: trace every signal, score, link, graph mutation, and brief.
- Retries: exponential backoff with jitter for Slack/email/calendar/docs APIs.
- Rate limiting: per connector and embedding/search provider.
- Typed errors: see [[Typed Error Taxonomy]].
- Evaluation harness: fixture worlds with expected hidden connections.
- Tests: unit tests for scoring and integration tests for cross-channel linking.
- Deployment shape: config, env validation, database migrations, health checks, and CI.
