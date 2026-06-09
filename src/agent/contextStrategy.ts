import { createHash } from "node:crypto";

/**
 * ContextStrategy — the plan / call / evidence ledgers that let Constellation
 * run long, composable tool chains while staying coherent and auditable.
 *
 *  - Plan ledger:    phases + ordered steps.
 *  - Call ledger:    every executed call with input hash, output summary, and
 *                    which prior calls it consumed (`consumedFrom`).
 *  - Evidence ledger: claims with supporting signal/link ids and confidence.
 *
 * `resolveInput` composes a step's input from literal values plus references to
 * prior call outputs — this is what makes "downstream tool consumes a prior
 * tool's structured output" true and inspectable.
 */

export interface PlanStepRef {
  fromStep: string;
  /** Optional dot/index path into the source output (e.g. "constellation.id"). */
  path?: string;
  /** Key to place the value under in the resolved input. If omitted and the
   * value is an object, it is merged into the input. */
  as?: string;
}

export interface PlanStep {
  id: string;
  phase: string;
  toolName: string;
  reason: string;
  literalInput?: Record<string, unknown>;
  inputFrom?: PlanStepRef[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface LedgerCall {
  id: string;
  phase: string;
  toolName: string;
  inputHash: string;
  outputSummary: string;
  consumedFrom: string[];
}

export interface EvidenceClaim {
  claim: string;
  signalIds: string[];
  linkIds: string[];
  confidence: number;
}

export interface ContextSnapshot {
  traceId: string;
  task: string;
  phases: string[];
  calls: LedgerCall[];
  evidence: EvidenceClaim[];
  chainOccurred: boolean;
  lastStepId?: string;
}

function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex").slice(0, 12);
}

function summarize(value: unknown): string {
  const json = JSON.stringify(value);
  if (!json) return String(value);
  return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}

export class ContextStrategy {
  private readonly phaseList: string[] = [];
  private readonly calls: LedgerCall[] = [];
  private readonly outputs = new Map<string, unknown>();
  private readonly evidence: EvidenceClaim[] = [];

  constructor(
    private readonly traceId: string,
    private readonly task: string,
  ) {}

  phase(name: string): void {
    if (!this.phaseList.includes(name)) this.phaseList.push(name);
  }

  /** Resolve a step's input from literals + prior outputs. */
  resolveInput(step: PlanStep): { input: Record<string, unknown>; consumedFrom: string[] } {
    const input: Record<string, unknown> = { ...(step.literalInput ?? {}) };
    const consumedFrom: string[] = [];
    for (const ref of step.inputFrom ?? []) {
      if (!this.outputs.has(ref.fromStep)) {
        throw new Error(`step ${step.id} references unknown prior step ${ref.fromStep}`);
      }
      consumedFrom.push(ref.fromStep);
      const value = getByPath(this.outputs.get(ref.fromStep), ref.path);
      if (ref.as) {
        input[ref.as] = value;
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(input, value);
      } else {
        // Non-object whole-output with no `as` — stash under a generic key.
        input.value = value;
      }
    }
    return { input, consumedFrom };
  }

  recordCall(args: {
    step: PlanStep;
    input: unknown;
    output: unknown;
    consumedFrom: string[];
  }): void {
    this.calls.push({
      id: args.step.id,
      phase: args.step.phase,
      toolName: args.step.toolName,
      inputHash: stableHash(args.input),
      outputSummary: summarize(args.output),
      consumedFrom: args.consumedFrom,
    });
    this.outputs.set(args.step.id, args.output);
    this.collectEvidence(args.output);
  }

  private collectEvidence(output: unknown): void {
    if (!output || typeof output !== "object") return;
    const o = output as Record<string, unknown>;
    // Capture evidence from LinkLab proposals and context-card claims.
    const links = (o.proposedLinks ?? o.links) as
      | Array<{ id: string; sourceSignalId: string; targetSignalId: string; confidence: number; relation: string }>
      | undefined;
    if (Array.isArray(links)) {
      for (const l of links) {
        this.evidence.push({
          claim: `${l.sourceSignalId} ${l.relation} ${l.targetSignalId}`,
          signalIds: [l.sourceSignalId, l.targetSignalId],
          linkIds: [l.id],
          confidence: l.confidence,
        });
      }
    }
  }

  getOutput<T = unknown>(stepId: string): T | undefined {
    return this.outputs.get(stepId) as T | undefined;
  }

  chainOccurred(): boolean {
    return this.calls.some((c) => c.consumedFrom.length > 0);
  }

  snapshot(): ContextSnapshot {
    return {
      traceId: this.traceId,
      task: this.task,
      phases: [...this.phaseList],
      calls: [...this.calls],
      evidence: [...this.evidence],
      chainOccurred: this.chainOccurred(),
      lastStepId: this.calls.at(-1)?.id,
    };
  }
}
