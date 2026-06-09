import { describe, expect, it } from "vitest";
import {
  computeUbiquitousPeople,
  discriminativeCeiling,
  isPersonKey,
  normalizePersonKey,
} from "../../graph/discriminative.js";
import { makeSignal } from "../../evals/cases/_helpers.js";

describe("discriminative people", () => {
  it("discriminativeCeiling = max(5, ceil(0.3 * graphSize))", () => {
    expect(discriminativeCeiling(0)).toBe(5);
    expect(discriminativeCeiling(5)).toBe(5);
    expect(discriminativeCeiling(10)).toBe(5);
    expect(discriminativeCeiling(100)).toBe(30);
    expect(discriminativeCeiling(218)).toBe(66);
  });

  it("normalizePersonKey collapses 'Name <email>' spellings to the email", () => {
    expect(normalizePersonKey("Saad Farooq <Saad@Data-Grid.ai>")).toBe("saad@data-grid.ai");
    expect(normalizePersonKey("  saad@data-grid.ai ")).toBe("saad@data-grid.ai");
    expect(normalizePersonKey("Alice")).toBe("alice");
  });

  it("isPersonKey rejects automation senders and bare domains, accepts people", () => {
    expect(isPersonKey("no-reply@otter.ai")).toBe(false);
    expect(isPersonKey("noreply@github.com")).toBe(false);
    expect(isPersonKey("support@digitalocean.com")).toBe(false);
    expect(isPersonKey("team@startup.io")).toBe(false);
    expect(isPersonKey("data-grid.ai")).toBe(false); // bare org domain, not a person
    expect(isPersonKey("")).toBe(false);
    expect(isPersonKey("alice")).toBe(true);
    expect(isPersonKey("maya@phi.dev")).toBe(true);
    expect(isPersonKey("U0AAAAAAAA".toLowerCase())).toBe(true); // unresolved Slack id
  });

  it("flags an owner above the ceiling on a larger graph, counted once per signal", () => {
    // 10 signals, ceiling 5. Owner on 8/10 (df 8 > 5 → ubiquitous) under TWO
    // spellings per signal (actorId "Name <email>" + extracted bare email) to
    // prove normalization + per-signal dedupe; alice on 4/10 stays evidence.
    const signals = Array.from({ length: 10 }, (_, i) =>
      makeSignal({
        id: `s${i}`,
        source: "email",
        timestamp: "2026-01-01T00:00:00.000Z",
        excerpt: "x",
        actorIds: i < 8 ? ["Owner <owner@corp.com>"] : ["zed"],
        extracted: {
          people: i < 4 ? ["owner@corp.com", "alice"] : i < 8 ? ["owner@corp.com"] : [],
        },
      }),
    );
    expect(computeUbiquitousPeople(signals)).toEqual(["owner@corp.com"]);
  });

  it("flags nobody at fixture scale (the floor of 5 protects tiny worlds)", () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      makeSignal({
        id: `t${i}`,
        source: "slack",
        timestamp: "2026-01-01T00:00:00.000Z",
        excerpt: "x",
        actorIds: ["alice"],
        extracted: { people: ["alice", "bob"] },
      }),
    );
    // alice/bob appear on all 5 signals — df 5 is NOT above the floor ceiling 5.
    expect(computeUbiquitousPeople(signals)).toEqual([]);
  });
});
