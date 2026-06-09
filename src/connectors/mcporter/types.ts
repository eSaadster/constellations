/**
 * Types for the mcporter bridge. mcporter (https://www.npmjs.com/package/mcporter)
 * is the bridge to external MCP / Composio-style tool servers. This file pins
 * the shape we depend on so the rest of the code does not import the package
 * directly (it is an optional dependency, lazily loaded).
 *
 * The bridge is VENDOR-NEUTRAL: it knows about MCP servers, urls, and headers,
 * but nothing about Composio. Composio-specific knowledge (the consumer-key
 * header, the meta-tool router) lives in `../composio/*`, which assembles a
 * `McporterServerDef` and passes it in via config.
 */

/** A remote MCP server definition: a url plus optional custom headers. */
export interface McporterServerDef {
  url: string;
  headers?: Record<string, string>;
}

export interface McporterConfig {
  /** Path or URL to the mcporter server / config (display / back-compat). */
  endpoint?: string;
  /** Named MCP servers to bridge (e.g. "composio"); used for display. */
  servers?: string[];
  /**
   * Structured remote-server definitions, keyed by server name. mcporter v0.11.3
   * constructs remote servers with custom headers most reliably via a written
   * config file (`{ mcpServers: { <name>: { url, headers } } }`); this map is
   * serialized to that temp file in `McporterClient.load()`.
   */
  serverDefs?: Record<string, McporterServerDef>;
  /** Default per-call timeout in milliseconds (optional). */
  timeoutMs?: number;
}

export interface McporterToolCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface McporterClientLike {
  callTool(call: McporterToolCall): Promise<unknown>;
  listTools(server: string): Promise<Array<{ name: string; description?: string }>>;
}

export function mcporterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McporterConfig {
  return {
    endpoint: env.MCPORTER_ENDPOINT,
    servers: env.MCPORTER_SERVERS?.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
