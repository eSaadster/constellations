import { randomUUID } from "node:crypto";
import { getLogger, type ConstellationLogger } from "./logger.js";
import { metrics, type Metrics } from "./metrics.js";

/**
 * Tracing for Constellation.
 *
 * A `Trace` represents one run (an RPC request, a CLI command, an eval case).
 * Spans capture the six observability surfaces required by the spec:
 *   - tool calls
 *   - RPC requests
 *   - connector calls
 *   - subagent runs
 *   - graph mutations
 *   - confidence decisions
 *
 * The same Tracer instance is threaded through the orchestrator's executor loop
 * and the SubagentRuntime, so every tool call and subagent run is traced
 * structurally — no per-tool instrumentation required.
 */

export type SpanKind =
  | "rpc_request"
  | "tool_call"
  | "connector_call"
  | "subagent_run"
  | "graph_mutation"
  | "confidence_decision"
  | "plan"
  | "phase";

export interface SpanRecord {
  id: string;
  traceId: string;
  parentId?: string;
  kind: SpanKind;
  name: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
  error?: { message: string; code?: string };
}

export interface Span {
  readonly id: string;
  setAttributes(attrs: Record<string, unknown>): void;
  end(attrs?: Record<string, unknown>): SpanRecord;
  fail(error: unknown, attrs?: Record<string, unknown>): SpanRecord;
}

export interface Trace {
  readonly id: string;
  readonly task?: string;
  span(kind: SpanKind, name: string, attributes?: Record<string, unknown>): Span;
  /** Record a confidence-policy decision (start+end in one call). */
  confidenceDecision(info: {
    linkId?: string;
    confidence: number;
    decision: string;
    rationale?: string;
  }): SpanRecord;
  /** Record a graph mutation (start+end in one call). */
  graphMutation(info: { op: string; entityType: string; entityId: string }): SpanRecord;
  records(): SpanRecord[];
  complete(result?: unknown): void;
}

export class Tracer {
  constructor(
    private readonly logger: ConstellationLogger = getLogger(),
    private readonly metricsSink: Metrics = metrics,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  start(opts: { task?: string; mode?: string; traceId?: string } = {}): Trace {
    const traceId = opts.traceId ?? randomUUID();
    const spans: SpanRecord[] = [];
    const logger = this.logger.child({ traceId, mode: opts.mode });
    const metricsSink = this.metricsSink;
    const clock = this.clock;

    logger.info({ event: "trace_start", task: opts.task }, "trace started");

    const makeSpan = (kind: SpanKind, name: string, attributes: Record<string, unknown>): Span => {
      const record: SpanRecord = {
        id: randomUUID(),
        traceId,
        kind,
        name,
        startMs: clock(),
        attributes: { ...attributes },
        status: "ok",
      };
      spans.push(record);
      metricsSink.increment("constellation_span_total", { kind });
      logger.debug({ event: "span_start", kind, name, attributes }, "span start");

      const finish = (status: "ok" | "error", extra?: Record<string, unknown>): SpanRecord => {
        record.endMs = clock();
        record.durationMs = record.endMs - record.startMs;
        record.status = status;
        if (extra) record.attributes = { ...record.attributes, ...extra };
        metricsSink.observe("constellation_span_duration_ms", record.durationMs, { kind });
        if (status === "error") metricsSink.increment("constellation_span_errors_total", { kind });
        logger[status === "error" ? "warn" : "debug"](
          { event: "span_end", kind, name, status, durationMs: record.durationMs },
          "span end",
        );
        return record;
      };

      return {
        id: record.id,
        setAttributes(attrs) {
          record.attributes = { ...record.attributes, ...attrs };
        },
        end(extra) {
          return finish("ok", extra);
        },
        fail(error, extra) {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code: unknown }).code)
              : undefined;
          record.error = { message, code };
          return finish("error", extra);
        },
      };
    };

    return {
      id: traceId,
      task: opts.task,
      span: makeSpan,
      confidenceDecision(info) {
        const span = makeSpan("confidence_decision", info.decision, info);
        logger.info({ event: "confidence_decision", ...info }, "confidence decision");
        return span.end();
      },
      graphMutation(info) {
        const span = makeSpan("graph_mutation", info.op, info);
        logger.info({ event: "graph_mutation", ...info }, "graph mutation");
        return span.end();
      },
      records() {
        return spans;
      },
      complete(result) {
        logger.info(
          { event: "trace_complete", spanCount: spans.length },
          "trace complete",
        );
        void result;
      },
    };
  }
}

/** Convenience factory using the process-wide logger + metrics. */
export function createTracer(): Tracer {
  return new Tracer();
}
