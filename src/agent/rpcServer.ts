import { StringDecoder } from "node:string_decoder";
import { ConstellationRuntime, createConstellationRuntime } from "./runtime.js";
import { runEvalCase, runAllEvals, getEvalCase, listEvalCaseNames } from "../evals/index.js";
import { Tracer } from "../observability/traces.js";
import { getLogger, createLogger, setLogger, type ConstellationLogger } from "../observability/logger.js";
import { isConstellationError } from "../resilience/errors.js";

/**
 * Constellation RPC service.
 *
 * Domain-specific JSON-RPC over a transport-agnostic dispatch MAP (not an
 * if/else chain). Commands: health, ingest, connect, context-card, eval. The
 * default transport is stdio JSONL (LF-framed, matching Pi's RPC convention) so
 * the service can be embedded as a subprocess.
 *
 * Each request is wrapped in an `rpc_request` trace span for observability.
 */

export interface RpcRequest {
  id?: string;
  command: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: { message: string; code?: string };
}

type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class RpcServer {
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly tracer: Tracer;

  constructor(
    private readonly runtime: ConstellationRuntime = createConstellationRuntime(),
    private readonly logger: ConstellationLogger = getLogger(),
  ) {
    this.tracer = new Tracer(this.logger);
    this.registerDefaultCommands();
  }

  register(command: string, handler: RpcHandler): void {
    this.handlers.set(command, handler);
  }

  commands(): string[] {
    return [...this.handlers.keys()];
  }

  private registerDefaultCommands(): void {
    this.register("health", async () => this.runtime.health());

    this.register("ingest", async () => this.runtime.ingestFixtures());

    this.register("connect", async (params) => {
      const signalId = requireString(params, "signalId");
      return this.runtime.connect(signalId);
    });

    this.register("context-card", async (params) => {
      const signalId = requireString(params, "signalId");
      return this.runtime.generateContextCard(signalId);
    });

    this.register("eval", async (params) => {
      const name = typeof params.caseName === "string" ? params.caseName : undefined;
      if (!name) return { cases: listEvalCaseNames(), results: await runAllEvals() };
      const c = getEvalCase(name);
      if (!c) throw new Error(`unknown eval case: ${name}`);
      return runEvalCase(c);
    });
  }

  /** Transport-agnostic dispatch. */
  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const handler = this.handlers.get(request.command);
    const span = this.tracer.start({ task: `rpc:${request.command}` }).span("rpc_request", request.command, {
      hasParams: Boolean(request.params),
    });
    if (!handler) {
      span.fail(new Error("unknown command"));
      return {
        id: request.id,
        type: "response",
        command: request.command,
        success: false,
        error: { message: `unknown command: ${request.command}` },
      };
    }
    try {
      const data = await handler(request.params ?? {});
      span.end();
      return { id: request.id, type: "response", command: request.command, success: true, data };
    } catch (err) {
      span.fail(err);
      const message = err instanceof Error ? err.message : String(err);
      const code = isConstellationError(err) ? err.code : undefined;
      return {
        id: request.id,
        type: "response",
        command: request.command,
        success: false,
        error: { message, code },
      };
    }
  }
}

/** Attach an LF-framed JSONL reader to a stream (Pi-compatible framing). */
export function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim()) onLine(line);
    }
  });
}

/** Start the stdio JSONL transport. Protocol JSON goes to stdout; logs to stderr. */
export function startStdioRpc(existingServer?: RpcServer): void {
  // Keep stdout clean for protocol frames — set the stderr logger BEFORE building
  // the server, so every component captures the stderr-routed logger.
  setLogger(createLogger({ toStderr: true, level: process.env.LOG_LEVEL ?? "info" }));
  const server = existingServer ?? new RpcServer();
  const write = (res: RpcResponse) => process.stdout.write(`${JSON.stringify(res)}\n`);

  attachJsonlReader(process.stdin, (line) => {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch (err) {
      write({
        type: "response",
        command: "parse",
        success: false,
        error: { message: `failed to parse: ${String(err)}` },
      });
      return;
    }
    void server.dispatch(request).then(write);
  });

  process.stdin.resume();
  getLogger().info({ event: "rpc_listening", commands: server.commands() }, "Constellation RPC listening on stdio");
}

// Run directly: `tsx src/agent/rpcServer.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startStdioRpc();
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || !v) throw new Error(`missing required string param: ${key}`);
  return v;
}
