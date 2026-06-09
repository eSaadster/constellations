# Template: `.pi/src/constellation/pi-adapter/tool.ts`
#template #pi-ai #pi-core-ai

```ts
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createConstellationRuntime } from "../core/runtime.js";
import { renderPiToolResult } from "./renderPiResult.js";

const constellationToolSchema = Type.Object({
  task: Type.String({ description: "User goal, e.g. connect this Slack thread to prior context." }),
  anchor: Type.Optional(Type.Object({
    source: Type.Union([
      Type.Literal("slack"),
      Type.Literal("email"),
      Type.Literal("calendar"),
      Type.Literal("meeting_transcript"),
      Type.Literal("doc"),
      Type.Literal("note"),
    ]),
    externalId: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
  })),
  scopes: Type.Array(Type.Object({
    source: Type.String(),
    workspaceId: Type.Optional(Type.String()),
    projectId: Type.Optional(Type.String()),
    timeframe: Type.Optional(Type.String()),
  })),
  mode: Type.Optional(Type.Union([
    Type.Literal("context_card"),
    Type.Literal("meeting_prep"),
    Type.Literal("daily_digest"),
    Type.Literal("graph_update"),
  ])),
  dryRun: Type.Optional(Type.Boolean()),
});

export function createConstellationTool(): ToolDefinition<typeof constellationToolSchema, any> {
  return defineTool({
    name: "constellation",
    label: "Constellation",
    description: "Adapter for the pi-core-ai Constellation runtime.",
    promptSnippet: "Use constellation for cross-source context linking, meeting prep, daily dot digests, and provenance-backed context cards.",
    promptGuidelines: [
      "Use constellation when the user asks what a message, thread, meeting, doc, or decision connects to.",
      "Always provide scoped sources; do not request unbounded personal data ingestion.",
      "Prefer dryRun when the user asks for exploration rather than graph mutation.",
      "Outputs must include evidence references and confidence labels.",
      "The Pi tool is an adapter; pi-core-ai owns planning, execution, context strategy, and subagent isolation.",
    ],
    parameters: constellationToolSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const runtime = createConstellationRuntime({
        cwd: ctx.cwd,
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
        signal,
        onUpdate,
        toolCallId,
      });
      const result = await runtime.run(params);
      return renderPiToolResult(result);
    },
  });
}
```
