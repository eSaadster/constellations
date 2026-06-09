import { createConstellationRuntime } from "../../agent/runtime.js";
import { createConnectors } from "../../connectors/index.js";
import { FileGraphStore } from "../../graph/fileStore.js";

/**
 * Optional Pi host adapter (thin).
 *
 * Registers a single `constellation` tool inside a Pi session that delegates to
 * the core runtime. Per the architecture rule, this adapter contains NO planning
 * or orchestration logic — the runtime owns all of that. Typed loosely (`any`)
 * so the repo builds without the optional Pi SDK present.
 *
 * To use: reference this file from a Pi extension entry (see README), or import
 * `registerConstellationExtension` from your own extension.
 */
export function registerConstellationExtension(pi: any): void {
  const runtime = createConstellationRuntime({
    store: new FileGraphStore(process.env.CONSTELLATION_GRAPH ?? "./.constellation/graph.json"),
    connectors: createConnectors(),
  });

  const tool = {
    name: "constellation",
    label: "Constellation",
    description:
      "Discover evidence-backed connections for a Slack/email/calendar/doc signal. " +
      "Returns a provenance-cited Context Card. A connection is not a vibe.",
    parameters: {
      type: "object",
      properties: {
        anchorSignalId: { type: "string", description: "Signal id to anchor on." },
        ingestFirst: { type: "boolean", description: "Ingest fixtures before connecting." },
      },
      required: ["anchorSignalId"],
    },
    execute: async (_toolCallId: string, params: { anchorSignalId: string; ingestFirst?: boolean }) => {
      if (params.ingestFirst) await runtime.ingestFixtures();
      const { contextCard } = await runtime.generateContextCard(params.anchorSignalId);
      return {
        content: [{ type: "text", text: JSON.stringify(contextCard, null, 2) }],
        details: { contextCard },
      };
    },
  };

  pi.registerTool?.(tool);
  pi.on?.("session_start", () => {
    const active: string[] = pi.getActiveTools?.() ?? [];
    if (!active.includes(tool.name)) pi.setActiveTools?.([...active, tool.name]);
  });
}

export default registerConstellationExtension;
