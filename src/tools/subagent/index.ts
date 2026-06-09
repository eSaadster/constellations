import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import { DotLinkSchema, DotLinkRelationSchema } from "../../artifacts/DotLink.js";
import { computeUbiquitousPeople } from "../../graph/discriminative.js";
import { SignalParseError } from "../../resilience/errors.js";

/**
 * subagent.* — tools that spawn isolated subagents and collect their structured
 * results. These tools run in the PARENT context (they may read the store to
 * assemble a payload), but hand off to the SubagentRuntime which enforces
 * isolation. The subagent's internal state never leaks back.
 */

const LinkLabResultSchema = z.object({
  proposedLinks: z.array(DotLinkSchema),
  exclusions: z.array(z.object({ candidateSignalId: z.string(), reason: z.string() })),
  inconclusive: z.array(
    z.object({ candidateSignalId: z.string(), missingEvidence: z.array(z.string()) }),
  ),
});

const ALL_RELATIONS = DotLinkRelationSchema.options;

export const subagentTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "subagent.spawn_link_lab",
    description:
      "Spawn the isolated LinkLabAgent to forensically score candidate links for an anchor signal. Returns proposedLinks, exclusions, and inconclusive.",
    inputSchema: z.object({
      anchorSignalId: z.string(),
      candidateSignalIds: z.array(z.string()),
      allowedRelations: z.array(DotLinkRelationSchema).optional(),
    }),
    outputSchema: LinkLabResultSchema,
    consumes: ["Signal"],
    produces: ["DotLink"],
    sideEffects: "none",
    riskLevel: "medium",
    requiredConsentScopes: [],
    handler: async ({ anchorSignalId, candidateSignalIds, allowedRelations }, ctx) => {
      const anchorSignal = ctx.store.getSignal(anchorSignalId);
      if (!anchorSignal) {
        throw new SignalParseError(`anchor signal not found: ${anchorSignalId}`, { anchorSignalId });
      }
      const candidateSignals = candidateSignalIds
        .map((id) => ctx.store.getSignal(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));

      return ctx.subagents.runLinkLab({
        anchorSignal,
        candidateSignals,
        allowedRelations: allowedRelations ?? [...ALL_RELATIONS],
        thresholdPolicy: ctx.thresholds,
        // Graph-wide stats are computed HERE (parent side, live store) and
        // passed in: the lab is sealed and can never see the graph itself.
        ubiquitousPeople: computeUbiquitousPeople(ctx.store.listSignals()),
      });
    },
  }),

  defineTool({
    name: "subagent.collect_result",
    description: "Collect the proposed links from a LinkLab result for downstream graph commit.",
    inputSchema: LinkLabResultSchema,
    outputSchema: z.object({ links: z.array(DotLinkSchema) }),
    consumes: ["DotLink"],
    produces: ["DotLink"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ proposedLinks }) => ({ links: proposedLinks }),
  }),
];
