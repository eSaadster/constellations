/**
 * Types for the mcporter bridge. mcporter (https://www.npmjs.com/package/mcporter)
 * is the bridge to external MCP / Composio-style tool servers. This file pins
 * the shape we depend on so the rest of the code does not import the package
 * directly (it is an optional dependency, lazily loaded).
 */

export interface McporterConfig {
  /** Path or URL to the mcporter server / config. */
  endpoint?: string;
  /** Named MCP servers to bridge (e.g. "composio"). */
  servers?: string[];
  /** API token, read from env — never hardcoded. */
  token?: string;
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
    token: env.MCPORTER_TOKEN,
  };
}
