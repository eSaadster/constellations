import { SourceAuthError, SourceUnavailableError } from "../../resilience/errors.js";
import {
  mcporterConfigFromEnv,
  type McporterClientLike,
  type McporterConfig,
  type McporterToolCall,
} from "./types.js";

/**
 * mcporter bridge client.
 *
 * Lazily imports the optional `mcporter` package so the repo builds and tests
 * pass without it installed. Real wiring is left as a clearly-marked TODO; until
 * configured, calls raise typed errors rather than guessing. No credentials are
 * hardcoded — config comes from env (MCPORTER_*).
 */
export class McporterClient implements McporterClientLike {
  private impl: unknown;

  constructor(private readonly config: McporterConfig = mcporterConfigFromEnv()) {}

  private async load(): Promise<unknown> {
    if (this.impl) return this.impl;
    if (!this.config.token) {
      throw new SourceAuthError("mcporter token missing (set MCPORTER_TOKEN)", {
        endpoint: this.config.endpoint,
      });
    }
    try {
      // Optional dependency: only loaded when actually used.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ "mcporter").catch(() => null);
      if (!mod) {
        throw new SourceUnavailableError("mcporter package not installed", {});
      }
      // TODO: construct the real mcporter client from `mod` + this.config.
      this.impl = mod;
      return this.impl;
    } catch (err) {
      throw new SourceUnavailableError(`failed to initialize mcporter: ${String(err)}`, {});
    }
  }

  async callTool(call: McporterToolCall): Promise<unknown> {
    await this.load();
    // TODO: forward to the real mcporter client once wired.
    throw new SourceUnavailableError("mcporter.callTool not implemented in scaffold", { call });
  }

  async listTools(server: string): Promise<Array<{ name: string; description?: string }>> {
    await this.load();
    // TODO: forward to the real mcporter client once wired.
    throw new SourceUnavailableError("mcporter.listTools not implemented in scaffold", { server });
  }
}
