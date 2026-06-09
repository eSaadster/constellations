import type { Signal } from "../artifacts/Signal.js";
import type { DotLink, DotLinkRelation, DotLinkStatus } from "../artifacts/DotLink.js";
import { createConstellationRuntime } from "../agent/runtime.js";
import { MemoryGraphStore } from "../graph/memoryStore.js";
import { MockConnectorRegistry } from "../connectors/mock.js";
import { IdGenerator, fixedClock } from "../util/ids.js";

/**
 * Evaluation harness.
 *
 * Each case asserts the things that make a connection trustworthy:
 *   - expected links are found with the correct relation + status,
 *   - forbidden links are NOT confirmed (false-positive guard),
 *   - confidence/status land in the right band,
 *   - provenance is present (evidence + cited claims),
 *   - at least one composable tool chain occurred (a downstream tool consumed a
 *     prior tool's structured output).
 *
 * Cases run fully offline against the fixture-backed runtime.
 */

export interface ExpectedLink {
  a: string;
  b: string;
  relation: DotLinkRelation;
  status: DotLinkStatus;
}

export interface ForbiddenLink {
  a: string;
  b: string;
}

export interface EvalCase {
  id: string;
  description: string;
  prompt: string;
  fixtures: Signal[];
  anchorId: string;
  expectedLinks: ExpectedLink[];
  forbiddenLinks: ForbiddenLink[];
  /** Pairs that should end up quarantined (or excluded) — the vibe guard. */
  expectedQuarantined?: ForbiddenLink[];
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface EvalResult {
  caseId: string;
  passed: boolean;
  checks: EvalCheck[];
  metrics: {
    toolCalls: number;
    chainOccurred: boolean;
    confirmed: number;
    proposed: number;
    quarantined: number;
  };
}

function samePair(link: { sourceSignalId: string; targetSignalId: string }, a: string, b: string): boolean {
  return (
    (link.sourceSignalId === a && link.targetSignalId === b) ||
    (link.sourceSignalId === b && link.targetSignalId === a)
  );
}

export async function runEvalCase(evalCase: EvalCase): Promise<EvalResult> {
  // Isolated, deterministic runtime: empty connectors (signals injected directly),
  // fixed clock + id generator for reproducibility.
  const runtime = createConstellationRuntime({
    store: new MemoryGraphStore(),
    connectors: new MockConnectorRegistry({}),
    ids: new IdGenerator(evalCase.id),
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
  });
  runtime.addSignals(evalCase.fixtures);

  const { contextCard, linkResult, snapshot } = await runtime.generateContextCard(
    evalCase.anchorId,
  );
  const links: DotLink[] = linkResult.proposedLinks;
  const checks: EvalCheck[] = [];

  // 1. Expected links found with correct relation + status.
  for (const exp of evalCase.expectedLinks) {
    const match = links.find((l) => samePair(l, exp.a, exp.b));
    const ok = Boolean(match) && match!.relation === exp.relation && match!.status === exp.status;
    checks.push({
      name: `expected ${exp.a}~${exp.b} (${exp.relation}/${exp.status})`,
      passed: ok,
      detail: match
        ? `found relation=${match.relation} status=${match.status} confidence=${match.confidence}`
        : "not found",
    });
  }

  // 2. Forbidden links not confirmed.
  for (const forb of evalCase.forbiddenLinks) {
    const confirmedMatch = links.find((l) => samePair(l, forb.a, forb.b) && l.status === "confirmed");
    checks.push({
      name: `forbidden ${forb.a}~${forb.b} not confirmed`,
      passed: !confirmedMatch,
      detail: confirmedMatch ? `WRONGLY confirmed (confidence=${confirmedMatch.confidence})` : "ok",
    });
  }

  // 3. Quarantine guard for false friends.
  for (const q of evalCase.expectedQuarantined ?? []) {
    const match = links.find((l) => samePair(l, q.a, q.b));
    const excludedOrQuarantined =
      !match || match.status === "quarantined" || match.status === "rejected";
    checks.push({
      name: `false-friend ${q.a}~${q.b} quarantined/excluded`,
      passed: excludedOrQuarantined,
      detail: match ? `status=${match.status} confidence=${match.confidence}` : "excluded (no link)",
    });
  }

  // 4. Provenance present: every link has evidence rationale; verified claims cite ids.
  const allHaveEvidence = links.every((l) => l.evidence.rationale.length > 0);
  checks.push({
    name: "every link carries evidence rationale",
    passed: allHaveEvidence,
    detail: `${links.length} links`,
  });
  const verifiedClaims = contextCard.claims.filter((c) => c.status === "verified");
  const claimsCited = verifiedClaims.every((c) => c.signalIds.length > 0 && c.linkIds.length > 0);
  checks.push({
    name: "verified context-card claims cite signal + link ids",
    passed: claimsCited,
    detail: `${verifiedClaims.length} verified claims`,
  });

  // 5. A composable tool chain occurred.
  checks.push({
    name: "composable tool chain occurred (downstream consumed prior output)",
    passed: snapshot.chainOccurred,
    detail: `${snapshot.calls.length} calls; consuming steps: ${snapshot.calls
      .filter((c) => c.consumedFrom.length > 0)
      .map((c) => c.toolName)
      .join(" -> ")}`,
  });

  return {
    caseId: evalCase.id,
    passed: checks.every((c) => c.passed),
    checks,
    metrics: {
      toolCalls: snapshot.calls.length,
      chainOccurred: snapshot.chainOccurred,
      confirmed: links.filter((l) => l.status === "confirmed").length,
      proposed: links.filter((l) => l.status === "proposed").length,
      quarantined: links.filter((l) => l.status === "quarantined").length,
    },
  };
}
