import type { Plan, PlanStep } from "./contextStrategy.js";
import type { RawSourceItem } from "../connectors/types.js";
import { SOURCE_LIST_TOOL } from "../tools/sources/connectorTools.js";

/**
 * Planner — constructs declared tool-call plans from registry metadata + task
 * shape. Plans are DATA (ordered, typed steps with explicit input wiring), not a
 * conditional router. A model-driven planner could produce the same `Plan`
 * shape; the deterministic planner here makes the scaffold runnable offline and
 * keeps evals reproducible.
 */

/** Per-item ingest pipeline: normalize -> extract* -> create. Each step
 * consumes the prior step's output, forming a real composable chain. */
export function buildIngestItemSteps(item: RawSourceItem, index: number): PlanStep[] {
  const tag = `${item.source}_${index}`;
  const chain: Array<{ id: string; tool: string }> = [
    { id: `norm_${tag}`, tool: "signal.normalize_signal" },
    { id: `ent_${tag}`, tool: "signal.extract_entities" },
    { id: `ppl_${tag}`, tool: "signal.extract_people" },
    { id: `prj_${tag}`, tool: "signal.extract_projects" },
    { id: `art_${tag}`, tool: "signal.extract_artifacts" },
    { id: `dat_${tag}`, tool: "signal.extract_dates" },
    { id: `crt_${tag}`, tool: "signal.create_signal" },
  ];

  return chain.map((node, i) => ({
    id: node.id,
    phase: "ingest",
    toolName: node.tool,
    reason: i === 0 ? `normalize ${item.source} item` : `enrich/persist ${item.source} signal`,
    literalInput: i === 0 ? { raw: item } : undefined,
    inputFrom: i === 0 ? undefined : [{ fromStep: chain[i - 1]!.id }],
  }));
}

/** Fetch step for one source's raw items (used before per-item pipelines). */
export function buildFetchStep(
  source: string,
  query: { since?: string; until?: string; limit?: number } = {},
): PlanStep {
  const tool = SOURCE_LIST_TOOL[source];
  if (!tool) throw new Error(`no list tool for source ${source}`);
  return {
    id: `fetch_${source}`,
    phase: "fetch",
    toolName: tool,
    reason: `list raw items from ${source}`,
    literalInput: { ...query },
  };
}

/** The connect chain: candidates -> LinkLab -> collect -> commit -> cluster. */
export function buildConnectSteps(anchorSignalId: string): PlanStep[] {
  return [
    {
      id: "find",
      phase: "connect",
      toolName: "link.find_candidate_links",
      reason: "gather candidate signals (high recall)",
      literalInput: { anchorSignalId },
    },
    {
      id: "lab",
      phase: "connect",
      toolName: "subagent.spawn_link_lab",
      reason: "forensically score candidates in an isolated LinkLab",
      inputFrom: [{ fromStep: "find" }],
    },
    {
      id: "collect",
      phase: "connect",
      toolName: "subagent.collect_result",
      reason: "collect proposed links from the LinkLab result",
      inputFrom: [{ fromStep: "lab" }],
    },
    {
      id: "commit",
      phase: "graph_update",
      toolName: "graph.commit_links",
      reason: "persist non-rejected links as edges",
      inputFrom: [{ fromStep: "collect" }],
    },
    {
      id: "cluster",
      phase: "graph_update",
      toolName: "constellation.update_constellation",
      reason: "build/update the constellation cluster around the anchor",
      literalInput: { anchorSignalId },
    },
  ];
}

export function buildConnectPlan(anchorSignalId: string): Plan {
  return {
    goal: `Connect dots for ${anchorSignalId}`,
    steps: buildConnectSteps(anchorSignalId),
  };
}

/**
 * Discovery-only chain: candidates -> LinkLab -> collect, WITHOUT the commit and
 * cluster steps. `connect-all` runs this for every anchor to gather proposed
 * links across the whole graph before a single dedupe + commit + cluster pass.
 */
export function buildDiscoverPlan(anchorSignalId: string): Plan {
  const discoverStepIds = new Set(["find", "lab", "collect"]);
  return {
    goal: `Discover candidate links for ${anchorSignalId}`,
    steps: buildConnectSteps(anchorSignalId).filter((s) => discoverStepIds.has(s.id)),
  };
}

export function buildContextCardPlan(anchorSignalId: string): Plan {
  return {
    goal: `Generate context card for ${anchorSignalId}`,
    steps: [
      ...buildConnectSteps(anchorSignalId),
      {
        id: "card",
        phase: "brief",
        toolName: "constellation.generate_context_card",
        reason: "render the user-facing, citation-backed context card",
        literalInput: { anchorSignalId },
        inputFrom: [{ fromStep: "cluster", path: "constellationId", as: "constellationId" }],
      },
    ],
  };
}
