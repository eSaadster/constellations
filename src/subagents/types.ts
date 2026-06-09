import type { Signal } from "../artifacts/Signal.js";
import type { DotLink, DotLinkRelation } from "../artifacts/DotLink.js";
import type { ConfidenceThresholds } from "../safety/confidencePolicy.js";

/**
 * Subagent boundary types.
 *
 * Subagents run in an isolated context with a scoped tool registry and no access
 * to parent state. They receive a structured payload and return structured
 * output only. See `subagents/SubagentRuntime.ts` for enforcement.
 */

export interface LinkLabInput {
  anchorSignal: Signal;
  candidateSignals: Signal[];
  allowedRelations: DotLinkRelation[];
  thresholdPolicy: ConfidenceThresholds;
}

export interface LinkLabExclusion {
  candidateSignalId: string;
  reason: string;
}

export interface LinkLabInconclusive {
  candidateSignalId: string;
  missingEvidence: string[];
}

export interface LinkLabResult {
  proposedLinks: DotLink[];
  exclusions: LinkLabExclusion[];
  inconclusive: LinkLabInconclusive[];
}

/** The list of tools a subagent is permitted to call. */
export const LINK_LAB_ALLOWED_TOOLS = [
  "link.score_semantic_overlap",
  "link.score_people_overlap",
  "link.score_temporal_proximity",
  "link.score_artifact_overlap",
  "link.classify_relation",
] as const;

export interface SubagentRuntime {
  /**
   * Spawn the LinkLabAgent in an isolated, scoped context. Returns structured
   * output only — the parent never sees the subagent's internal context.
   */
  runLinkLab(input: LinkLabInput): Promise<LinkLabResult>;
}
