import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import { SignalSchema } from "../../artifacts/Signal.js";
import {
  DotLinkSchema,
  DotLinkRelationSchema,
  DotLinkEvidenceSchema,
} from "../../artifacts/DotLink.js";
import {
  scoreSemanticOverlap,
  scorePeopleOverlap,
  scoreTemporalProximity,
  scoreArtifactOverlap,
  classifyRelation,
} from "../../graph/scoring.js";

/**
 * link.* — candidate discovery, the five forensic scorers (used by LinkLab in
 * its scoped registry), relation classification, and link lifecycle.
 *
 * The scorers are pure and side-effect free. The lifecycle tools
 * (create/confirm/reject/quarantine) mutate the graph and are traced.
 */

const Pair = z.object({ anchorSignal: SignalSchema, candidateSignal: SignalSchema });
const ScoresSchema = z.object({
  semantic: z.number(),
  people: z.number(),
  temporal: z.number(),
  artifact: z.number(),
});

export const linkTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "link.find_candidate_links",
    description:
      "Find candidate signals that might connect to an anchor signal. Returns ids for the LinkLab to score; high recall, no judgement.",
    inputSchema: z.object({
      anchorSignalId: z.string(),
      candidateSignalIds: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      anchorSignalId: z.string(),
      candidateSignalIds: z.array(z.string()),
    }),
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignalId, candidateSignalIds }, ctx) => {
      const all = candidateSignalIds
        ? candidateSignalIds
        : ctx.store.listSignals().map((s) => s.id);
      return {
        anchorSignalId,
        candidateSignalIds: all.filter((id) => id !== anchorSignalId),
      };
    },
  }),

  defineTool({
    name: "link.score_semantic_overlap",
    description: "Score topical/semantic overlap between two signals (0..1). On its own this is a vibe, not evidence.",
    inputSchema: Pair,
    outputSchema: z.object({ score: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    rateLimitKey: "embedding",
    retryPolicy: "embedding",
    handler: async ({ anchorSignal, candidateSignal }) => ({
      score: scoreSemanticOverlap(anchorSignal, candidateSignal),
    }),
  }),

  defineTool({
    name: "link.score_people_overlap",
    description: "Score overlap of people/actors between two signals (0..1). Corroborating evidence.",
    inputSchema: Pair,
    outputSchema: z.object({ score: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignal, candidateSignal }) => ({
      score: scorePeopleOverlap(anchorSignal, candidateSignal),
    }),
  }),

  defineTool({
    name: "link.score_temporal_proximity",
    description: "Score temporal proximity (0..1) and report the distance in hours.",
    inputSchema: Pair,
    outputSchema: z.object({ score: z.number(), temporalDistanceHours: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignal, candidateSignal }) =>
      scoreTemporalProximity(anchorSignal, candidateSignal),
  }),

  defineTool({
    name: "link.score_artifact_overlap",
    description: "Score overlap of shared artifacts (docs, files, links) between two signals (0..1). Corroborating evidence.",
    inputSchema: Pair,
    outputSchema: z.object({ score: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignal, candidateSignal }) => ({
      score: scoreArtifactOverlap(anchorSignal, candidateSignal),
    }),
  }),

  defineTool({
    name: "link.classify_relation",
    description: "Classify the relation between an anchor and candidate signal given dimension scores.",
    inputSchema: Pair.extend({ scores: ScoresSchema }),
    outputSchema: z.object({ relation: DotLinkRelationSchema }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignal, candidateSignal, scores }) => ({
      relation: classifyRelation(anchorSignal, candidateSignal, scores),
    }),
  }),

  defineTool({
    name: "link.create_dot_link",
    description: "Construct a DotLink artifact from scored evidence (does not persist; use graph.add_edge / graph.commit_links).",
    inputSchema: z.object({
      sourceSignalId: z.string(),
      targetSignalId: z.string(),
      relation: DotLinkRelationSchema,
      confidence: z.number(),
      evidence: DotLinkEvidenceSchema,
      status: DotLinkSchema.shape.status,
    }),
    outputSchema: z.object({ link: DotLinkSchema }),
    consumes: ["Signal"],
    produces: ["DotLink"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (input, ctx) => ({
      link: { id: ctx.ids.next("link"), ...input },
    }),
  }),

  defineTool({
    name: "link.confirm_dot_link",
    description: "Confirm a proposed DotLink (human-approved or auto-confirmed by policy).",
    inputSchema: z.object({ linkId: z.string() }),
    outputSchema: z.object({ link: DotLinkSchema }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "graph_write",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ linkId }, ctx) => {
      const link = ctx.store.updateLink(linkId, { status: "confirmed" });
      ctx.trace.confidenceDecision({ linkId, confidence: link.confidence, decision: "confirmed" });
      return { link };
    },
  }),

  defineTool({
    name: "link.reject_dot_link",
    description: "Reject a DotLink as a false connection.",
    inputSchema: z.object({ linkId: z.string(), reason: z.string().optional() }),
    outputSchema: z.object({ link: DotLinkSchema }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "graph_write",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ linkId, reason }, ctx) => {
      const link = ctx.store.updateLink(linkId, { status: "rejected" });
      ctx.trace.confidenceDecision({
        linkId,
        confidence: link.confidence,
        decision: "rejected",
        rationale: reason,
      });
      return { link };
    },
  }),

  defineTool({
    name: "link.quarantine_weak_link",
    description: "Quarantine a weak/under-evidenced DotLink for later review.",
    inputSchema: z.object({ linkId: z.string(), reason: z.string().optional() }),
    outputSchema: z.object({ link: DotLinkSchema }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "graph_write",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ linkId, reason }, ctx) => {
      const link = ctx.store.updateLink(linkId, { status: "quarantined" });
      ctx.trace.confidenceDecision({
        linkId,
        confidence: link.confidence,
        decision: "quarantined",
        rationale: reason,
      });
      return { link };
    },
  }),
];
