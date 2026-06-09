# Typed Error Taxonomy
#production

```ts
type ConstellationError =
  | SourceAuthError
  | SourceRateLimitError
  | SourceUnavailableError
  | SignalParseError
  | WeakEvidenceError
  | GraphConflictError
  | ConsentScopeError
  | SubagentIsolationError
  | ToolSchemaError
  | EvaluationFailureError;
```

## Error classes

- `SourceAuthError`: connector credentials missing, expired, or invalid.
- `SourceRateLimitError`: source API rejects calls due to quota.
- `SourceUnavailableError`: transient service failure.
- `SignalParseError`: raw source item cannot be normalized into Signal.
- `WeakEvidenceError`: link confidence below action threshold.
- `GraphConflictError`: proposed edge conflicts with confirmed graph state.
- `ConsentScopeError`: requested source/timeframe/project exceeds user-approved scope.
- `SubagentIsolationError`: subagent requested forbidden tool or context.
- `ToolSchemaError`: planned input/output violates registry schema.
- `EvaluationFailureError`: eval expected link/brief outcome not met.
