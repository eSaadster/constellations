import { z } from "zod";

/**
 * Signal — a raw ingested item from Slack/email/calendar/meeting/doc/note.
 *
 * A Signal is the atomic unit of the context graph. Everything downstream
 * (DotLinks, Constellations, Context Cards) traces back to Signals via
 * provenance. A Signal is never invented by the model; it is always derived
 * from a real source item with a `sourceHash`.
 */

export const SignalSourceSchema = z.enum([
  "slack",
  "email",
  "calendar",
  "meeting_transcript",
  "doc",
  "note",
]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

export const ExtractedFactsSchema = z.object({
  entities: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  dates: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  asks: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
});
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

export const SignalProvenanceSchema = z.object({
  ingestedBy: z.string(),
  ingestedAt: z.string().describe("ISO-8601 timestamp"),
  sourceHash: z.string().describe("Stable hash of the raw source item"),
});
export type SignalProvenance = z.infer<typeof SignalProvenanceSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  source: SignalSourceSchema,
  externalId: z.string(),
  url: z.string().optional(),
  actorIds: z.array(z.string()).default([]),
  timestamp: z.string().describe("ISO-8601 timestamp of the source event"),
  title: z.string().optional(),
  excerpt: z.string(),
  fullTextRef: z.string().optional().describe("Reference (not inline body) to full text"),
  extracted: ExtractedFactsSchema,
  provenance: SignalProvenanceSchema,
});
export type Signal = z.infer<typeof SignalSchema>;

export function parseSignal(input: unknown): Signal {
  return SignalSchema.parse(input);
}

export function isSignal(input: unknown): input is Signal {
  return SignalSchema.safeParse(input).success;
}
