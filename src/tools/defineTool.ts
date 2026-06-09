import type { z } from "zod";
import type { ToolDefinition } from "../agent/toolRegistry.js";

/**
 * Authoring helper for tool definitions. Infers `namespace` from the tool name
 * (the substring before the first dot) so authors can't accidentally mismatch
 * name and namespace. Generic over the zod input/output schemas so handlers are
 * typed with the parsed (output) shape.
 */
export function defineTool<In extends z.ZodTypeAny, Out extends z.ZodTypeAny>(
  def: Omit<ToolDefinition<In, Out>, "namespace"> & { namespace?: string },
): ToolDefinition<In, Out> {
  const namespace = def.namespace ?? def.name.split(".")[0]!;
  return { ...def, namespace } as ToolDefinition<In, Out>;
}
