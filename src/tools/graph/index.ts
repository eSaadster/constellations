import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import { SignalSchema } from "../../artifacts/Signal.js";
import { DotLinkSchema, type DotLink } from "../../artifacts/DotLink.js";

/**
 * graph.* — context graph reads and writes. Writes go through the store, whose
 * mutation hook feeds the tracer, so every node/edge change is observable.
 */

export const graphTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "graph.add_node",
    description: "Add a Signal node to the context graph.",
    inputSchema: z.object({ signal: SignalSchema }),
    outputSchema: z.object({ signalId: z.string() }),
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "graph_write",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal }, ctx) => ({ signalId: ctx.store.addSignal(signal).id }),
  }),

  defineTool({
    name: "graph.add_edge",
    description: "Persist a single DotLink edge into the context graph.",
    inputSchema: z.object({ link: DotLinkSchema }),
    outputSchema: z.object({ linkId: z.string() }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "graph_write",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ link }, ctx) => ({ linkId: ctx.store.addLink(link).id }),
  }),

  defineTool({
    name: "graph.commit_links",
    description:
      "Persist a batch of DotLinks as edges. Skips rejected links. Returns counts by status — a composable sink for LinkLab output.",
    inputSchema: z.object({ links: z.array(DotLinkSchema) }),
    outputSchema: z.object({
      linkIds: z.array(z.string()),
      confirmed: z.number(),
      proposed: z.number(),
      quarantined: z.number(),
      rejected: z.number(),
    }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "graph_write",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ links }, ctx) => {
      const linkIds: string[] = [];
      const counts = { confirmed: 0, proposed: 0, quarantined: 0, rejected: 0 };
      for (const link of links as DotLink[]) {
        if (link.status === "rejected") {
          counts.rejected++;
          continue;
        }
        ctx.store.addLink(link);
        linkIds.push(link.id);
        counts[link.status]++;
      }
      return { linkIds, ...counts };
    },
  }),

  defineTool({
    name: "graph.read_signal",
    description:
      "Read a single Signal node's full contents (source, title, excerpt, actors, timestamp, extracted facts, provenance) by id. Returns signal: null if no such id exists.",
    inputSchema: z.object({ signalId: z.string() }),
    outputSchema: z.object({ signal: SignalSchema.nullable() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signalId }, ctx) => ({ signal: ctx.store.getSignal(signalId) ?? null }),
  }),

  defineTool({
    name: "graph.list_signals",
    description:
      "List all Signal nodes in the graph with their full contents. The canonical way to enumerate and introspect signals; returns the total count alongside the signals.",
    inputSchema: z.object({}),
    outputSchema: z.object({ signals: z.array(SignalSchema), count: z.number() }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (_input, ctx) => {
      const signals = ctx.store.listSignals();
      return { signals, count: signals.length };
    },
  }),

  defineTool({
    name: "graph.get_neighbors",
    description: "Get the neighboring signals (and connecting links) of a signal.",
    inputSchema: z.object({ signalId: z.string() }),
    outputSchema: z.object({
      neighbors: z.array(z.object({ link: DotLinkSchema, neighbor: SignalSchema })),
    }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signalId }, ctx) => ({ neighbors: ctx.store.neighbors(signalId) }),
  }),

  defineTool({
    name: "graph.detect_conflict",
    description: "Detect conflicting edges (conflicts_with) involving a signal or across the graph.",
    inputSchema: z.object({ signalId: z.string().optional() }),
    outputSchema: z.object({ conflicts: z.array(DotLinkSchema) }),
    consumes: ["DotLink"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signalId }, ctx) => {
      const links = signalId ? ctx.store.linksForSignal(signalId) : ctx.store.listLinks();
      return { conflicts: links.filter((l) => l.relation === "conflicts_with") };
    },
  }),

  defineTool({
    name: "graph.detect_orphan_signal",
    description: "Find signals that have no links (orphans) in the graph.",
    inputSchema: z.object({}),
    outputSchema: z.object({ orphanSignalIds: z.array(z.string()) }),
    consumes: ["Signal"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (_input, ctx) => ({
      orphanSignalIds: ctx.store
        .listSignals()
        .filter((s) => ctx.store.linksForSignal(s.id).length === 0)
        .map((s) => s.id),
    }),
  }),

  defineTool({
    name: "graph.find_clusters",
    description: "Find connected components (clusters) over non-rejected links.",
    inputSchema: z.object({}),
    outputSchema: z.object({ clusters: z.array(z.array(z.string())) }),
    consumes: ["Signal", "DotLink"],
    produces: ["Constellation"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (_input, ctx) => {
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        parent.set(x, parent.get(x) ?? x);
        while (parent.get(x) !== x) {
          const p = parent.get(x)!;
          parent.set(x, parent.get(p) ?? p);
          x = parent.get(x)!;
        }
        return x;
      };
      const union = (a: string, b: string) => {
        parent.set(find(a), find(b));
      };
      for (const s of ctx.store.listSignals()) find(s.id);
      for (const l of ctx.store.listLinks()) {
        if (l.status === "rejected") continue;
        union(l.sourceSignalId, l.targetSignalId);
      }
      const groups = new Map<string, string[]>();
      for (const s of ctx.store.listSignals()) {
        const root = find(s.id);
        groups.set(root, [...(groups.get(root) ?? []), s.id]);
      }
      return { clusters: [...groups.values()].filter((g) => g.length > 1) };
    },
  }),

  defineTool({
    name: "graph.explain_path",
    description: "Explain the shortest link path between two signals (BFS over non-rejected edges).",
    inputSchema: z.object({ fromSignalId: z.string(), toSignalId: z.string() }),
    outputSchema: z.object({ path: z.array(DotLinkSchema) }),
    consumes: ["DotLink"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ fromSignalId, toSignalId }, ctx) => {
      const queue: Array<{ id: string; path: DotLink[] }> = [{ id: fromSignalId, path: [] }];
      const seen = new Set<string>([fromSignalId]);
      while (queue.length) {
        const { id, path } = queue.shift()!;
        if (id === toSignalId) return { path };
        for (const { link, neighbor } of ctx.store.neighbors(id)) {
          if (link.status === "rejected" || seen.has(neighbor.id)) continue;
          seen.add(neighbor.id);
          queue.push({ id: neighbor.id, path: [...path, link] });
        }
      }
      return { path: [] };
    },
  }),
];
