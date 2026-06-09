import { z } from "zod";
import { defineTool } from "../defineTool.js";
import type { ToolDefinition } from "../../agent/toolRegistry.js";
import { SignalSchema } from "../../artifacts/Signal.js";
import { isSourceAllowed } from "../../safety/sourceScopes.js";
import { redactSignal } from "../../safety/redaction.js";

/**
 * consent.* — the user-permission surface. These tools never read sources; they
 * gate, redact, and audit. `never mutate external systems by default` is upheld
 * because no consent tool performs a source write.
 */

export const consentTools: ToolDefinition<any, any>[] = [
  defineTool({
    name: "consent.check_scope",
    description: "Check whether a source (optionally scoped to workspace/project) is within approved consent.",
    inputSchema: z.object({
      source: z.string(),
      workspaceId: z.string().optional(),
      projectId: z.string().optional(),
    }),
    outputSchema: z.object({ allowed: z.boolean() }),
    consumes: [],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (req, ctx) => {
      const allowed = isSourceAllowed(ctx.scopes, req);
      ctx.audit.push({ ...req, allowed, at: ctx.clock() });
      return { allowed };
    },
  }),

  defineTool({
    name: "consent.request_source_access",
    description:
      "Record a request for source access (scaffold: returns a pending grant; never auto-approves new scope).",
    inputSchema: z.object({ source: z.string(), reason: z.string().optional() }),
    outputSchema: z.object({ status: z.enum(["pending", "granted", "denied"]), source: z.string() }),
    consumes: [],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ source }, ctx) => {
      const granted = ctx.scopes.some((s) => s.source === source);
      const status = granted ? ("granted" as const) : ("pending" as const);
      return { status, source };
    },
  }),

  defineTool({
    name: "consent.redact_signal",
    description: "Return a redacted copy of a Signal (masks emails, phones, tokens) for safe display/logging.",
    inputSchema: z.object({ signal: SignalSchema }),
    outputSchema: z.object({ signal: SignalSchema }),
    consumes: ["Signal"],
    produces: ["Signal"],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async ({ signal }) => ({ signal: redactSignal(signal) }),
  }),

  defineTool({
    name: "consent.audit_access",
    description: "Return the access audit log accumulated during this run.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      entries: z.array(
        z.object({
          source: z.string(),
          workspaceId: z.string().optional(),
          projectId: z.string().optional(),
          allowed: z.boolean(),
          at: z.string(),
        }),
      ),
    }),
    consumes: [],
    produces: [],
    sideEffects: "none",
    riskLevel: "low",
    requiredConsentScopes: [],
    handler: async (_input, ctx) => ({ entries: ctx.audit }),
  }),
];
