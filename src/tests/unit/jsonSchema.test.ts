import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../../agent/jsonSchema.js";
import { ToolSchemaError } from "../../resilience/errors.js";

/**
 * The Pi Anthropic provider forwards the emitted `properties`/`required` verbatim
 * into the model-facing tool `input_schema`, so every fact asserted here is
 * something the model either does or does not get to see. These tests pin the
 * fidelity guarantees the model-driven bridge relies on.
 */
describe("zodToJsonSchema (Pi parameter bridge)", () => {
  it("emits object properties and marks non-optional keys required", () => {
    const out = zodToJsonSchema(z.object({ a: z.string(), b: z.number() }));
    expect(out).toMatchObject({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      additionalProperties: false,
    });
    expect(out.required).toEqual(["a", "b"]);
  });

  it("drops optional and defaulted fields from `required` but keeps them in properties", () => {
    const out = zodToJsonSchema(
      z.object({ a: z.string(), b: z.string().optional(), c: z.string().default("x") }),
    );
    expect(out.required).toEqual(["a"]);
    expect(Object.keys(out.properties as object)).toEqual(["a", "b", "c"]);
    expect((out.properties as Record<string, any>).c.default).toBe("x");
  });

  it("keeps a bare .nullable() field REQUIRED and carries null in the type", () => {
    // A nullable-but-not-optional field must be present, just possibly null.
    const out = zodToJsonSchema(z.object({ a: z.string().nullable() }));
    expect(out.required).toEqual(["a"]);
    expect((out.properties as Record<string, any>).a.type).toEqual(["string", "null"]);
  });

  it("recurses into nested objects and arrays", () => {
    const out = zodToJsonSchema(
      z.object({ items: z.array(z.object({ id: z.string() })) }),
    );
    const items = (out.properties as Record<string, any>).items;
    expect(items.type).toBe("array");
    expect(items.items).toMatchObject({ type: "object", properties: { id: { type: "string" } } });
  });

  it("preserves enums, numeric bounds, and string formats the model needs", () => {
    const out = zodToJsonSchema(
      z.object({
        kind: z.enum(["slack", "email"]),
        score: z.number().int().min(0).max(10),
        who: z.string().email(),
      }),
    );
    const p = out.properties as Record<string, any>;
    expect(p.kind).toEqual({ type: "string", enum: ["slack", "email"] });
    expect(p.score).toMatchObject({ type: "integer", minimum: 0, maximum: 10 });
    expect(p.who).toMatchObject({ type: "string", format: "email" });
  });

  it("carries field descriptions through to the schema", () => {
    const out = zodToJsonSchema(z.object({ a: z.string().describe("the anchor id") }));
    expect((out.properties as Record<string, any>).a.description).toBe("the anchor id");
  });

  it("fails loud on an unrepresentable zod node instead of emitting accept-anything", () => {
    expect(() => zodToJsonSchema(z.object({ when: z.date() }))).toThrow(ToolSchemaError);
  });
});
