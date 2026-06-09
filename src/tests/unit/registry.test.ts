import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, scopedRegistry } from "../../agent/toolRegistry.js";
import { defineTool } from "../../tools/defineTool.js";
import { createToolRegistry } from "../../tools/index.js";
import { ToolSchemaError } from "../../resilience/errors.js";
import { makeTestContext } from "../helpers/context.js";

const echo = defineTool({
  name: "test.echo",
  description: "echo input",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ value: z.string() }),
  consumes: [],
  produces: [],
  sideEffects: "none",
  riskLevel: "low",
  requiredConsentScopes: [],
  handler: async ({ value }) => ({ value }),
});

describe("ToolRegistry", () => {
  it("registers and resolves tools by name", () => {
    const r = new ToolRegistry();
    r.register(echo);
    expect(r.has("test.echo")).toBe(true);
    expect(r.get("test.echo")?.namespace).toBe("test");
  });

  it("rejects duplicate registration", () => {
    const r = new ToolRegistry();
    r.register(echo);
    expect(() => r.register(echo)).toThrow(/duplicate/);
  });

  it("rejects a name that doesn't match its namespace", () => {
    const r = new ToolRegistry();
    expect(() =>
      r.register({ ...echo, name: "wrong.name", namespace: "test" }),
    ).toThrow(/namespaced/);
  });

  it("executes via the generic path with input validation", async () => {
    const r = new ToolRegistry();
    r.register(echo);
    const ctx = makeTestContext({ registry: r });
    const out = await r.execute("test.echo", { value: "hi" }, ctx);
    expect(out).toEqual({ value: "hi" });
  });

  it("throws ToolSchemaError on bad input", async () => {
    const r = new ToolRegistry();
    r.register(echo);
    const ctx = makeTestContext({ registry: r });
    await expect(r.execute("test.echo", { value: 123 }, ctx)).rejects.toBeInstanceOf(ToolSchemaError);
  });

  it("throws ToolSchemaError on unknown tool", async () => {
    const r = new ToolRegistry();
    const ctx = makeTestContext({ registry: r });
    await expect(r.execute("nope.tool", {}, ctx)).rejects.toBeInstanceOf(ToolSchemaError);
  });
});

describe("full registry", () => {
  const registry = createToolRegistry();

  it("has 50+ tools across the required namespaces", () => {
    expect(registry.size()).toBeGreaterThanOrEqual(50);
    for (const ns of [
      "slack", "email", "calendar", "meeting", "doc", "signal",
      "link", "graph", "constellation", "brief", "consent", "subagent",
    ]) {
      expect(registry.listByNamespace(ns).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("toPiTools() produces a valid Pi tool def for every registry entry", () => {
    const piTools = registry.toPiTools(() => makeTestContext({ registry }));
    expect(piTools.length).toBe(registry.size());
    for (const t of piTools) {
      expect(typeof t.name).toBe("string");
      expect(t.name).not.toContain("."); // Pi-safe names
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeTypeOf("object");
      expect((t.parameters as { type?: string }).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });
});

describe("scopedRegistry", () => {
  it("contains only the allowed tools", () => {
    const parent = createToolRegistry();
    const scoped = scopedRegistry(parent, ["link.score_semantic_overlap", "link.classify_relation"]);
    expect(scoped.size()).toBe(2);
    expect(scoped.has("link.score_semantic_overlap")).toBe(true);
    expect(scoped.has("graph.add_edge")).toBe(false);
  });
});
