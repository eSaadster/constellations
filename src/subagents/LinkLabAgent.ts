import type { ToolRegistry, ToolContext } from "../agent/toolRegistry.js";
import type { Signal } from "../artifacts/Signal.js";
import type { DotLink } from "../artifacts/DotLink.js";
import { aggregateConfidence, buildEvidence, type DimensionScores } from "../graph/scoring.js";
import { decideLinkStatus } from "../safety/confidencePolicy.js";
import { evidenceIsCorroborated } from "../artifacts/DotLink.js";
import type {
  LinkLabInput,
  LinkLabResult,
  LinkLabExclusion,
  LinkLabInconclusive,
} from "./types.js";

/**
 * LinkLabAgent — a forensic comparison lab for DotLink proposals.
 *
 * Runs entirely inside the isolated subagent context provided by the runtime.
 * It calls ONLY its five scoped scoring/classification tools (through the
 * scoped registry's generic executor) and assembles structured output. It never
 * touches the graph, sources, or parent state.
 *
 * Bucketing encodes the product thesis:
 *   - exclusions:   no shared topic/people/artifacts at all → not worth a link.
 *   - inconclusive: enough confidence to be in the action band, but corroboration
 *                   is absent (a "vibe" riding temporal/semantic). We refuse to
 *                   even propose it without people/artifact evidence.
 *   - proposedLinks: everything else, each with a status from the confidence
 *                   policy (confirmed / proposed / quarantined). The false-friend
 *                   case (high semantic, zero corroboration) lands as quarantined.
 */
export async function runLinkLab(
  input: LinkLabInput,
  deps: { registry: ToolRegistry; ctx: ToolContext },
): Promise<LinkLabResult> {
  const { anchorSignal, candidateSignals, allowedRelations, thresholdPolicy } = input;
  const { registry, ctx } = deps;

  const proposedLinks: DotLink[] = [];
  const exclusions: LinkLabExclusion[] = [];
  const inconclusive: LinkLabInconclusive[] = [];

  for (const candidate of candidateSignals) {
    const pair = { anchorSignal, candidateSignal: candidate };

    // Call the five scoped tools through the generic executor (traced).
    const semantic = (await registry.execute<typeof pair, { score: number }>(
      "link.score_semantic_overlap",
      pair,
      ctx,
    )).score;
    const people = (await registry.execute<typeof pair, { score: number }>(
      "link.score_people_overlap",
      pair,
      ctx,
    )).score;
    const temporalResult = await registry.execute<
      typeof pair,
      { score: number; temporalDistanceHours: number }
    >("link.score_temporal_proximity", pair, ctx);
    const artifact = (await registry.execute<typeof pair, { score: number }>(
      "link.score_artifact_overlap",
      pair,
      ctx,
    )).score;

    const scores: DimensionScores = {
      semantic,
      people,
      temporal: temporalResult.score,
      artifact,
    };

    // No shared anything → exclude outright.
    if (semantic < 0.08 && people === 0 && artifact === 0) {
      exclusions.push({
        candidateSignalId: candidate.id,
        reason: "no shared topic, people, or artifacts",
      });
      continue;
    }

    const { relation } = await registry.execute<
      typeof pair & { scores: DimensionScores },
      { relation: DotLink["relation"] }
    >("link.classify_relation", { ...pair, scores }, ctx);

    const confidence = aggregateConfidence(scores);
    const evidence = buildEvidence(
      anchorSignal,
      candidate,
      scores,
      temporalResult.temporalDistanceHours,
    );
    const corroborated = evidenceIsCorroborated(evidence);

    // In the action band but uncorroborated → inconclusive, do not propose.
    if (confidence >= thresholdPolicy.quarantineBelow && !corroborated) {
      inconclusive.push({
        candidateSignalId: candidate.id,
        missingEvidence: ["sharedPeople", "artifactOverlap", "quotedTextOverlap"],
      });
      continue;
    }

    const decision = decideLinkStatus(confidence, evidence, thresholdPolicy);

    // Respect the caller's allowed-relation whitelist.
    const finalRelation = allowedRelations.includes(relation) ? relation : "same_topic";

    // Direction: earlier signal is the source.
    const anchorFirst = Date.parse(anchorSignal.timestamp) <= Date.parse(candidate.timestamp);
    const [sourceSignalId, targetSignalId] = anchorFirst
      ? [anchorSignal.id, candidate.id]
      : [candidate.id, anchorSignal.id];

    proposedLinks.push({
      id: ctx.ids.next("link"),
      sourceSignalId,
      targetSignalId,
      relation: finalRelation,
      confidence: Math.round(confidence * 1000) / 1000,
      evidence,
      status: decision.status,
    });

    ctx.trace.confidenceDecision({
      confidence,
      decision: decision.status,
      rationale: decision.reason,
    });
  }

  return { proposedLinks, exclusions, inconclusive };
}

/** Convenience: filter the candidate signals from a store-less payload by id. */
export function selectCandidates(all: Signal[], ids: string[]): Signal[] {
  const set = new Set(ids);
  return all.filter((s) => set.has(s.id));
}
