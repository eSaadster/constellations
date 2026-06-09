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
