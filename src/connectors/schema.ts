import { z } from "zod";
import { SignalSourceSchema, ExtractedFactsSchema } from "../artifacts/Signal.js";

export const RawSourceItemSchema = z.object({
  source: SignalSourceSchema,
  externalId: z.string(),
  url: z.string().optional(),
  actorIds: z.array(z.string()).default([]),
  timestamp: z.string(),
  title: z.string().optional(),
  text: z.string(),
  raw: z.record(z.unknown()).optional(),
  extractedHints: ExtractedFactsSchema.partial().optional(),
});

export const ConnectorQuerySchema = z.object({
  query: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().optional(),
  containerId: z.string().optional(),
});
