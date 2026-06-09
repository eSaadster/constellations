import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition, RiskLevel } from "../../agent/toolRegistry.js";
import type { SignalSource } from "../../artifacts/Signal.js";
import { RawSourceItemSchema, ConnectorQuerySchema } from "../../connectors/schema.js";
import { assertSourceAllowed } from "../../safety/sourceScopes.js";

/**
 * Source connector tools — the read surface for each external source.
 *
 * These are generated from a per-source config so all sources share the same
 * shape: a list, a read-by-id, and a search tool. Each one:
 *   - asserts the source is within an approved consent scope,
 *   - records a `connector_call` span (observability),
 *   - goes through the connector adapter (mock / mcporter / composio),
 *   - applies the connector's rate limit + retry policy via registry metadata.
 *
 * Source-specific extraction tools (extract_permalink, extract_attendees, ...)
 * are added separately by the generic mock-tool factory.
 */

export interface SourceConfig {
  source: SignalSource;
  namespace: string;
  listName: string;
  readName: string;
  searchName: string;
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  {
    source: "slack",
    namespace: "slack",
    listName: "slack.fetch_recent_messages",
    readName: "slack.read_message",
    searchName: "slack.search_messages",
  },
  {
    source: "email",
    namespace: "email",
    listName: "email.list_threads",
    readName: "email.read_thread",
    searchName: "email.search_email",
  },
  {
    source: "calendar",
    namespace: "calendar",
    listName: "calendar.list_events",
    readName: "calendar.read_event",
    searchName: "calendar.find_nearby_events",
  },
  {
    source: "meeting_transcript",
    namespace: "meeting",
    listName: "meeting.ingest_transcript",
    readName: "meeting.read_transcript",
    searchName: "meeting.search_transcripts",
  },
  {
    source: "doc",
    namespace: "doc",
    listName: "doc.search_docs",
    readName: "doc.read_doc",
    searchName: "doc.find_docs",
  },
];

/** The canonical "list/ingest" tool per source, used by the ingest plan. */
export const SOURCE_LIST_TOOL: Record<string, string> = Object.fromEntries(
  SOURCE_CONFIGS.map((c) => [c.source, c.listName]),
);

const RISK: RiskLevel = "medium";

function buildSourceTools(cfg: SourceConfig): ToolDefinition<any, any>[] {
  const scope = `${cfg.namespace}:read`;
  const rateLimitKey = `connector:${cfg.namespace}`;

  const traceConnector = <T>(
    op: string,
    ctx: Parameters<ToolDefinition["handler"]>[1],
    fn: () => Promise<T>,
  ): Promise<T> => {
    assertSourceAllowed(ctx.scopes, { source: cfg.source });
    const span = ctx.trace.span("connector_call", `${cfg.namespace}.${op}`, {
      source: cfg.source,
    });
    ctx.metrics.increment("constellation_connector_calls_total", { source: cfg.source });
    return fn().then(
      (r) => {
        span.end();
        return r;
      },
      (e) => {
        span.fail(e);
        throw e;
      },
    );
  };

  return [
    defineTool({
      name: cfg.listName,
      namespace: cfg.namespace,
      description: `List recent raw items from ${cfg.source} within an approved consent scope.`,
      inputSchema: ConnectorQuerySchema,
      outputSchema: z.object({ items: z.array(RawSourceItemSchema) }),
      consumes: [],
      produces: ["RawSourceItem"],
      sideEffects: "source_read",
      riskLevel: RISK,
      requiredConsentScopes: [scope],
      rateLimitKey,
      retryPolicy: "source_api",
      handler: async (query, ctx) =>
        traceConnector("list", ctx, async () => ({
          items: await ctx.connectors.get(cfg.source).list(query),
        })),
    }),
    defineTool({
      name: cfg.readName,
      namespace: cfg.namespace,
      description: `Read a single raw item from ${cfg.source} by external id.`,
      inputSchema: z.object({ externalId: z.string() }),
      outputSchema: z.object({ item: RawSourceItemSchema.optional() }),
      consumes: [],
      produces: ["RawSourceItem"],
      sideEffects: "source_read",
      riskLevel: RISK,
      requiredConsentScopes: [scope],
      rateLimitKey,
      retryPolicy: "source_api",
      handler: async ({ externalId }, ctx) =>
        traceConnector("read", ctx, async () => ({
          item: await ctx.connectors.get(cfg.source).fetchById(externalId),
        })),
    }),
    defineTool({
      name: cfg.searchName,
      namespace: cfg.namespace,
      description: `Search ${cfg.source} for raw items matching a query within scope.`,
      inputSchema: ConnectorQuerySchema,
      outputSchema: z.object({ items: z.array(RawSourceItemSchema) }),
      consumes: [],
      produces: ["RawSourceItem"],
      sideEffects: "source_read",
      riskLevel: RISK,
      requiredConsentScopes: [scope],
      rateLimitKey,
      retryPolicy: "source_api",
      handler: async (query, ctx) =>
        traceConnector("search", ctx, async () => ({
          items: await ctx.connectors.get(cfg.source).search(query),
        })),
    }),
  ];
}

export const sourceConnectorTools: ToolDefinition<any, any>[] = SOURCE_CONFIGS.flatMap(
  buildSourceTools,
);

/** Names of all source connector tools (used by the breadth factory to avoid duplicates). */
export const sourceConnectorToolNames = new Set(sourceConnectorTools.map((t) => t.name));
