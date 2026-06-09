import { describe, expect, it } from "vitest";
import {
  SignalSchema,
  DotLinkSchema,
  ConstellationSchema,
  ContextCardSchema,
  evidenceIsCorroborated,
  parseSignal,
} from "../../artifacts/index.js";

const validSignal = {
  id: "sig_1",
  source: "slack",
  externalId: "C123/p1700000000",
  url: "https://slack.com/x",
  actorIds: ["U_alice"],
  timestamp: "2026-01-01T10:00:00.000Z",
  excerpt: "Can we move the launch review to next week?",
  extracted: {
    entities: ["launch review"],
    people: ["alice"],
    projects: ["apollo"],
    dates: [],
    artifacts: [],
    asks: ["move the launch review"],
    decisions: [],
  },
  provenance: {
    ingestedBy: "slack.connector.mock",
    ingestedAt: "2026-01-01T10:00:01.000Z",
    sourceHash: "abc123",
  },
};

describe("Signal schema", () => {
  it("parses a valid signal and applies extracted defaults", () => {
    const sig = parseSignal(validSignal);
    expect(sig.id).toBe("sig_1");
    expect(sig.extracted.entities).toContain("launch review");
  });

  it("rejects an unknown source", () => {
    const bad = { ...validSignal, source: "telegram" };
    expect(SignalSchema.safeParse(bad).success).toBe(false);
  });

  it("requires provenance.sourceHash", () => {
    const bad = { ...validSignal, provenance: { ingestedBy: "x", ingestedAt: "y" } };
    expect(SignalSchema.safeParse(bad).success).toBe(false);
  });
});

describe("DotLink schema", () => {
  const base = {
    id: "link_1",
    sourceSignalId: "sig_1",
    targetSignalId: "sig_2",
    relation: "follow_up_to",
    confidence: 0.8,
    evidence: {
      sharedEntities: ["launch review"],
      sharedPeople: ["alice"],
      temporalDistanceHours: 12,
      rationale: "shared person and topic within 12h",
    },
    status: "proposed",
  };

  it("parses a valid dot link", () => {
    expect(DotLinkSchema.safeParse(base).success).toBe(true);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(DotLinkSchema.safeParse({ ...base, confidence: 1.5 }).success).toBe(false);
  });

  it("evidenceIsCorroborated: shared people counts as corroboration", () => {
    expect(evidenceIsCorroborated(base.evidence)).toBe(true);
  });

  it("evidenceIsCorroborated: pure topical overlap is a vibe (not corroborated)", () => {
    expect(
      evidenceIsCorroborated({
        sharedEntities: ["budget"],
        sharedPeople: [],
        temporalDistanceHours: 900,
        rationale: "same word, different matter",
      }),
    ).toBe(false);
  });
});

describe("Constellation + ContextCard schemas", () => {
  it("parses a minimal constellation", () => {
    const c = {
      id: "con_1",
      name: "Apollo launch",
      summary: "Cluster about the apollo launch review",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
      confidence: 0.7,
      provenance: { createdFromLinkIds: ["link_1"], userCorrections: [] },
    };
    expect(ConstellationSchema.safeParse(c).success).toBe(true);
  });

  it("parses a minimal context card", () => {
    const card = {
      id: "card_1",
      anchorSignalId: "sig_1",
      title: "What is this connected to?",
      generatedAt: "2026-01-02T00:00:00.000Z",
      summary: "1 connection found",
    };
    expect(ContextCardSchema.safeParse(card).success).toBe(true);
  });
});
