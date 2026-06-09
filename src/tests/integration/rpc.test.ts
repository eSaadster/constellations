import { describe, expect, it } from "vitest";
import { RpcServer } from "../../agent/rpcServer.js";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { MockConnectorRegistry } from "../../connectors/mock.js";
import { DEMO_FIXTURES } from "../../connectors/fixtures.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";

setLogger(createLogger({ level: "silent" }));

function server() {
  const runtime = createConstellationRuntime({
    connectors: new MockConnectorRegistry(DEMO_FIXTURES),
    ids: new IdGenerator("rpc"),
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
  });
  return new RpcServer(runtime, createLogger({ level: "silent" }));
}

describe("RPC server", () => {
  it("exposes health/ingest/connect/context-card/eval commands", () => {
    expect(server().commands().sort()).toEqual(
      ["connect", "context-card", "eval", "health", "ingest"].sort(),
    );
  });

  it("health returns registry + store stats", async () => {
    const res = await server().dispatch({ command: "health" });
    expect(res.success).toBe(true);
    expect((res.data as { tools: number }).tools).toBeGreaterThanOrEqual(50);
  });

  it("ingest -> connect -> context-card flow over RPC", async () => {
    const s = server();
    const ingest = await s.dispatch({ id: "1", command: "ingest" });
    expect(ingest.success).toBe(true);
    const signalIds = (ingest.data as { signalIds: string[] }).signalIds;
    expect(signalIds.length).toBeGreaterThanOrEqual(5);

    // Connect from the first signal.
    const connect = await s.dispatch({ id: "2", command: "connect", params: { signalId: signalIds[0] } });
    expect(connect.success).toBe(true);

    const card = await s.dispatch({ id: "3", command: "context-card", params: { signalId: signalIds[0] } });
    expect(card.success).toBe(true);
    expect((card.data as { contextCard: { id: string } }).contextCard.id).toBeTruthy();
  });

  it("returns a typed error for a missing param", async () => {
    const res = await server().dispatch({ command: "connect", params: {} });
    expect(res.success).toBe(false);
    expect(res.error?.message).toMatch(/signalId/);
  });

  it("returns failure for an unknown command", async () => {
    const res = await server().dispatch({ command: "frobnicate" });
    expect(res.success).toBe(false);
  });

  it("runs an eval case over RPC", async () => {
    const res = await server().dispatch({ command: "eval", params: { caseName: "false_friend_topic" } });
    expect(res.success).toBe(true);
    expect((res.data as { passed: boolean }).passed).toBe(true);
  });
});
