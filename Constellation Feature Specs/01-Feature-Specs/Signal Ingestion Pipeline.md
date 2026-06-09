# Signal Ingestion Pipeline
#feature-spec

## Summary

Normalize raw work items from Slack, email, calendar, meetings, docs, and notes into durable Signal artifacts with extraction and provenance.

## 1. User flow & states

- Entry: source sync, manual import, or on-demand lookup.
- States: raw item fetched → scoped consent checked → normalized → extracted → deduped → stored → indexed.
- Exit: Signal available to graph/search.
- Failure: auth failure, parse failure, duplicate collision, privacy redaction.

## 2. Information architecture

- Surfaces: source settings, ingestion logs, signal detail page.
- Discovery: by source, actor, project, artifact, date, extraction field.

## 3. Data model

- Main entity: Signal.
- Supporting tables: `source_accounts`, `ingestion_runs`, `full_text_refs`, `signal_embeddings`.
- Constraint: `(source, externalId)` unique.
- Provenance: source hash, ingestedBy, ingestedAt.

## 4. Permissions & access control

- Read source only within consent scope.
- Store redacted fields when source policy requires it.
- Tenant boundary by user/workspace.

## 5. API/integration surface

- `slack.fetch_thread`, `email.read_thread`, `calendar.read_event`, `meeting.ingest_transcript`, `doc.read_doc`.
- `signal.normalize_signal`, `signal.create_signal`, `signal.dedupe_signal`.

## 6. Embedding in current codebase

- `src/connectors/*`
- `src/tools/signal/*`
- `src/resilience/retry.ts`
- `src/resilience/rateLimit.ts`
- Tests: connector mocks; parse fixtures; dedupe unit tests.

## 7. UX/design states

- Source connected/disconnected.
- Sync in progress.
- Partial ingestion with warnings.
- Redacted signal state.
- Duplicate merged state.
