import type { Signal } from "../artifacts/Signal.js";
import type { DotLinkEvidence, DotLinkRelation } from "../artifacts/DotLink.js";

/**
 * Forensic scoring for DotLink proposals (mock implementation).
 *
 * These are deterministic, evidence-based scorers — NOT an LLM vibe check. Each
 * scorer measures one independent dimension of corroboration. The aggregation
 * deliberately under-weights semantic overlap so that "same words, unrelated
 * matter" (the false-friend case) cannot be auto-confirmed: it scores high on
 * `semantic` but ~0 on people/artifact/temporal, keeping total confidence below
 * the quarantine threshold.
 *
 * Weights encode the product thesis directly:
 *   semantic 0.25 | people 0.35 | artifact 0.25 | temporal 0.15
 * Pure semantic (1.0, others 0) => 0.25, which is below the default
 * quarantineBelow (0.35). Corroboration is required to climb.
 */

export interface DimensionScores {
  semantic: number;
  people: number;
  temporal: number;
  artifact: number;
}

export const CONFIDENCE_WEIGHTS: DimensionScores = {
  semantic: 0.3,
  people: 0.35,
  temporal: 0.15,
  artifact: 0.2,
};

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "on", "in", "is", "are",
  "we", "i", "you", "it", "this", "that", "with", "at", "be", "can", "will",
  "next", "week", "move", "the",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function normalizeList(items: string[]): Set<string> {
  return new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersectList(a: string[], b: string[]): string[] {
  const sb = normalizeList(b);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of a) {
    const k = raw.trim().toLowerCase();
    if (k && sb.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(raw.trim());
    }
  }
  return out;
}

/**
 * Semantic/topical overlap.
 *
 * Combines loose token overlap (excerpt words) with EXACT overlap of structured
 * extracted entities/projects. The structured component is what distinguishes a
 * real topical match ("Apollo launch review" entity appears on both sides) from
 * a false friend (two items that merely share the loose token "launch"): the
 * false friend has no exact structured entity in common, so it scores low.
 */
export function scoreSemanticOverlap(a: Signal, b: Signal): number {
  const tokenJaccard = jaccard(tokenize(a.excerpt), tokenize(b.excerpt));
  const structured = jaccard(
    normalizeList([...a.extracted.entities, ...a.extracted.projects]),
    normalizeList([...b.extracted.entities, ...b.extracted.projects]),
  );
  return Math.min(1, 0.6 * Math.min(1, tokenJaccard * 2.5) + 0.6 * structured);
}

/** People overlap over extracted people + actor ids. */
export function scorePeopleOverlap(a: Signal, b: Signal): number {
  const ap = normalizeList([...a.extracted.people, ...a.actorIds]);
  const bp = normalizeList([...b.extracted.people, ...b.actorIds]);
  return jaccard(ap, bp);
}

export interface TemporalScore {
  score: number;
  temporalDistanceHours: number;
}

/** Temporal proximity with exponential decay (half-life ~48h). */
export function scoreTemporalProximity(a: Signal, b: Signal): TemporalScore {
  const ta = Date.parse(a.timestamp);
  const tb = Date.parse(b.timestamp);
  const distanceHours = Number.isFinite(ta) && Number.isFinite(tb)
    ? Math.abs(ta - tb) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const halfLife = 96;
  const score = Number.isFinite(distanceHours)
    ? Math.pow(0.5, distanceHours / halfLife)
    : 0;
  return { score, temporalDistanceHours: Number.isFinite(distanceHours) ? distanceHours : 1e9 };
}

/** Artifact overlap over extracted artifacts + urls. */
export function scoreArtifactOverlap(a: Signal, b: Signal): number {
  const aa = normalizeList([...a.extracted.artifacts, ...(a.url ? [a.url] : [])]);
  const ba = normalizeList([...b.extracted.artifacts, ...(b.url ? [b.url] : [])]);
  return jaccard(aa, ba);
}

export function aggregateConfidence(scores: DimensionScores): number {
  const w = CONFIDENCE_WEIGHTS;
  const raw =
    w.semantic * scores.semantic +
    w.people * scores.people +
    w.temporal * scores.temporal +
    w.artifact * scores.artifact;
  return Math.max(0, Math.min(1, raw));
}

const CONFLICT_MARKERS = [
  "instead",
  "actually",
  "no longer",
  "changed",
  "revert",
  "disagree",
  "conflict",
  "but we decided",
  "scrap",
  "cancel",
  "won't",
  "not going",
];

const MEETING_MARKERS = ["meeting", "invite", "calendar", "sync", "review", "standup", "call"];

/**
 * Classify the relation between an anchor (source) and a candidate (target).
 * Deterministic heuristics over evidence dimensions + light lexical cues.
 * The earlier signal is treated as the source for directional relations.
 */
export function classifyRelation(
  anchor: Signal,
  candidate: Signal,
  scores: DimensionScores,
): DotLinkRelation {
  const corroborated = scores.people > 0 || scores.artifact > 0;
  const text = `${candidate.excerpt} ${anchor.excerpt}`.toLowerCase();

  // Conflict: corroborated pair with contradiction language.
  if (corroborated && CONFLICT_MARKERS.some((m) => text.includes(m))) {
    return "conflicts_with";
  }

  // Calendar reference: one side is a calendar event and they share context.
  if (
    (candidate.source === "calendar" || anchor.source === "calendar") &&
    (scores.people > 0 || scores.semantic > 0.2 || MEETING_MARKERS.some((m) => text.includes(m)))
  ) {
    return "mentions_meeting";
  }

  // Email decision later discussed in a meeting transcript.
  if (
    candidate.source === "meeting_transcript" &&
    (anchor.source === "email" || anchor.extracted.decisions.length > 0)
  ) {
    return "explains_decision";
  }

  // An ask answered/echoed later.
  if (anchor.extracted.asks.length > 0 && corroborated) {
    return "follow_up_to";
  }

  // Shared artifact (e.g. a doc) anchoring a discussion.
  if (scores.artifact > 0) {
    return "same_topic";
  }

  return "same_topic";
}

/** Build the structured evidence object for a candidate pair. */
export function buildEvidence(
  anchor: Signal,
  candidate: Signal,
  scores: DimensionScores,
  temporalDistanceHours: number,
): DotLinkEvidence {
  const sharedEntities = intersectList(
    [...anchor.extracted.entities, ...anchor.extracted.projects],
    [...candidate.extracted.entities, ...candidate.extracted.projects],
  );
  const sharedPeople = intersectList(
    [...anchor.extracted.people, ...anchor.actorIds],
    [...candidate.extracted.people, ...candidate.actorIds],
  );
  const artifactOverlap = intersectList(
    [...anchor.extracted.artifacts, ...(anchor.url ? [anchor.url] : [])],
    [...candidate.extracted.artifacts, ...(candidate.url ? [candidate.url] : [])],
  );

  const rationaleParts: string[] = [];
  if (sharedPeople.length) rationaleParts.push(`shared people: ${sharedPeople.join(", ")}`);
  if (artifactOverlap.length) rationaleParts.push(`shared artifacts: ${artifactOverlap.join(", ")}`);
  if (sharedEntities.length) rationaleParts.push(`shared topics: ${sharedEntities.join(", ")}`);
  rationaleParts.push(`temporal distance ~${Math.round(temporalDistanceHours)}h`);
  if (!sharedPeople.length && !artifactOverlap.length) {
    rationaleParts.push("no corroborating people/artifacts — topical similarity only");
  }

  return {
    sharedEntities,
    sharedPeople,
    temporalDistanceHours: Math.round(temporalDistanceHours * 100) / 100,
    artifactOverlap: artifactOverlap.length ? artifactOverlap : undefined,
    rationale: rationaleParts.join("; "),
  };
}
