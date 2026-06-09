import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../../tools/index.js";
import { makeTestContext } from "../helpers/context.js";
import { makeSignal } from "../../evals/cases/_helpers.js";
import type { Constellation } from "../../artifacts/Constellation.js";
import type { DotLink } from "../../artifacts/DotLink.js";

function link(id: string, a: string, b: string, status: DotLink["status"]): DotLink {
  return {
    id,
    sourceSignalId: a,
    targetSignalId: b,
    relation: "same_topic",
    confidence: 0.5,
    evidence: { sharedEntities: [], sharedPeople: ["alice"], temporalDistanceHours: 1, rationale: "r" },
    status,
  };
}

const plain = (id: string) =>
  makeSignal({ id, source: "slack", timestamp: "2026-01-01T10:00:00.000Z", excerpt: `signal ${id}` });

const instance = (id: string, day: string) => ({
  ...makeSignal({
    id,
    source: "calendar" as const,
    timestamp: `2026-05-${day}T15:00:00.000Z`,
    excerpt: "huddle",
  }),
  externalId: `huddle_202605${day}T150000Z`,
});

describe("constellation.update_constellation clustering", () => {
  it("does NOT traverse quarantined links: two islands stay separate", async () => {
    const registry = createToolRegistry();
    const ctx = makeTestContext({ registry });
    for (const id of ["a", "b", "c", "d"]) ctx.store.addSignal(plain(id));
    ctx.store.addLink(link("l1", "a", "b", "confirmed"));
    ctx.store.addLink(link("l2", "c", "d", "confirmed"));
    // The quarantine-glue disease: a sub-evidence edge must not merge workstreams.
    ctx.store.addLink(link("l3", "b", "c", "quarantined"));

    const out = await registry.execute<{ anchorSignalId: string }, { constellation: Constellation }>(
      "constellation.update_constellation",
      { anchorSignalId: "a" },
      ctx,
    );
    expect(out.constellation.signalIds.sort()).toEqual(["a", "b"]);
  });

  it("treats series siblings as one logical node: siblings join and are traversed", async () => {
    const registry = createToolRegistry();
    const ctx = makeTestContext({ registry });
    ctx.store.addSignal(plain("e1"));
    ctx.store.addSignal(plain("e2"));
    for (const [id, day] of [["i1", "11"], ["i2", "12"], ["i3", "13"]] as const) {
      ctx.store.addSignal(instance(id, day));
    }
    // e1 links to instance #2, e2 links to instance #3 — same workstream.
    ctx.store.addLink(link("l1", "e1", "i2", "confirmed"));
    ctx.store.addLink(link("l2", "e2", "i3", "proposed"));

    const out = await registry.execute<{ anchorSignalId: string }, { constellation: Constellation }>(
      "constellation.update_constellation",
      { anchorSignalId: "e1" },
      ctx,
    );
    expect(out.constellation.signalIds.sort()).toEqual(["e1", "e2", "i1", "i2", "i3"]);
  });
});
