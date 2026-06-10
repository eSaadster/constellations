import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import { SignalSchema, type Signal } from "../../artifacts/Signal.js";
import { RawSourceItemSchema } from "../../connectors/schema.js";
import { extractFacts, type ExtractInput } from "../../extraction/heuristics.js";
import { sourceHash } from "../../graph/provenance.js";

/**
 * signal.* — normalization + extraction + persistence.
 *
 * Extraction tools are deterministic HEURISTICS (regex + casing rules in
 * `extraction/heuristics.ts`), MERGED with any `extractedHints` carried on the
 * threaded raw item (fixtures supply topical hints; the Composio Slack
 * connector supplies resolved mention identities). The Signal and its raw item
 * are threaded together so the tools compose into a chain through the
 * orchestrator's call ledger.
 */

const SignalWithRaw = z.object({ signal: SignalSchema, raw: RawSourceItemSchema });

function uniq(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

/** Heuristic facts for the threaded raw item (full text, not the excerpt). */
function factsOf(raw: { source: ExtractInput["source"]; title?: string; text: string }) {
  return extractFacts({ source: raw.source, title: raw.title, text: raw.text });
}

export const signalTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "signal.normalize_signal",
    description: "Normalize a raw source item into a Signal shell with provenance and a source hash.",
    inputSchema: z.object({ raw: RawSourceItemSchema }),
    outputSchema: SignalWithRaw,
    consumes: ["RawSourceItem"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ raw }, ctx) => {
      const signal: Signal = {
        id: ctx.ids.next("sig"),
        source: raw.source,
        externalId: raw.externalId,
        url: raw.url,
        actorIds: uniq(raw.actorIds ?? []),
        timestamp: raw.timestamp,
        title: raw.title,
        excerpt: raw.text.length > 400 ? `${raw.text.slice(0, 397)}...` : raw.text,
        fullTextRef: `ref://${raw.source}/${raw.externalId}`,
        extracted: {
          entities: [],
          people: [],
          projects: [],
          dates: [],
          artifacts: [],
          asks: [],
          decisions: [],
        },
        provenance: {
          ingestedBy: `${raw.source}.connector`,
          ingestedAt: ctx.clock(),
          sourceHash: sourceHash([raw.source, raw.externalId, raw.text]),
        },
      };
      return { signal, raw };
    },
  }),

  defineTool({
    name: "signal.extract_entities",
    description: "Extract entities and projects mentioned in a Signal.",
    inputSchema: SignalWithRaw,
    outputSchema: SignalWithRaw,
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }) => {
      const hints = raw.extractedHints;
      const derived = factsOf(raw);
      return {
        raw,
        signal: {
          ...signal,
          extracted: {
            ...signal.extracted,
            entities: uniq([
              ...signal.extracted.entities,
              ...(hints?.entities ?? []),
              ...derived.entities,
            ]),
            projects: uniq([...signal.extracted.projects, ...(hints?.projects ?? [])]),
          },
        },
      };
    },
  }),

  defineTool({
    name: "signal.extract_people",
    description: "Extract people referenced in a Signal (hints + @mentions).",
    inputSchema: SignalWithRaw,
    outputSchema: SignalWithRaw,
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }) => {
      const derived = factsOf(raw).people;
      return {
        raw,
        signal: {
          ...signal,
          extracted: {
            ...signal.extracted,
            people: uniq([
              ...signal.extracted.people,
              ...(raw.extractedHints?.people ?? []),
              ...derived,
            ]),
          },
        },
      };
    },
  }),

  defineTool({
    name: "signal.extract_projects",
    description: "Extract project names associated with a Signal.",
    inputSchema: SignalWithRaw,
    outputSchema: SignalWithRaw,
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }) => ({
      raw,
      signal: {
        ...signal,
        extracted: {
          ...signal.extracted,
          projects: uniq([...signal.extracted.projects, ...(raw.extractedHints?.projects ?? [])]),
        },
      },
    }),
  }),

  defineTool({
    name: "signal.extract_artifacts",
    description: "Extract artifacts (docs, files, links) referenced in a Signal.",
    inputSchema: SignalWithRaw,
    outputSchema: SignalWithRaw,
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }) => {
      const derived = factsOf(raw).artifacts;
      return {
        raw,
        signal: {
          ...signal,
          extracted: {
            ...signal.extracted,
            artifacts: uniq([
              ...signal.extracted.artifacts,
              ...(raw.extractedHints?.artifacts ?? []),
              ...derived,
            ]),
          },
        },
      };
    },
  }),

  defineTool({
    name: "signal.extract_dates",
    description: "Extract dates, asks, and decisions referenced in a Signal.",
    inputSchema: SignalWithRaw,
    outputSchema: SignalWithRaw,
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }) => {
      const derived = factsOf(raw);
      return {
        raw,
        signal: {
          ...signal,
          extracted: {
            ...signal.extracted,
            dates: uniq([
              ...signal.extracted.dates,
              ...(raw.extractedHints?.dates ?? []),
              ...derived.dates,
            ]),
            asks: uniq([
              ...signal.extracted.asks,
              ...(raw.extractedHints?.asks ?? []),
              ...derived.asks,
            ]),
            decisions: uniq([
              ...signal.extracted.decisions,
              ...(raw.extractedHints?.decisions ?? []),
              ...derived.decisions,
            ]),
          },
        },
      };
    },
  }),

  defineTool({
    name: "signal.dedupe_signal",
    description: "Check whether a Signal already exists in the graph by source + externalId.",
    inputSchema: SignalWithRaw,
    outputSchema: z.object({
      signal: SignalSchema,
      raw: RawSourceItemSchema,
      duplicateOfId: z.string().optional(),
    }),
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal, raw }, ctx) => {
      const existing = ctx.store.findSignalByExternalId(signal.source, signal.externalId);
      return { signal, raw, duplicateOfId: existing?.id };
    },
  }),

  defineTool({
    name: "signal.create_signal",
    description: "Persist a normalized, extracted Signal as a node in the context graph.",
    inputSchema: SignalWithRaw,
    outputSchema: z.object({ signalId: z.string(), signal: SignalSchema }),
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "graph_write",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal }, ctx) => {
      const stored = ctx.store.addSignal(signal);
      return { signalId: stored.id, signal: stored };
    },
  }),
];
