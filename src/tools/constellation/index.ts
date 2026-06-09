import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import type { Signal } from "../../artifacts/Signal.js";
import type { DotLink } from "../../artifacts/DotLink.js";
import { ConstellationSchema, type Constellation } from "../../artifacts/Constellation.js";
import { ContextCardSchema, type ContextCardConnection } from "../../artifacts/ContextCard.js";
import { classifyClaim } from "../../graph/provenance.js";

/**
 * constellation.* — cluster assembly + the user-facing Context Card.
 *
 * The Context Card enforces the citation invariant: every claim records the
 * Signal/DotLink ids that support it and is marked verified / unverified /
 * quarantined accordingly.
 */

function gatherCluster(
  anchorSignalId: string,
  store: { neighbors: (id: string) => { link: DotLink; neighbor: Signal }[] },
): { signalIds: Set<string>; links: DotLink[] } {
  const signalIds = new Set<string>([anchorSignalId]);
  const links: DotLink[] = [];
  const seenLinks = new Set<string>();
  const queue = [anchorSignalId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { link, neighbor } of store.neighbors(id)) {
      if (link.status === "rejected") continue;
      if (!seenLinks.has(link.id)) {
        seenLinks.add(link.id);
        links.push(link);
      }
      if (!signalIds.has(neighbor.id)) {
        signalIds.add(neighbor.id);
        queue.push(neighbor.id);
      }
    }
  }
  return { signalIds, links };
}

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

export const constellationTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "constellation.update_constellation",
    description:
      "Build or update the Constellation cluster around an anchor signal from its confirmed/proposed links.",
    inputSchema: z.object({
      anchorSignalId: z.string(),
      linkIds: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({ constellationId: z.string(), constellation: ConstellationSchema }),
    consumes: ["Signal", "DotLink"],
    produces: ["Constellation"],
    sideEffects: "graph_write",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ anchorSignalId, linkIds }, ctx) => {
      const { signalIds, links } = gatherCluster(anchorSignalId, ctx.store);
      const members = [...signalIds]
        .map((id) => ctx.store.getSignal(id))
        .filter((s): s is Signal => Boolean(s));

      const actionable = links.filter((l) => l.status === "confirmed" || l.status === "proposed");
      const confidence =
        actionable.length === 0
          ? 0
          : actionable.reduce((acc, l) => acc + l.confidence, 0) / actionable.length;

      const lastActivityAt = members
        .map((s) => s.timestamp)
        .sort()
        .at(-1) ?? ctx.clock();

      const anchor = ctx.store.getSignal(anchorSignalId);
      const topics = uniq(members.flatMap((s) => [...s.extracted.entities, ...s.extracted.projects]));

      const existing = ctx.store
        .listConstellations()
        .find((c) => c.signalIds.includes(anchorSignalId));

      const constellation: Constellation = {
        id: existing?.id ?? ctx.ids.next("con"),
        name: existing?.name ?? (anchor?.title || topics[0] || `Cluster around ${anchorSignalId}`),
        summary: `${members.length} signals connected by ${links.length} links across ${
          uniq(members.map((s) => s.source)).length
        } sources.`,
        signalIds: [...signalIds],
        linkIds: linkIds ?? links.map((l) => l.id),
        people: uniq(members.flatMap((s) => s.extracted.people)),
        topics,
        artifacts: uniq(members.flatMap((s) => s.extracted.artifacts)),
        openQuestions: uniq(members.flatMap((s) => s.extracted.asks)),
        decisions: uniq(members.flatMap((s) => s.extracted.decisions)),
        asks: uniq(members.flatMap((s) => s.extracted.asks)),
        lastActivityAt,
        confidence: Math.round(confidence * 1000) / 1000,
        provenance: {
          createdFromLinkIds: links.map((l) => l.id),
          userCorrections: existing?.provenance.userCorrections ?? [],
        },
      };
      const stored = ctx.store.upsertConstellation(constellation);
      return { constellationId: stored.id, constellation: stored };
    },
  }),

  defineTool({
    name: "constellation.summarize_constellation",
    description: "Produce a short natural-language summary of a Constellation.",
    inputSchema: z.object({ constellationId: z.string() }),
    outputSchema: z.object({ summary: z.string() }),
    consumes: ["Constellation"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ constellationId }, ctx) => {
      const c = ctx.store.getConstellation(constellationId);
      if (!c) return { summary: "Constellation not found." };
      return {
        summary: `${c.name}: ${c.summary} People: ${c.people.join(", ") || "—"}. Topics: ${
          c.topics.join(", ") || "—"
        }.`,
      };
    },
  }),

  defineTool({
    name: "constellation.get_timeline",
    description: "Return the time-ordered signals of a Constellation.",
    inputSchema: z.object({ constellationId: z.string() }),
    outputSchema: z.object({
      timeline: z.array(z.object({ signalId: z.string(), source: z.string(), timestamp: z.string() })),
    }),
    consumes: ["Constellation"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ constellationId }, ctx) => {
      const c = ctx.store.getConstellation(constellationId);
      if (!c) return { timeline: [] };
      const timeline = c.signalIds
        .map((id) => ctx.store.getSignal(id))
        .filter((s): s is Signal => Boolean(s))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map((s) => ({ signalId: s.id, source: s.source, timestamp: s.timestamp }));
      return { timeline };
    },
  }),

  defineTool({
    name: "constellation.extract_open_questions",
    description: "Extract open questions / unresolved asks across a Constellation.",
    inputSchema: z.object({ constellationId: z.string() }),
    outputSchema: z.object({ openQuestions: z.array(z.string()) }),
    consumes: ["Constellation"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ constellationId }, ctx) => {
      const c = ctx.store.getConstellation(constellationId);
      return { openQuestions: c?.openQuestions ?? [] };
    },
  }),

  defineTool({
    name: "constellation.extract_decisions",
    description: "Extract decisions recorded across a Constellation.",
    inputSchema: z.object({ constellationId: z.string() }),
    outputSchema: z.object({ decisions: z.array(z.string()) }),
    consumes: ["Constellation"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ constellationId }, ctx) => {
      const c = ctx.store.getConstellation(constellationId);
      return { decisions: c?.decisions ?? [] };
    },
  }),

  defineTool({
    name: "constellation.extract_asks",
    description: "Extract asks / requests across a Constellation.",
    inputSchema: z.object({ constellationId: z.string() }),
    outputSchema: z.object({ asks: z.array(z.string()) }),
    consumes: ["Constellation"],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ constellationId }, ctx) => {
      const c = ctx.store.getConstellation(constellationId);
      return { asks: c?.asks ?? [] };
    },
  }),

  defineTool({
    name: "constellation.generate_context_card",
    description:
      "Generate the user-facing Context Card for an anchor signal. Every claim cites Signal/DotLink ids or is marked unverified.",
    inputSchema: z.object({
      anchorSignalId: z.string(),
      constellationId: z.string().optional(),
    }),
    outputSchema: z.object({ contextCard: ContextCardSchema }),
    consumes: ["Signal", "DotLink", "Constellation"],
    produces: ["ContextCard"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ anchorSignalId, constellationId }, ctx) => {
      const anchor = ctx.store.getSignal(anchorSignalId);
      const neighbors = ctx.store.neighbors(anchorSignalId).filter((n) => n.link.status !== "rejected");

      const connections: ContextCardConnection[] = neighbors.map(({ link, neighbor }) => ({
        linkId: link.id,
        targetSignalId: neighbor.id,
        relation: link.relation,
        confidence: link.confidence,
        status: link.status,
        rationale: link.evidence.rationale,
        evidenceSummary: `people:[${link.evidence.sharedPeople.join(", ")}] artifacts:[${(
          link.evidence.artifactOverlap ?? []
        ).join(", ")}] Δ${Math.round(link.evidence.temporalDistanceHours)}h`,
      }));

      const claims = neighbors.map(({ link, neighbor }) =>
        classifyClaim(
          `${anchor?.title || "This"} ${link.relation.replace(/_/g, " ")} "${
            neighbor.title || neighbor.excerpt.slice(0, 48)
          }"`,
          [anchorSignalId, neighbor.id],
          [link.id],
          link.confidence,
          link.status === "quarantined",
        ),
      );

      const members = neighbors.map((n) => n.neighbor);
      const contextCard = {
        id: ctx.ids.next("card"),
        anchorSignalId,
        title: anchor?.title || "What is this connected to?",
        generatedAt: ctx.clock(),
        summary:
          connections.length === 0
            ? "No connections found yet."
            : `${connections.filter((c) => c.status === "confirmed").length} confirmed, ${
                connections.filter((c) => c.status === "proposed").length
              } proposed, ${connections.filter((c) => c.status === "quarantined").length} quarantined connection(s).`,
        connections,
        claims,
        openQuestions: uniq(members.flatMap((s) => s.extracted.asks)),
        decisions: uniq(members.flatMap((s) => s.extracted.decisions)),
        asks: uniq(members.flatMap((s) => s.extracted.asks)),
        provenanceTraceId: ctx.trace.id,
      };
      void constellationId;
      return { contextCard };
    },
  }),
];
