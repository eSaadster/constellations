import { describe, expect, it } from "vitest";
import { decideLinkStatus, isInReviewBand, DEFAULT_THRESHOLDS } from "../../safety/confidencePolicy.js";
import type { DotLinkEvidence } from "../../artifacts/DotLink.js";

const corroborated: DotLinkEvidence = {
  sharedEntities: ["apollo"],
  sharedPeople: ["alice"],
  temporalDistanceHours: 12,
  rationale: "shared person",
};

const vibe: DotLinkEvidence = {
  sharedEntities: ["launch"],
  sharedPeople: [],
  temporalDistanceHours: 800,
  rationale: "same word only",
};

describe("confidence policy", () => {
  it("confirms a high-confidence corroborated link", () => {
    const d = decideLinkStatus(0.85, corroborated);
    expect(d.status).toBe("confirmed");
    expect(d.corroborated).toBe(true);
  });

  it("REFUSES to auto-confirm a high-confidence link with only topical evidence (vibe guard)", () => {
    const d = decideLinkStatus(0.95, vibe);
    expect(d.status).toBe("proposed");
    expect(d.corroborated).toBe(false);
    expect(d.reason).toMatch(/topical-only|not auto-confirmed/);
  });

  it("quarantines below the quarantine threshold", () => {
    const d = decideLinkStatus(0.1, vibe);
    expect(d.status).toBe("quarantined");
  });

  it("proposes in the middle band", () => {
    const d = decideLinkStatus(0.5, corroborated);
    expect(d.status).toBe("proposed");
    expect(isInReviewBand(0.5)).toBe(true);
  });

  it("never returns rejected automatically", () => {
    for (const c of [0, 0.2, 0.5, 0.7, 1]) {
      expect(decideLinkStatus(c, corroborated).status).not.toBe("rejected");
    }
  });

  it("uses default thresholds of 0.6 / 0.35", () => {
    expect(DEFAULT_THRESHOLDS.autoConfirmAbove).toBe(0.6);
    expect(DEFAULT_THRESHOLDS.quarantineBelow).toBe(0.35);
  });

  it("quarantines a mid-band link whose only evidence is a shared person near in time (no topical anchor)", () => {
    const peopleOnly: DotLinkEvidence = {
      sharedEntities: [],
      sharedPeople: ["alice"],
      temporalDistanceHours: 2,
      topicalOverlap: 0.05,
      rationale: "shared person, close in time, about nothing shared",
    };
    const d = decideLinkStatus(0.5, peopleOnly);
    expect(d.status).toBe("quarantined");
    expect(d.corroborated).toBe(true);
    expect(d.reason).toMatch(/topical anchor/);
  });

  it("treats legacy evidence without topicalOverlap as anchored (back-compat: not retro-quarantined)", () => {
    const legacy: DotLinkEvidence = {
      sharedEntities: [],
      sharedPeople: ["alice"],
      temporalDistanceHours: 2,
      rationale: "pre-topicalOverlap link",
    };
    expect(decideLinkStatus(0.5, legacy).status).toBe("proposed");
  });
});
