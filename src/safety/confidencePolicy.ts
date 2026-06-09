import type { DotLinkEvidence, DotLinkStatus } from "../artifacts/DotLink.js";
import { evidenceIsCorroborated } from "../artifacts/DotLink.js";

/**
 * Confidence policy — the safety gate that turns a score into a status.
 *
 * Product law: "A connection is not a vibe. It is an evidence-backed claim."
 *
 * Two defenses keep vibes out of the confirmed set:
 *   1. `scoring.aggregateConfidence` weights corroborating structured evidence
 *      (shared people / artifacts / temporal proximity) far above raw semantic
 *      overlap, so a same-words/unrelated-matter pair cannot reach the confirm
 *      threshold on topic similarity alone.
 *   2. THIS policy refuses to auto-confirm any link whose evidence is not
 *      corroborated — even if its confidence somehow crosses the threshold.
 *      Such a link is demoted to `proposed` for human review.
 *
 * Bands:
 *   confidence >= autoConfirmAbove  AND corroborated  -> confirmed
 *   confidence >= autoConfirmAbove  AND NOT corroborated -> proposed (vibe guard)
 *   quarantineBelow <= confidence < autoConfirmAbove -> proposed
 *   confidence < quarantineBelow -> quarantined
 *
 * The policy NEVER returns "rejected" automatically; rejection is a human/
 * orchestrator action. And it never implies mutating an external system.
 */

export interface ConfidenceThresholds {
  autoConfirmAbove: number;
  quarantineBelow: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  autoConfirmAbove: 0.6,
  quarantineBelow: 0.35,
};

export interface ConfidenceDecision {
  status: DotLinkStatus;
  reason: string;
  corroborated: boolean;
}

export function decideLinkStatus(
  confidence: number,
  evidence: DotLinkEvidence,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceDecision {
  const corroborated = evidenceIsCorroborated(evidence);

  if (confidence < thresholds.quarantineBelow) {
    return {
      status: "quarantined",
      corroborated,
      reason: `confidence ${confidence.toFixed(2)} < quarantineBelow ${thresholds.quarantineBelow}`,
    };
  }

  if (confidence >= thresholds.autoConfirmAbove) {
    if (corroborated) {
      return {
        status: "confirmed",
        corroborated,
        reason: `confidence ${confidence.toFixed(2)} >= autoConfirmAbove with corroborating evidence`,
      };
    }
    return {
      status: "proposed",
      corroborated,
      reason: `confidence ${confidence.toFixed(
        2,
      )} is high but evidence is topical-only (no shared people/artifacts/quotes); not auto-confirmed`,
    };
  }

  return {
    status: "proposed",
    corroborated,
    reason: `confidence ${confidence.toFixed(2)} in review band [${thresholds.quarantineBelow}, ${thresholds.autoConfirmAbove})`,
  };
}

/** The middle "propose" band — useful for UIs that surface review queues. */
export function isInReviewBand(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return confidence >= thresholds.quarantineBelow && confidence < thresholds.autoConfirmAbove;
}
