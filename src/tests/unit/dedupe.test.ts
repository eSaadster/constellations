import { describe, expect, it } from "vitest";
import { planLinkDedupe } from "../../graph/dedupe.js";
import { makeSignal } from "../../evals/cases/_helpers.js";
import type { DotLink } from "../../artifacts/DotLink.js";

function link(id: string, a: string, b: string, confidence: number, relation: DotLink["relation"] = "mentions_meeting"): DotLink {
  return {
    id,
    sourceSignalId: a,
    targetSignalId: b,
    relation,
    confidence,
    evidence: { sharedEntities: [], sharedPeople: [], temporalDistanceHours: 1, rationale: "r" },
    status: "proposed",
  };
}

const instance = (id: string, day: string) => ({
  ...makeSignal({
    id,
    source: "calendar" as const,
    timestamp: `2026-05-${day}T15:00:00.000Z`,
    excerpt: "huddle",
  }),
  externalId: `huddle_202605${day}T150000Z`,
});

const signals = [
  makeSignal({ id: "mail", source: "email", timestamp: "2026-05-11T09:00:00.000Z", excerpt: "agenda" }),
  makeSignal({ id: "doc", source: "doc", timestamp: "2026-05-11T09:00:00.000Z", excerpt: "plan" }),
  instance("i1", "11"),
  instance("i2", "12"),
  instance("i3", "13"),
];

describe("planLinkDedupe (series-granular)", () => {
  it("keeps only the highest-confidence link per (logical pair, relation): email vs 3 instances", () => {
    const links = [link("l1", "mail", "i1", 0.5), link("l2", "mail", "i2", 0.8), link("l3", "i3", "mail", 0.6)];
    expect(planLinkDedupe(links, signals).sort()).toEqual(["l1", "l3"]);
  });

  it("purges legacy same-series sibling links outright (never keeps one)", () => {
    const links = [link("l1", "i1", "i2", 0.99)];
    expect(planLinkDedupe(links, signals)).toEqual(["l1"]);
  });

  it("leaves unrelated pairs and distinct relations untouched", () => {
    const links = [
      link("l1", "mail", "doc", 0.5, "same_topic"),
      link("l2", "mail", "doc", 0.4, "follow_up_to"),
      link("l3", "doc", "i1", 0.3, "same_topic"),
    ];
    expect(planLinkDedupe(links, signals)).toEqual([]);
  });

  it("collapses reverse-direction duplicates (unordered pair identity)", () => {
    const links = [link("l1", "mail", "doc", 0.5, "same_topic"), link("l2", "doc", "mail", 0.7, "same_topic")];
    expect(planLinkDedupe(links, signals)).toEqual(["l1"]);
  });
});
