import type { SignalSource } from "../artifacts/Signal.js";
import { ConsentScopeError } from "../resilience/errors.js";

/**
 * Source scopes — the consent boundary.
 *
 * A SourceScope is an explicit, user-approved grant to read a source (optionally
 * narrowed to a workspace / project / timeframe). Connectors and source-reading
 * tools MUST pass through `assertSourceAllowed` before touching a source. There
 * is no implicit "read everything"; an empty scope list grants nothing.
 */

export interface SourceScope {
  source: SignalSource | string;
  workspaceId?: string;
  projectId?: string;
  /** Free-form timeframe label, e.g. "last_30_days" or an ISO interval. */
  timeframe?: string;
}

export interface SourceAccessRequest {
  source: SignalSource | string;
  workspaceId?: string;
  projectId?: string;
}

export function isSourceAllowed(
  scopes: SourceScope[],
  request: SourceAccessRequest,
): boolean {
  return scopes.some((scope) => {
    if (scope.source !== request.source) return false;
    if (scope.workspaceId && request.workspaceId && scope.workspaceId !== request.workspaceId) {
      return false;
    }
    if (scope.projectId && request.projectId && scope.projectId !== request.projectId) {
      return false;
    }
    return true;
  });
}

export function assertSourceAllowed(
  scopes: SourceScope[],
  request: SourceAccessRequest,
): void {
  if (!isSourceAllowed(scopes, request)) {
    throw new ConsentScopeError(
      `source access not in approved scope: ${request.source}`,
      { request, approvedSources: scopes.map((s) => s.source) },
    );
  }
}

/** Audit record produced by `consent.audit_access`. */
export interface AccessAuditEntry {
  source: string;
  workspaceId?: string;
  projectId?: string;
  allowed: boolean;
  at: string;
}
