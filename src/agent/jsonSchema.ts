import { z } from "zod";
import { ToolSchemaError } from "../resilience/errors.js";

/**
 * Minimal zod -> JSON Schema converter.
 *
 * Covers the subset used by Constellation tool input schemas (objects, strings,
 * numbers, booleans, arrays, enums, literals, unions of literals, records,
 * optionals, defaults, nullables). This exists so `ToolRegistry.toPiTools()` can
 * hand a real JSON Schema to a model-driven host without pulling in a heavy
 * dependency.
 *
 * Fidelity matters: the Pi Anthropic provider forwards the emitted
 * `properties`/`required` VERBATIM into the model-facing tool `input_schema`, so
 * every constraint dropped here is a constraint the model never sees (and a
 * preventable invalid tool call that only fails later at the Zod gate). The
 * converter therefore emits numeric/string bounds, formats, enum/const,
 * defaults, and nullability — and FAILS LOUD (ToolSchemaError) on any zod node
 * it cannot represent, rather than silently emitting an "accept anything" `{}`.
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
  if (schema instanceof z.ZodString) return stringSchema(schema);
  if (schema instanceof z.ZodNumber) return numberSchema(schema);
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...(schema.options as string[])] };
  }
  if (schema instanceof z.ZodNativeEnum) {
    // Numeric enums duplicate values via reverse-mapping keys; keep distinct values.
    const values = [...new Set(Object.values(schema.enum as Record<string, unknown>))];
    return { enum: values };
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
  if (schema instanceof z.ZodTuple) {
    const items = (schema._def.items as z.ZodTypeAny[]).map((i) => zodToJsonSchema(i));
    return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
  }
  if (schema instanceof z.ZodIntersection) {
    return {
      allOf: [zodToJsonSchema(schema._def.left), zodToJsonSchema(schema._def.right)],
    };
  }
  if (schema instanceof z.ZodNullable) {
    // Preserve `null` as a permissible value alongside the inner type.
    return nullable(zodToJsonSchema(schema.unwrap()));
  }
  if (schema instanceof z.ZodOptional) {
    // Optionality is conveyed by absence from the parent's `required`; the
    // schema itself is just the inner type.
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodToJsonSchema(schema._def.innerType);
    inner.default = schema._def.defaultValue();
    return inner;
  }
  if (schema instanceof z.ZodEffects) {
    // Refinements/transforms are not expressible in JSON Schema; the base shape
    // is what the model needs, and our own execute() re-validates with Zod.
    return zodToJsonSchema(schema._def.schema);
  }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return {};
  }
  // Fail loud: an unrepresentable zod node would otherwise ship an unvalidated
  // "accept anything" schema to the model. Verified that no currently-registered
  // tool input schema reaches this branch; if one is added, it surfaces at
  // registration/startup rather than as silent model under-specification.
  const typeName = (schema as { _def?: { typeName?: string } })._def?.typeName ?? "unknown";
  throw new ToolSchemaError(`zodToJsonSchema: unsupported zod type ${typeName}`, { typeName });
}

/** Map a ZodNumber's checks to JSON-Schema numeric constraints. */
function numberSchema(schema: z.ZodNumber): JsonSchema {
  const out: JsonSchema = { type: "number" };
  const checks = (schema._def.checks ?? []) as Array<Record<string, unknown>>;
  for (const check of checks) {
    switch (check.kind) {
      case "int":
        out.type = "integer";
        break;
      case "min":
        if (check.inclusive) out.minimum = check.value as number;
        else out.exclusiveMinimum = check.value as number;
        break;
      case "max":
        if (check.inclusive) out.maximum = check.value as number;
        else out.exclusiveMaximum = check.value as number;
        break;
      case "multipleOf":
        out.multipleOf = check.value as number;
        break;
    }
  }
  return out;
}

/** Map a ZodString's checks to JSON-Schema string constraints/formats. */
function stringSchema(schema: z.ZodString): JsonSchema {
  const out: JsonSchema = { type: "string" };
  const checks = (schema._def.checks ?? []) as Array<Record<string, unknown>>;
  for (const check of checks) {
    switch (check.kind) {
      case "min":
        out.minLength = check.value as number;
        break;
      case "max":
        out.maxLength = check.value as number;
        break;
      case "length":
        out.minLength = check.value as number;
        out.maxLength = check.value as number;
        break;
      case "regex":
        out.pattern = (check.regex as RegExp).source;
        break;
      case "email":
        out.format = "email";
        break;
      case "url":
        out.format = "uri";
        break;
      case "uuid":
        out.format = "uuid";
        break;
      case "datetime":
        out.format = "date-time";
        break;
    }
  }
  return out;
}

/** Add `null` as a permissible value to an already-converted schema. */
function nullable(inner: JsonSchema): JsonSchema {
  if (typeof inner.type === "string") {
    return { ...inner, type: [inner.type, "null"] };
  }
  if (Array.isArray(inner.type)) {
    return inner.type.includes("null") ? inner : { ...inner, type: [...inner.type, "null"] };
  }
  // No simple `type` (e.g. anyOf/allOf/const): widen via anyOf.
  return { anyOf: [inner, { type: "null" }] };
}

function isOptional(schema: z.ZodTypeAny): boolean {
  // A field is omittable from `required` only when it is genuinely optional or
  // has a default. A bare `.nullable()` is NOT optional — it must be present,
  // just possibly null — so it stays required (and `null` is carried in `type`).
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema.isOptional?.() === true
  );
}
