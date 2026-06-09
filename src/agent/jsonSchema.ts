import { z } from "zod";

/**
 * Minimal zod -> JSON Schema converter.
 *
 * Covers the subset used by Constellation tool input schemas (objects, strings,
 * numbers, booleans, arrays, enums, literals, unions of literals, records,
 * optionals, defaults, nullables). This exists so `ToolRegistry.toPiTools()` can
 * hand a real JSON Schema to a model-driven host (the Pi SDK uses typebox, which
 * also emits JSON Schema) without pulling in a heavy dependency.
 */

export type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as { _def: { description?: string } })._def;
  const base = convert(schema);
  if (def?.description && typeof base === "object") {
    (base as JsonSchema).description = def.description;
  }
  return base;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!isOptional(value)) required.push(key);
    }
    const out: JsonSchema = { type: "object", properties };
    if (required.length) out.required = required;
    out.additionalProperties = false;
    return out;
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...(schema.options as string[])] };
  }
  if (schema instanceof z.ZodLiteral) {
    const value = schema.value;
    return { type: typeof value === "string" ? "string" : typeof value, const: value };
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as z.ZodTypeAny[];
    return { anyOf: options.map((o) => zodToJsonSchema(o)) };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: zodToJsonSchema(schema.valueSchema) };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchema(schema._def.schema);
  }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return {};
  }
  // Fallback: permissive.
  return {};
}

function isOptional(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema.isOptional?.() === true
  );
}
