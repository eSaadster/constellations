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
import { discriminativeCeiling, normalizePersonKey } from "../../graph/discriminative.js";
import { sameSeries } from "../../graph/series.js";

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

/** Candidate-blocking temporal window: pairs this close in time are always
 * worth scoring even with no shared facts (e.g. a thread and the meeting it
 * spawned). */
const BLOCKING_WINDOW_MS = 48 * 3_600_000;

// Blocking features deliberately span ALL extracted facts (people + entities +
// projects + artifacts) for recall; the SCORING-side ubiquity filter
// (graph/discriminative.ts) is people-only because evidence.sharedPeople and
// the people dimension are built from actorIds ∪ extracted.people.
function blockingFeatures(s: {
  actorIds: string[];
  extracted: { people: string[]; entities: string[]; projects: string[]; artifacts: string[] };
}): string[] {
  return [
    ...s.actorIds,
    ...s.extracted.people,
    ...s.extracted.entities,
    ...s.extracted.projects,
    ...s.extracted.artifacts,
  ].map((f) => f.toLowerCase());
}

export const linkTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "link.find_candidate_links",
    description:
      "Find candidate signals that might connect to an anchor signal. High recall with cheap blocking: keeps candidates that share a discriminative person/entity/project/artifact with the anchor or sit within a 48h window — pairs that share nothing and are far apart in time can never confirm (the corroboration policy refuses them), so scoring them is pure waste.",
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
      // An explicit candidate list is respected verbatim (caller's judgement).
      if (candidateSignalIds) {
        return {
          anchorSignalId,
          candidateSignalIds: candidateSignalIds.filter((id) => id !== anchorSignalId),
        };
      }
      const all = ctx.store.listSignals();
      const anchor = ctx.store.getSignal(anchorSignalId);
      if (!anchor) return { anchorSignalId, candidateSignalIds: [] };

      // Document frequency per feature, so ubiquitous features (the graph
      // owner's email on every message, a generic entity) don't match
      // everything to everything.
      const df = new Map<string, number>();
      for (const s of all) {
        for (const f of new Set(blockingFeatures(s))) df.set(f, (df.get(f) ?? 0) + 1);
      }
      const ceiling = discriminativeCeiling(all.length);
      const anchorFeatures = new Set(
        blockingFeatures(anchor).filter((f) => (df.get(f) ?? 0) <= ceiling),
      );
      const anchorT = Date.parse(anchor.timestamp);

      const kept = all.filter((s) => {
        if (s.id === anchorSignalId) return false;
        // Same recurring series: scheduling structure, never an insight — and
        // daily siblings would otherwise always pass the 48h window below.
        if (sameSeries(anchor, s)) return false;
        const t = Date.parse(s.timestamp);
        if (
          Number.isFinite(anchorT) &&
          Number.isFinite(t) &&
          Math.abs(t - anchorT) <= BLOCKING_WINDOW_MS
        ) {
          return true;
        }
        return blockingFeatures(s).some((f) => anchorFeatures.has(f));
      });
      return { anchorSignalId, candidateSignalIds: kept.map((s) => s.id) };
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
    description:
      "Score overlap of people/actors between two signals (0..1). Corroborating evidence. `ignorePeople` lists graph-ubiquitous people (e.g. the owner) that must not count as overlap.",
    inputSchema: Pair.extend({ ignorePeople: z.array(z.string()).default([]) }),
    outputSchema: z.object({ score: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignal, candidateSignal, ignorePeople }) => ({
      score: scorePeopleOverlap(
        anchorSignal,
        candidateSignal,
        new Set(ignorePeople.map(normalizePersonKey)),
      ),
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
