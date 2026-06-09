import type { Signal } from "../artifacts/Signal.js";
import type { DotLink } from "../artifacts/DotLink.js";
import type { Constellation } from "../artifacts/Constellation.js";

/**
 * GraphStore — the persistence abstraction for the context graph.
 *
 * The scaffold ships an in-memory implementation (`MemoryGraphStore`). A real
 * deployment would back this with a graph DB / Postgres; the interface is the
 * seam. Every mutation flows through `onMutation` so the observability layer can
 * trace graph writes without the store depending on the tracer.
 */

export interface GraphMutationEvent {
  op: "add_node" | "add_edge" | "update_edge" | "remove_edge" | "upsert_cluster" | "merge_cluster";
  entityType: "Signal" | "DotLink" | "Constellation";
  entityId: string;
}

export interface NeighborResult {
  link: DotLink;
  neighbor: Signal;
}

export interface GraphStore {
  // Signals (nodes)
  addSignal(signal: Signal): Signal;
  getSignal(id: string): Signal | undefined;
  findSignalByExternalId(source: string, externalId: string): Signal | undefined;
  listSignals(): Signal[];

  // DotLinks (edges)
  addLink(link: DotLink): DotLink;
  updateLink(id: string, patch: Partial<DotLink>): DotLink;
  /** Remove a link by id. Returns true if a link was removed. */
  removeLink(id: string): boolean;
  getLink(id: string): DotLink | undefined;
  listLinks(): DotLink[];
  linksForSignal(signalId: string): DotLink[];

  // Constellations (clusters)
  upsertConstellation(constellation: Constellation): Constellation;
  getConstellation(id: string): Constellation | undefined;
  listConstellations(): Constellation[];

  // Graph queries
  neighbors(signalId: string): NeighborResult[];

  // Lifecycle / observability hook
  setMutationHook(hook: (e: GraphMutationEvent) => void): void;
  clear(): void;
}
