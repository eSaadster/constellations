import { describe, expect, it } from "vitest";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { Metrics } from "../../observability/metrics.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";

// Silence logs during tests.
setLogger(createLogger({ level: "silent" }));

function freshRuntime() {
  return createConstellationRuntime({
    ids: new IdGenerator("t"),
    clock: fixedClock("2026-03-01T00:00:00.000Z"),
  });
}

describe("vertical slice: ingest -> connect -> context-card", () => {
  it("ingests demo fixtures across sources through the pipeline", async () => {
    const rt = freshRuntime();
    const { signalCount, snapshot } = await rt.ingestFixtures();
    expect(signalCount).toBeGreaterThanOrEqual(5);
    // Many composable tool calls happened, and at least one consumed a prior output.
    expect(snapshot.calls.length).toBeGreaterThanOrEqual(20);
    expect(snapshot.chainOccurred).toBe(true);
  });

  it("connects the Slack apollo signal to email/calendar/doc with corroborated evidence", async () => {
    const rt = freshRuntime();
    await rt.ingestFixtures();
    const slack = rt.store
      .listSignals()
      .find((s) => s.source === "slack" && s.title?.includes("Apollo"));
    expect(slack).toBeDefined();

    const result = await rt.connect(slack!.id);
    const confirmed = result.linkResult.proposedLinks.filter((l) => l.status === "confirmed");

    // The apollo cluster should confirm links to calendar/email/doc.
    expect(confirmed.length).toBeGreaterThanOrEqual(2);
    // Every confirmed link is corroborated (shared people or artifacts) — not a vibe.
    for (const link of confirmed) {
      const corroborated =
        link.evidence.sharedPeople.length > 0 || (link.evidence.artifactOverlap?.length ?? 0) > 0;
      expect(corroborated).toBe(true);
    }
    // A downstream tool consumed the LinkLab's structured output.
    const commitCall = result.snapshot.calls.find((c) => c.toolName === "graph.commit_links");
    expect(commitCall?.consumedFrom.length).toBeGreaterThan(0);
  });

  it("quarantines (does not confirm) the false-friend 'launch' signal", async () => {
    const rt = freshRuntime();
    await rt.ingestFixtures();
    const hobby = rt.store
      .listSignals()
      .find((s) => s.title?.includes("Model rocket"));
    expect(hobby).toBeDefined();

    const result = await rt.connect(hobby!.id);
    const confirmed = result.linkResult.proposedLinks.filter((l) => l.status === "confirmed");
    // The hobby "launch" message shares only a word with work — never auto-confirmed.
    expect(confirmed.length).toBe(0);
  });

  it("records observability counters for tool calls and subagent runs", async () => {
    const metrics = new Metrics();
    const rt = createConstellationRuntime({
      metrics,
      ids: new IdGenerator("m"),
      clock: fixedClock("2026-03-01T00:00:00.000Z"),
    });
    await rt.ingestFixtures();
    const slack = rt.store.listSignals().find((s) => s.source === "slack" && s.title?.includes("Apollo"));
    await rt.connect(slack!.id);
    expect(metrics.getCounter("constellation_tool_calls_total", { namespace: "signal" })).toBeGreaterThan(0);
    expect(metrics.getCounter("constellation_subagent_runs_total", { agent: "LinkLabAgent" })).toBeGreaterThan(0);
    // Spans recorded for tool calls + subagent runs.
    expect(metrics.getCounter("constellation_span_total", { kind: "tool_call" })).toBeGreaterThan(0);
    expect(metrics.getCounter("constellation_span_total", { kind: "subagent_run" })).toBeGreaterThan(0);
  });

  it("generates a context card whose claims cite provenance", async () => {
    const rt = freshRuntime();
    await rt.ingestFixtures();
    const slack = rt.store
      .listSignals()
      .find((s) => s.source === "slack" && s.title?.includes("Apollo"));
    const { contextCard } = await rt.generateContextCard(slack!.id);

    expect(contextCard.connections.length).toBeGreaterThan(0);
    // Verified claims must cite at least one signal and one link.
    for (const claim of contextCard.claims) {
      if (claim.status === "verified") {
        expect(claim.signalIds.length).toBeGreaterThan(0);
        expect(claim.linkIds.length).toBeGreaterThan(0);
      }
    }
    expect(contextCard.provenanceTraceId).toBeTruthy();
  });
});
