/**
 * Typed error taxonomy for Constellation.
 *
 * See `Constellation Feature Specs/05-Production/Typed Error Taxonomy.md`.
 * Every failure mode in the system is one of these. Errors carry a stable
 * `code`, a `retryable` flag (consumed by the retry wrapper), and structured
 * `context` for observability.
 */

export type ConstellationErrorCode =
  | "SOURCE_AUTH"
  | "SOURCE_RATE_LIMIT"
  | "SOURCE_UNAVAILABLE"
  | "SIGNAL_PARSE"
  | "WEAK_EVIDENCE"
  | "GRAPH_CONFLICT"
  | "CONSENT_SCOPE"
  | "SUBAGENT_ISOLATION"
  | "TOOL_SCHEMA"
  | "EVALUATION_FAILURE";

export abstract class ConstellationError extends Error {
  abstract readonly code: ConstellationErrorCode;
  /** Whether the retry wrapper should consider re-attempting this operation. */
  readonly retryable: boolean = false;
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/** Connector credentials missing, expired, or invalid. */
export class SourceAuthError extends ConstellationError {
  readonly code = "SOURCE_AUTH" as const;
}

/** Source API rejected calls due to quota. Transient → retryable. */
export class SourceRateLimitError extends ConstellationError {
  readonly code = "SOURCE_RATE_LIMIT" as const;
  override readonly retryable = true;
  readonly retryAfterMs?: number;
  constructor(message: string, context: Record<string, unknown> = {}, retryAfterMs?: number) {
    super(message, context);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Transient service failure. Retryable. */
export class SourceUnavailableError extends ConstellationError {
  readonly code = "SOURCE_UNAVAILABLE" as const;
  override readonly retryable = true;
}

/** Raw source item cannot be normalized into a Signal. */
export class SignalParseError extends ConstellationError {
  readonly code = "SIGNAL_PARSE" as const;
}

/** Link confidence below the action threshold. */
export class WeakEvidenceError extends ConstellationError {
  readonly code = "WEAK_EVIDENCE" as const;
}

/** Proposed edge conflicts with confirmed graph state. */
export class GraphConflictError extends ConstellationError {
  readonly code = "GRAPH_CONFLICT" as const;
}

/** Requested source/timeframe/project exceeds user-approved scope. */
export class ConsentScopeError extends ConstellationError {
  readonly code = "CONSENT_SCOPE" as const;
}

/** A subagent requested a forbidden tool or context. */
export class SubagentIsolationError extends ConstellationError {
  readonly code = "SUBAGENT_ISOLATION" as const;
}

/** A planned input/output violates the registry schema. */
export class ToolSchemaError extends ConstellationError {
  readonly code = "TOOL_SCHEMA" as const;
}

/** An eval expected link/brief outcome was not met. */
export class EvaluationFailureError extends ConstellationError {
  readonly code = "EVALUATION_FAILURE" as const;
}

export function isConstellationError(err: unknown): err is ConstellationError {
  return err instanceof ConstellationError;
}

export function isRetryable(err: unknown): boolean {
  return isConstellationError(err) && err.retryable;
}
