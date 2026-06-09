import { z } from "zod";

/**
 * DotLink — a proposed connection between two Signals.
 *
 * The product law lives here: a DotLink is *not a vibe*. Every DotLink carries
 * structured `evidence` and a `confidence`. Its `status` is governed by the
 * confidence policy (auto-confirm / propose / quarantine / reject) and never by
 * raw model assertion.
 */

export const DotLinkRelationSchema = z.enum([
  "same_topic",
  "follow_up_to",
  "mentions_meeting",
  "explains_decision",
  "duplicates_request",
  "updates_prior_context",
  "conflicts_with",
  "blocks",
  "resolves",
]);
export type DotLinkRelation = z.infer<typeof DotLinkRelationSchema>;

export const DotLinkStatusSchema = z.enum([
  "proposed",
  "confirmed",
  "rejected",
  "quarantined",
]);
export type DotLinkStatus = z.infer<typeof DotLinkStatusSchema>;

export const DotLinkEvidenceSchema = z.object({
  sharedEntities: z.array(z.string()).default([]),
  sharedPeople: z.array(z.string()).default([]),
  temporalDistanceHours: z.number(),
  quotedTextOverlap: z.array(z.string()).optional(),
  artifactOverlap: z.array(z.string()).optional(),
  /** Semantic/topical overlap score (0..1) recorded at scoring time. Optional:
   * legacy links predate the field. */
  topicalOverlap: z.number().min(0).max(1).optional(),
  rationale: z.string(),
});
export type DotLinkEvidence = z.infer<typeof DotLinkEvidenceSchema>;

export const DotLinkSchema = z.object({
  id: z.string(),
  sourceSignalId: z.string(),
  targetSignalId: z.string(),
  relation: DotLinkRelationSchema,
  confidence: z.number().min(0).max(1),
  evidence: DotLinkEvidenceSchema,
  status: DotLinkStatusSchema,
});
export type DotLink = z.infer<typeof DotLinkSchema>;

export function parseDotLink(input: unknown): DotLink {
  return DotLinkSchema.parse(input);
}

/**
 * A DotLink whose only evidence is semantic/topical overlap (no shared people,
 * no shared artifacts, large temporal gap) is a "vibe". The confidence policy
 * must keep these below the confirm threshold. This helper makes the thesis
 * testable.
 */
export function evidenceIsCorroborated(evidence: DotLinkEvidence): boolean {
  const people = evidence.sharedPeople.length > 0;
  const artifacts = (evidence.artifactOverlap?.length ?? 0) > 0;
  const quoted = (evidence.quotedTextOverlap?.length ?? 0) > 0;
  return people || artifacts || quoted;
}

/** Minimum recorded topical overlap that counts as "actually about something shared". */
export const TOPICAL_ANCHOR_MIN = 0.2;

/**
 * Does the evidence say WHAT the two signals are about together — a shared
 * entity, artifact, quote, or real topical overlap? Corroboration alone (a
 * shared person + temporal proximity) is how every coworker pair co-occurs;
 * without a topical anchor there is nothing for a human to review. Evidence
 * predating `topicalOverlap` is treated as anchored (back-compat: legacy links
 * were produced before the field existed and must not be retro-quarantined).
 */
export function evidenceHasTopicalAnchor(evidence: DotLinkEvidence): boolean {
  if (evidence.sharedEntities.length > 0) return true;
  if ((evidence.artifactOverlap?.length ?? 0) > 0) return true;
  if ((evidence.quotedTextOverlap?.length ?? 0) > 0) return true;
  return evidence.topicalOverlap === undefined || evidence.topicalOverlap >= TOPICAL_ANCHOR_MIN;
}
