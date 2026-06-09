import type { Signal } from "../artifacts/Signal.js";
import type { DotLink } from "../artifacts/DotLink.js";
import type { Constellation } from "../artifacts/Constellation.js";
import { GraphConflictError } from "../resilience/errors.js";
import type { GraphMutationEvent, GraphStore, NeighborResult } from "./store.js";

/**
 * In-memory GraphStore. Deterministic and dependency-free — used by the CLI,
 * RPC service, evals, and tests. Edges with a confirmed `conflicts_with`
 * relation between the same pair raise `GraphConflictError` on a contradicting
 * confirmed edge, demonstrating conflict-aware writes.
 */
export class MemoryGraphStore implements GraphStore {
  private signals = new Map<string, Signal>();
  private externalIndex = new Map<string, string>(); // `${source}:${externalId}` -> signalId
  private links = new Map<string, DotLink>();
  private constellations = new Map<string, Constellation>();
  private mutationHook: (e: GraphMutationEvent) => void = () => {};

  setMutationHook(hook: (e: GraphMutationEvent) => void): void {
    this.mutationHook = hook;
  }

  private emit(e: GraphMutationEvent): void {
    this.mutationHook(e);
  }

  addSignal(signal: Signal): Signal {
    this.signals.set(signal.id, signal);
    this.externalIndex.set(`${signal.source}:${signal.externalId}`, signal.id);
    this.emit({ op: "add_node", entityType: "Signal", entityId: signal.id });
    return signal;
  }

  getSignal(id: string): Signal | undefined {
    return this.signals.get(id);
  }

  findSignalByExternalId(source: string, externalId: string): Signal | undefined {
    const id = this.externalIndex.get(`${source}:${externalId}`);
    return id ? this.signals.get(id) : undefined;
  }

  listSignals(): Signal[] {
    return [...this.signals.values()];
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join("::");
  }

  addLink(link: DotLink): DotLink {
    // Conflict guard: a confirmed contradicting edge between the same pair.
    if (link.status === "confirmed") {
      for (const existing of this.links.values()) {
        if (
          existing.status === "confirmed" &&
          this.pairKey(existing.sourceSignalId, existing.targetSignalId) ===
            this.pairKey(link.sourceSignalId, link.targetSignalId) &&
          relationsContradict(existing.relation, link.relation)
        ) {
          throw new GraphConflictError(
            `confirmed edge ${existing.relation} conflicts with ${link.relation}`,
            { existingLinkId: existing.id, newLinkId: link.id },
          );
        }
      }
    }
    this.links.set(link.id, link);
    this.emit({ op: "add_edge", entityType: "DotLink", entityId: link.id });
    return link;
  }

  updateLink(id: string, patch: Partial<DotLink>): DotLink {
    const existing = this.links.get(id);
    if (!existing) throw new Error(`unknown link: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.links.set(id, updated);
    this.emit({ op: "update_edge", entityType: "DotLink", entityId: id });
    return updated;
  }

  getLink(id: string): DotLink | undefined {
    return this.links.get(id);
  }

  listLinks(): DotLink[] {
    return [...this.links.values()];
  }

  linksForSignal(signalId: string): DotLink[] {
    return this.listLinks().filter(
      (l) => l.sourceSignalId === signalId || l.targetSignalId === signalId,
    );
  }

  upsertConstellation(constellation: Constellation): Constellation {
    const existed = this.constellations.has(constellation.id);
    this.constellations.set(constellation.id, constellation);
    this.emit({
      op: existed ? "merge_cluster" : "upsert_cluster",
      entityType: "Constellation",
      entityId: constellation.id,
    });
    return constellation;
  }

  getConstellation(id: string): Constellation | undefined {
    return this.constellations.get(id);
  }

  listConstellations(): Constellation[] {
    return [...this.constellations.values()];
  }

  neighbors(signalId: string): NeighborResult[] {
    const out: NeighborResult[] = [];
    for (const link of this.linksForSignal(signalId)) {
      const neighborId =
        link.sourceSignalId === signalId ? link.targetSignalId : link.sourceSignalId;
      const neighbor = this.signals.get(neighborId);
      if (neighbor) out.push({ link, neighbor });
    }
    return out;
  }

  clear(): void {
    this.signals.clear();
    this.externalIndex.clear();
    this.links.clear();
    this.constellations.clear();
  }

  /** Serialize the full graph (for file persistence / inspection). */
  exportState(): { signals: Signal[]; links: DotLink[]; constellations: Constellation[] } {
    return {
      signals: this.listSignals(),
      links: this.listLinks(),
      constellations: this.listConstellations(),
    };
  }

  /** Load a previously-exported graph, replacing current state. */
  importState(state: {
    signals?: Signal[];
    links?: DotLink[];
    constellations?: Constellation[];
  }): void {
    this.clear();
    for (const s of state.signals ?? []) {
      this.signals.set(s.id, s);
      this.externalIndex.set(`${s.source}:${s.externalId}`, s.id);
    }
    for (const l of state.links ?? []) this.links.set(l.id, l);
    for (const c of state.constellations ?? []) this.constellations.set(c.id, c);
  }
}

const CONTRADICTORY_PAIRS: Array<[string, string]> = [
  ["resolves", "conflicts_with"],
  ["blocks", "resolves"],
];

function relationsContradict(a: string, b: string): boolean {
  return CONTRADICTORY_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}
