import type { McporterClientLike, McporterToolCall } from "./types.js";

/**
 * In-memory mcporter client for tests. Routes tool calls to registered handlers
 * so connector behavior can be exercised without the real bridge.
 */
export class MockMcporterClient implements McporterClientLike {
  private handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  register(server: string, tool: string, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.handlers.set(`${server}:${tool}`, handler);
  }

  async callTool(call: McporterToolCall): Promise<unknown> {
    const handler = this.handlers.get(`${call.server}:${call.tool}`);
    if (!handler) throw new Error(`no mock handler for ${call.server}:${call.tool}`);
    return handler(call.args);
  }

  async listTools(server: string): Promise<Array<{ name: string; description?: string }>> {
    return [...this.handlers.keys()]
      .filter((k) => k.startsWith(`${server}:`))
      .map((k) => ({ name: k.split(":")[1]! }));
  }
}
