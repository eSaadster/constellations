import type { ToolRegistry, ToolContext } from "../agent/toolRegistry.js";
import type { Signal } from "../artifacts/Signal.js";
import type { DotLink } from "../artifacts/DotLink.js";
import { aggregateConfidence, buildEvidence, type DimensionScores } from "../graph/scoring.js";
import { normalizePersonKey } from "../graph/discriminative.js";
import { sameSeries, seriesKeyOf } from "../graph/series.js";
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
  const { anchorSignal, candidateSignals, allowedRelations, thresholdPolicy, ubiquitousPeople } =
    input;
  const { registry, ctx } = deps;

  // Graph-ubiquitous people (parent-computed; the lab is sealed) are not
  // evidence — normalized once, threaded into the people scorer + evidence.
  const ignorePeople: ReadonlySet<string> = new Set(ubiquitousPeople.map(normalizePersonKey));

  // Proposals carry their candidate so cross-series fan-out can be collapsed
  // after the loop (one logical claim per series, kept at its best instance).
  const proposals: Array<{ link: DotLink; candidate: Signal }> = [];
  const exclusions: LinkLabExclusion[] = [];
  const inconclusive: LinkLabInconclusive[] = [];

  for (const candidate of candidateSignals) {
    // Instances of the same recurring series are scheduling structure, not
    // insight ("Daily Huddle resembles Daily Huddle" was 89% of the live
    // graph's confirmed links) — never scored, never stored. Pure derivation
    // from the candidate Signal, so the isolation seal stays intact.
    if (sameSeries(anchorSignal, candidate)) {
      exclusions.push({
        candidateSignalId: candidate.id,
        reason: "same recurring series — scheduling structure, not insight",
      });
      continue;
    }

    const pair = { anchorSignal, candidateSignal: candidate };

    // Call the five scoped tools through the generic executor (traced).
    const semantic = (await registry.execute<typeof pair, { score: number }>(
      "link.score_semantic_overlap",
      pair,
      ctx,
    )).score;
    const peoplePair = { ...pair, ignorePeople: [...ignorePeople] };
    const people = (await registry.execute<typeof peoplePair, { score: number }>(
      "link.score_people_overlap",
      peoplePair,
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
      ignorePeople,
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

    proposals.push({
      link: {
        id: ctx.ids.next("link"),
        sourceSignalId,
        targetSignalId,
        relation: finalRelation,
        confidence: Math.round(confidence * 1000) / 1000,
        evidence,
        status: decision.status,
      },
      candidate,
    });

    ctx.trace.confidenceDecision({
      confidence,
      decision: decision.status,
      rationale: decision.reason,
    });
  }

  // Collapse cross-series fan-out: an anchor that matches N instances of one
  // recurring series carries ONE insight, not N parallel links (measured live:
  // ~890 of 2,638 links were duplicate cross-series fan-out). Keep the
  // best-confidence instance per (series, relation); demote the rest.
  const bestByNode = new Map<string, DotLink>();
  for (const { link, candidate } of proposals) {
    const key = `${seriesKeyOf(candidate) ?? candidate.id}|${link.relation}`;
    const incumbent = bestByNode.get(key);
    if (!incumbent || link.confidence > incumbent.confidence) bestByNode.set(key, link);
  }
  const winners = new Set([...bestByNode.values()].map((l) => l.id));
  const proposedLinks: DotLink[] = [];
  for (const { link, candidate } of proposals) {
    if (winners.has(link.id)) {
      proposedLinks.push(link);
    } else {
      exclusions.push({
        candidateSignalId: candidate.id,
        reason: `collapsed into best instance of recurring series "${seriesKeyOf(candidate)}"`,
      });
    }
  }

  return { proposedLinks, exclusions, inconclusive };
}

/** Convenience: filter the candidate signals from a store-less payload by id. */
export function selectCandidates(all: Signal[], ids: string[]): Signal[] {
  const set = new Set(ids);
  return all.filter((s) => set.has(s.id));
}
