import { describe, expect, it } from "vitest";
import { makeSignal } from "../../evals/cases/_helpers.js";
import {
  buildEvidence,
  classifyRelation,
  scorePeopleOverlap,
  type DimensionScores,
} from "../../graph/scoring.js";
import { evidenceIsCorroborated } from "../../artifacts/DotLink.js";

const OWNER = "owner@corp.com";

function sig(
  id: string,
  source: "slack" | "email" | "calendar",
  people: string[],
  extra: { entities?: string[]; excerpt?: string; timestamp?: string } = {},
) {
  return makeSignal({
    id,
    source,
    timestamp: extra.timestamp ?? "2026-01-01T10:00:00.000Z",
    excerpt: extra.excerpt ?? `signal ${id}`,
    actorIds: people,
    extracted: { people, entities: extra.entities ?? [] },
  });
}

describe("scorePeopleOverlap with discriminativeness filters", () => {
  it("scores 0 when the only shared person is in the ignore set (owner-only pair)", () => {
    const a = sig("a", "email", [OWNER]);
    const b = sig("b", "email", [OWNER]);
    expect(scorePeopleOverlap(a, b)).toBe(1); // without the filter: full overlap
    expect(scorePeopleOverlap(a, b, new Set([OWNER]))).toBe(0);
  });

  it("ignores the owner on both sides but keeps real shared people", () => {
    const a = sig("a", "email", [OWNER, "alice"]);
    const b = sig("b", "email", [OWNER, "alice"]);
    expect(scorePeopleOverlap(a, b, new Set([OWNER]))).toBe(1); // alice-only jaccard
  });

  it("merges 'Name <email>' and bare-email spellings via normalization", () => {
    const a = sig("a", "email", ["Saad Farooq <saad@x.ai>"]);
    const b = sig("b", "email", ["saad@x.ai"]);
    expect(scorePeopleOverlap(a, b)).toBe(1);
  });

  it("never counts automation senders as people, even with no ignore set", () => {
    const a = sig("a", "email", ["no-reply@otter.ai"]);
    const b = sig("b", "email", ["no-reply@otter.ai"]);
    expect(scorePeopleOverlap(a, b)).toBe(0);
  });
});

describe("buildEvidence with discriminativeness filters", () => {
  const scores: DimensionScores = { semantic: 0.1, people: 0, temporal: 0.5, artifact: 0 };

  it("drops ignored people from sharedPeople so the evidence fails corroboration", () => {
    const a = sig("a", "email", [OWNER]);
    const b = sig("b", "email", [OWNER]);
    const evidence = buildEvidence(a, b, scores, 12, new Set([OWNER]));
    expect(evidence.sharedPeople).toEqual([]);
    expect(evidence.rationale).toContain("no corroborating people/artifacts");
    expect(evidenceIsCorroborated(evidence)).toBe(false);
  });

  it("keeps non-ubiquitous shared people (original casing) and records topicalOverlap", () => {
    const a = sig("a", "email", [OWNER, "Alice"]);
    const b = sig("b", "email", [OWNER, "alice"]);
    const evidence = buildEvidence(a, b, { ...scores, semantic: 0.42 }, 12, new Set([OWNER]));
    expect(evidence.sharedPeople).toEqual(["Alice"]);
    expect(evidence.topicalOverlap).toBe(0.42);
    expect(evidenceIsCorroborated(evidence)).toBe(true);
  });
});

describe("classifyRelation: mentions_meeting requires real evidence", () => {
  const corroborated: DimensionScores = { semantic: 0.5, people: 1, temporal: 0.8, artifact: 0 };
  const vibe: DimensionScores = { semantic: 0.5, people: 0, temporal: 0.8, artifact: 0 };

  it("fires for a corroborated pair with exactly one calendar side", () => {
    const slack = sig("a", "slack", ["alice"]);
    const cal = sig("b", "calendar", ["alice"]);
    expect(classifyRelation(slack, cal, corroborated)).toBe("mentions_meeting");
  });

  it("never fires for calendar-calendar pairs (scheduling structure, not a mention)", () => {
    const c1 = sig("a", "calendar", ["alice"]);
    const c2 = sig("b", "calendar", ["alice"]);
    expect(classifyRelation(c1, c2, corroborated)).not.toBe("mentions_meeting");
  });

  it("never fires uncorroborated — meeting words/proximity alone are not a mention", () => {
    const slack = sig("a", "slack", ["alice"], { excerpt: "sync meeting invite on the calendar" });
    const cal = sig("b", "calendar", ["bob"], { excerpt: "standup review call" });
    expect(classifyRelation(slack, cal, vibe)).not.toBe("mentions_meeting");
  });
});
