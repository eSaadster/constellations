# Template: `.pi/src/constellation/core/contextStrategy.ts`
#template #pi-core-ai

```ts
export type LedgerCall = {
  id: string;
  phase: string;
  toolName: string;
  inputHash: string;
  outputSummary: string;
  outputRef?: string;
};

export type EvidenceClaim = {
  claim: string;
  signalIds: string[];
  linkIds: string[];
  confidence: number;
};

export function createContextStrategy({ traceId, task }: { traceId: string; task: string }) {
  const phases: string[] = [];
  const calls: LedgerCall[] = [];
  const outputs = new Map<string, unknown>();
  const evidence: EvidenceClaim[] = [];

  return {
    phase(name: string) {
      if (!phases.includes(name)) phases.push(name);
    },
    recordCall({ step, input, output }: any) {
      const id = `call_${calls.length + 1}`;
      calls.push({
        id,
        phase: step.phase,
        toolName: step.toolName,
        inputHash: stableHash(input),
        outputSummary: summarizeOutput(output),
        outputRef: id,
      });
      outputs.set(id, output);
      collectEvidence(output, evidence);
    },
    resolveInput(step: any) {
      return resolveFromLedger(step, outputs);
    },
    finalResult() {
      return { traceId, task, phases, calls, evidence, output: calls.at(-1)?.outputRef };
    },
    renderText(result: any) {
      return `Constellation completed ${result.calls.length} calls. Trace: ${result.traceId}`;
    },
  };
}

function stableHash(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url").slice(0, 16);
}

function summarizeOutput(value: unknown) {
  return JSON.stringify(value).slice(0, 240);
}

function collectEvidence(_output: unknown, _evidence: EvidenceClaim[]) {
  // Extract claim/signal/link references from structured tool outputs.
}

function resolveFromLedger(step: any, outputs: Map<string, unknown>) {
  // Compose structured outputs from prior calls into the next input.
  return step.literalInput ?? {};
}
```
