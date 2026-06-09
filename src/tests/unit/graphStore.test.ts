import { describe, expect, it } from "vitest";
import { MemoryGraphStore } from "../../graph/memoryStore.js";
import { GraphConflictError } from "../../resilience/errors.js";
import { makeSignal } from "../../evals/cases/_helpers.js";
import type { DotLink } from "../../artifacts/DotLink.js";

function link(id: string, a: string, b: string, relation: DotLink["relation"], status: DotLink["status"]): DotLink {
  return {
    id,
    sourceSignalId: a,
    targetSignalId: b,
    relation,
    confidence: 0.8,
    evidence: { sharedEntities: [], sharedPeople: ["x"], temporalDistanceHours: 1, rationale: "r" },
    status,
  };
}

const s1 = makeSignal({ id: "s1", source: "slack", timestamp: "2026-01-01T00:00:00.000Z", excerpt: "a" });
const s2 = makeSignal({ id: "s2", source: "email", timestamp: "2026-01-02T00:00:00.000Z", excerpt: "b" });

describe("MemoryGraphStore", () => {
  it("adds and retrieves signals, indexed by external id", () => {
    const store = new MemoryGraphStore();
    store.addSignal(s1);
    expect(store.getSignal("s1")).toBeDefined();
    expect(store.findSignalByExternalId("slack", s1.externalId)?.id).toBe("s1");
  });

  it("adds edges and computes neighbors", () => {
    const store = new MemoryGraphStore();
    store.addSignal(s1);
    store.addSignal(s2);
    store.addLink(link("l1", "s1", "s2", "follow_up_to", "confirmed"));
    const neighbors = store.neighbors("s1");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.neighbor.id).toBe("s2");
  });

  it("fires the mutation hook on writes", () => {
    const store = new MemoryGraphStore();
    const ops: string[] = [];
    store.setMutationHook((e) => ops.push(`${e.op}:${e.entityType}`));
    store.addSignal(s1);
    store.addLink(link("l1", "s1", "s1", "same_topic", "proposed"));
    expect(ops).toContain("add_node:Signal");
    expect(ops).toContain("add_edge:DotLink");
  });

  it("raises GraphConflictError on contradicting confirmed edges", () => {
    const store = new MemoryGraphStore();
    store.addSignal(s1);
    store.addSignal(s2);
    store.addLink(link("l1", "s1", "s2", "resolves", "confirmed"));
    expect(() => store.addLink(link("l2", "s1", "s2", "conflicts_with", "confirmed"))).toThrow(
      GraphConflictError,
    );
  });

  it("round-trips through export/import", () => {
    const store = new MemoryGraphStore();
    store.addSignal(s1);
    store.addLink(link("l1", "s1", "s1", "same_topic", "proposed"));
    const state = store.exportState();
    const restored = new MemoryGraphStore();
    restored.importState(state);
    expect(restored.getSignal("s1")).toBeDefined();
    expect(restored.listLinks()).toHaveLength(1);
  });

  it("detects orphan signals and finds clusters", () => {
    const store = new MemoryGraphStore();
    store.addSignal(s1);
    store.addSignal(s2);
    store.addLink(link("l1", "s1", "s2", "same_topic", "confirmed"));
    const orphans = store.listSignals().filter((s) => store.linksForSignal(s.id).length === 0);
    expect(orphans).toHaveLength(0);
  });
});
