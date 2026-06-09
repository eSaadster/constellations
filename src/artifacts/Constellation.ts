import { z } from "zod";

/**
 * Constellation — a cluster of connected Signals around one underlying matter.
 *
 * A Constellation is assembled from confirmed/proposed DotLinks. Its
 * provenance records exactly which links produced it and any user corrections,
 * so the cluster can always be explained and audited.
 */

export const ConstellationProvenanceSchema = z.object({
  createdFromLinkIds: z.array(z.string()).default([]),
  userCorrections: z.array(z.string()).default([]),
});
export type ConstellationProvenance = z.infer<typeof ConstellationProvenanceSchema>;

export const ConstellationSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  signalIds: z.array(z.string()).default([]),
  linkIds: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  asks: z.array(z.string()).default([]),
  lastActivityAt: z.string().describe("ISO-8601 timestamp"),
  confidence: z.number().min(0).max(1),
  provenance: ConstellationProvenanceSchema,
});
export type Constellation = z.infer<typeof ConstellationSchema>;

export function parseConstellation(input: unknown): Constellation {
  return ConstellationSchema.parse(input);
}
