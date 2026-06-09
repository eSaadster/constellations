import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SourceAuthError, SourceUnavailableError } from "../../resilience/errors.js";
import {
  mcporterConfigFromEnv,
  type McporterClientLike,
  type McporterConfig,
  type McporterToolCall,
} from "./types.js";

/**
 * Minimal structural views of the bits of mcporter we use. We avoid a
 * build-time type import of the optional `mcporter` package by re-declaring the
 * shapes locally (mcporter is an optionalDependency, lazily loaded).
 */
interface CallResultLike {
  text(joiner?: string): string | null;
  json<J = unknown>(): J | null;
}
interface RuntimeLike {
  listTools(
    server: string,
    options?: { includeSchema?: boolean },
  ): Promise<Array<{ name: string; description?: string }>>;
  callTool(
    server: string,
    toolName: string,
    options?: { args?: Record<string, unknown>; timeoutMs?: number },
  ): Promise<unknown>;
  close(server?: string): Promise<void>;
}
interface McporterModule {
  createRuntime(options: { configPath?: string }): Promise<RuntimeLike>;
  createCallResult<T = unknown>(raw: T): CallResultLike;
}

/**
 * mcporter bridge client.
 *
 * Lazily imports the optional `mcporter` package so the repo builds and tests
 * pass without it installed. `load()` writes the configured server definitions
 * to a temp `mcpServers` config file and constructs a `Runtime` from it (the
 * configPath route is the reliable way to attach custom headers in v0.11.3).
 *
 * NOTE: mcporter resolves its own dependencies from this project's
 * `node_modules`, so the host process must run from the constellation repo
 * root. The runtime entrypoints (CLI / RPC / evals) already do.
 *
 * Vendor-neutral: knows about urls + headers, nothing about Composio. No
 * credentials are hardcoded — server definitions (including the Composio
 * consumer-key header) are supplied by the caller via config.
 */
export class McporterClient implements McporterClientLike {
  private runtime?: RuntimeLike;
  private mod?: McporterModule;
  private tmpDir?: string;

  constructor(private readonly config: McporterConfig = mcporterConfigFromEnv()) {}

  private async load(): Promise<RuntimeLike> {
    if (this.runtime) return this.runtime;

    const serverDefs = this.config.serverDefs;
    if (!serverDefs || Object.keys(serverDefs).length === 0) {
      throw new SourceAuthError("no mcporter servers configured", {
        endpoint: this.config.endpoint,
      });
    }

    // Optional dependency: only loaded when actually used.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import(/* @vite-ignore */ "mcporter").catch(() => null)) as
      | McporterModule
      | null;
    if (!mod || typeof mod.createRuntime !== "function") {
      throw new SourceUnavailableError("mcporter package not installed", {});
    }
    this.mod = mod;

    try {
      this.tmpDir = await mkdtemp(join(tmpdir(), "mcporter-"));
      const configPath = join(this.tmpDir, "config.json");
      await writeFile(configPath, JSON.stringify({ mcpServers: serverDefs }), "utf8");
      this.runtime = await mod.createRuntime({ configPath });
      return this.runtime;
    } catch (err) {
      throw new SourceUnavailableError(`failed to initialize mcporter: ${String(err)}`, {});
    }
  }

  async callTool(call: McporterToolCall): Promise<unknown> {
    const runtime = await this.load();
    const mod = this.mod!;
    let raw: unknown;
    try {
      raw = await runtime.callTool(call.server, call.tool, {
        args: call.args,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (err) {
      throw new SourceUnavailableError(`mcporter callTool failed: ${String(err)}`, {
        server: call.server,
        tool: call.tool,
      });
    }
    // Parse the CallResult: prefer structured JSON, fall back to text payload
    // (content[].text), finally the raw object.
    try {
      const cr = mod.createCallResult(raw);
      const asJson = cr.json();
      if (asJson != null) return asJson;
      const text = cr.text();
      if (text != null && text.length > 0) return JSON.parse(text);
      return raw;
    } catch (err) {
      throw new SourceUnavailableError(`mcporter result parse failed: ${String(err)}`, {
        server: call.server,
        tool: call.tool,
      });
    }
  }

  async listTools(server: string): Promise<Array<{ name: string; description?: string }>> {
    const runtime = await this.load();
    try {
      const tools = await runtime.listTools(server, { includeSchema: false });
      return tools.map((t) => ({ name: t.name, description: t.description }));
    } catch (err) {
      throw new SourceUnavailableError(`mcporter listTools failed: ${String(err)}`, { server });
    }
  }

  /** Release the runtime and remove the temp config dir. Optional / additive. */
  async close(): Promise<void> {
    try {
      await this.runtime?.close();
    } catch {
      // best-effort
    }
    this.runtime = undefined;
    if (this.tmpDir) {
      await rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
      this.tmpDir = undefined;
    }
  }
}
