import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../../tools/index.js";
import { DefaultSubagentRuntime } from "../../subagents/SubagentRuntime.js";
import { scopedRegistry } from "../../agent/toolRegistry.js";
import { Tracer } from "../../observability/traces.js";
import { createLogger } from "../../observability/logger.js";
import { Metrics } from "../../observability/metrics.js";
import { RateLimiterRegistry } from "../../resilience/rateLimit.js";
import { LINK_LAB_ALLOWED_TOOLS } from "../../subagents/types.js";
import { SubagentIsolationError } from "../../resilience/errors.js";
import { fixedClock } from "../../util/ids.js";
import { makeSignal } from "../../evals/cases/_helpers.js";
import { runLinkLab } from "../../subagents/LinkLabAgent.js";
import { makeTestContext } from "../helpers/context.js";

const logger = createLogger({ level: "silent" });

function subagentRuntime() {
  const registry = createToolRegistry();
  const metrics = new Metrics();
  const rateLimiters = new RateLimiterRegistry();
  const trace = new Tracer(logger, metrics).start({ task: "test" });
  return new DefaultSubagentRuntime({ registry, trace, logger, metrics, rateLimiters, clock: fixedClock() });
}

const anchor = makeSignal({
  id: "a",
  source: "slack",
  timestamp: "2026-01-01T10:00:00.000Z",
  excerpt: "Apollo launch review with alice and bob",
  extracted: { people: ["alice", "bob"], projects: ["apollo"], entities: ["launch review"] },
});
const related = makeSignal({
  id: "b",
  source: "calendar",
  timestamp: "2026-01-02T10:00:00.000Z",
  excerpt: "Apollo launch review meeting alice bob",
  extracted: { people: ["alice", "bob"], projects: ["apollo"], entities: ["launch review"] },
});
const unrelated = makeSignal({
  id: "c",
  source: "doc",
  timestamp: "2026-05-01T10:00:00.000Z",
  excerpt: "office snack budget owned by dave",
  extracted: { people: ["dave"], projects: ["facilities"], entities: ["snack budget"] },
});

describe("LinkLabAgent isolation", () => {
  it("returns structured proposedLinks / exclusions / inconclusive", async () => {
    const rt = subagentRuntime();
    const result = await rt.runLinkLab({
      anchorSignal: anchor,
      candidateSignals: [related, unrelated],
      allowedRelations: ["mentions_meeting", "same_topic"],
      thresholdPolicy: { autoConfirmAbove: 0.6, quarantineBelow: 0.35 },
    });
    expect(Array.isArray(result.proposedLinks)).toBe(true);
    expect(Array.isArray(result.exclusions)).toBe(true);
    expect(Array.isArray(result.inconclusive)).toBe(true);
    // related should be proposed/confirmed; unrelated excluded.
    expect(result.proposedLinks.some((l) => l.sourceSignalId === "b" || l.targetSignalId === "b")).toBe(true);
    expect(result.exclusions.some((e) => e.candidateSignalId === "c")).toBe(true);
  });

  it("its scoped registry contains ONLY the five allowed tools", () => {
    const parent = createToolRegistry();
    const scoped = scopedRegistry(parent, LINK_LAB_ALLOWED_TOOLS);
    expect(scoped.size()).toBe(5);
    expect(scoped.has("graph.add_edge")).toBe(false);
    expect(scoped.has("slack.fetch_recent_messages")).toBe(false);
    expect(scoped.has("constellation.generate_context_card")).toBe(false);
  });

  it("a subagent that touches the sealed store throws SubagentIsolationError", async () => {
    // Build a scoped context like the runtime does, but run a tool that uses the store.
    const parent = createToolRegistry();
    const scoped = scopedRegistry(parent, ["graph.add_node"]); // a store-touching tool
    const ctx = makeTestContext({ registry: scoped });
    // Replace store with a sealed proxy mirroring subagent isolation.
    const sealedStore = new Proxy({}, {
      get() {
        throw new SubagentIsolationError("forbidden store access");
      },
    });
    // @ts-expect-error intentionally injecting a sealed store
    ctx.store = sealedStore;
    await expect(
      scoped.execute("graph.add_node", { signal: anchor }, ctx),
    ).rejects.toBeInstanceOf(SubagentIsolationError);
  });

  it("runLinkLab cannot resolve a forbidden tool through its scoped registry", async () => {
    const parent = createToolRegistry();
    const scoped = scopedRegistry(parent, LINK_LAB_ALLOWED_TOOLS);
    const ctx = makeTestContext({ registry: scoped });
    // The scoped registry has no graph tools at all.
    await expect(scoped.execute("graph.add_edge", {}, ctx)).rejects.toThrow(/unknown tool/);
    // Sanity: runLinkLab works with the scoped registry + isolated ctx.
    const result = await runLinkLab(
      {
        anchorSignal: anchor,
        candidateSignals: [related],
        allowedRelations: ["mentions_meeting", "same_topic"],
        thresholdPolicy: { autoConfirmAbove: 0.6, quarantineBelow: 0.35 },
      },
      { registry: scoped, ctx },
    );
    expect(result.proposedLinks.length).toBeGreaterThan(0);
  });
});
