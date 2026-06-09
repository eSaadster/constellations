import { z } from "zod";

/**
 * ContextCard — the user-facing answer to "what is this connected to?".
 *
 * A Context Card is the presentation artifact. Its invariant: every claim cites
 * the Signal/DotLink ids that support it, or it is marked `unverified`. This is
 * the surface where "a connection is not a vibe" becomes visible to the user.
 */

export const CitedClaimSchema = z.object({
  claim: z.string(),
  signalIds: z.array(z.string()).default([]),
  linkIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["verified", "unverified", "quarantined"]),
});
export type CitedClaim = z.infer<typeof CitedClaimSchema>;

export const ContextCardConnectionSchema = z.object({
  linkId: z.string(),
  targetSignalId: z.string(),
  relation: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.string(),
  rationale: z.string(),
  evidenceSummary: z.string(),
});
export type ContextCardConnection = z.infer<typeof ContextCardConnectionSchema>;

export const ContextCardSchema = z.object({
  id: z.string(),
  anchorSignalId: z.string(),
  title: z.string(),
  generatedAt: z.string().describe("ISO-8601 timestamp"),
  summary: z.string(),
  connections: z.array(ContextCardConnectionSchema).default([]),
  claims: z.array(CitedClaimSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  asks: z.array(z.string()).default([]),
  provenanceTraceId: z.string().optional(),
});
export type ContextCard = z.infer<typeof ContextCardSchema>;

export function parseContextCard(input: unknown): ContextCard {
  return ContextCardSchema.parse(input);
}
