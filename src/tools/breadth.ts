import { z } from "zod";
import { defineTool } from "./defineTool.js";
import type {
  ToolDefinition,
  RiskLevel,
  SideEffect,
  RetryPolicy,
} from "../agent/toolRegistry.js";
import type { ArtifactType } from "../artifacts/index.js";
import { assertSourceAllowed } from "../safety/sourceScopes.js";

/**
 * Breadth factory.
 *
 * The chain-critical tools are hand-written with real fixture-backed handlers.
 * The remaining tools from the Tool Namespace Registry are declared here with
 * full metadata and a single uniform mock handler. This keeps the registry at
 * its intended ~78 tools across 12 namespaces without 78 bespoke bodies, and
 * proves the registry scales to 50+ tools without conditional-dispatch sprawl.
 *
 * Mock handlers echo their input and self-describe; source-read mocks still
 * enforce consent scopes so the safety boundary holds even for stubs.
 */

interface NamespacePolicy {
  sideEffects: SideEffect;
  riskLevel: RiskLevel;
  consent: (ns: string) => string[];
  produces: ArtifactType[];
  consumes: ArtifactType[];
  rateLimitKey?: (ns: string) => string;
  retryPolicy?: RetryPolicy;
  sourceRead?: boolean;
}

const SOURCE_POLICY: NamespacePolicy = {
  sideEffects: "source_read",
  riskLevel: "medium",
  consent: (ns) => [`${ns}:read`],
  produces: ["RawSourceItem"],
  consumes: [],
  rateLimitKey: (ns) => `connector:${ns}`,
  retryPolicy: "source_api",
  sourceRead: true,
};

const NS_POLICY: Record<string, NamespacePolicy> = {
  slack: SOURCE_POLICY,
  email: SOURCE_POLICY,
  calendar: SOURCE_POLICY,
  meeting: { ...SOURCE_POLICY, consent: () => ["meeting:read"] },
  doc: SOURCE_POLICY,
  graph: {
    sideEffects: "graph_write",
    riskLevel: "medium",
    consent: () => [],
    produces: ["Constellation"],
    consumes: ["Signal", "DotLink"],
  },
  constellation: {
    sideEffects: "graph_write",
    riskLevel: "low",
    consent: () => [],
    produces: ["Constellation"],
    consumes: ["Constellation"],
  },
  subagent: {
    sideEffects: "none",
    riskLevel: "medium",
    consent: () => [],
    produces: ["Signal"],
    consumes: ["Signal"],
  },
  brief: {
    sideEffects: "brief_write",
    riskLevel: "low",
    consent: () => [],
    produces: ["Brief"],
    consumes: ["Constellation"],
  },
};

/** Source mapping for meeting (namespace "meeting" maps to source "meeting_transcript"). */
const NS_SOURCE: Record<string, string> = {
  slack: "slack",
  email: "email",
  calendar: "calendar",
  meeting: "meeting_transcript",
  doc: "doc",
};

/** Tools from the namespace registry that are NOT hand-written. */
const BREADTH_TOOLS: Record<string, string[]> = {
  slack: ["list_channels", "fetch_thread", "extract_permalink", "classify_message", "extract_mentions"],
  email: [
    "extract_recipients",
    "extract_subject_line",
    "extract_quoted_history",
    "classify_thread",
    "extract_attachments",
  ],
  calendar: ["extract_attendees", "extract_agenda", "extract_meeting_link", "map_event_to_transcript"],
  meeting: [
    "segment_transcript",
    "extract_decisions",
    "extract_action_items",
    "extract_topics",
    "map_speaker_to_contact",
    "summarize_segment",
  ],
  doc: ["extract_title", "extract_sections", "extract_mentions", "extract_links", "map_doc_to_project"],
  graph: ["merge_clusters", "split_cluster"],
  constellation: ["create_constellation", "rename_constellation"],
  subagent: ["spawn_source_scout"],
  brief: [
    "generate_daily_dot_digest",
    "generate_meeting_prep_context",
    "generate_reply_context",
    "generate_project_timeline",
    "generate_unresolved_asks_report",
  ],
};

export function buildBreadthTools(existing: Set<string>): ToolDefinition<any, any>[] {
  const tools: ToolDefinition<any, any>[] = [];

  for (const [ns, names] of Object.entries(BREADTH_TOOLS)) {
    const policy = NS_POLICY[ns] ?? {
      sideEffects: "none",
      riskLevel: "low",
      consent: () => [],
      produces: [],
      consumes: [],
    };
    for (const short of names) {
      const name = `${ns}.${short}`;
      if (existing.has(name)) continue;

      tools.push(
        defineTool({
          name,
          namespace: ns,
          description: `[scaffold mock] ${ns}.${short.replace(/_/g, " ")}.`,
          inputSchema: z.record(z.unknown()),
          outputSchema: z.record(z.unknown()),
          consumes: policy.consumes,
          produces: policy.produces,
          sideEffects: policy.sideEffects,
          riskLevel: policy.riskLevel,
          requiredConsentScopes: policy.consent(ns),
          rateLimitKey: policy.rateLimitKey?.(ns),
          retryPolicy: policy.retryPolicy,
          handler: async (input, ctx) => {
            if (policy.sourceRead) {
              assertSourceAllowed(ctx.scopes, { source: NS_SOURCE[ns] ?? ns });
            }
            ctx.metrics.increment("constellation_mock_tool_calls_total", { namespace: ns });
            return { tool: name, mock: true, received: input };
          },
        }),
      );
    }
  }

  return tools;
}
