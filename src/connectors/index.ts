import type { SignalSource } from "../artifacts/Signal.js";
import { MockConnectorRegistry, type ConnectorDataset } from "./mock.js";
import { ComposioConnector } from "./composio/client.js";
import {
  DEFAULT_COMPOSIO_ENDPOINT,
  DEFAULT_COMPOSIO_SERVER,
  composioConfigFromEnv,
} from "./composio/types.js";
import { McporterClient } from "./mcporter/client.js";
import { DEMO_FIXTURES } from "./fixtures.js";

export * from "./types.js";
export * from "./schema.js";
export { MockConnectorRegistry, MockSourceConnector } from "./mock.js";
export type { ConnectorDataset } from "./mock.js";
export { DEMO_FIXTURES } from "./fixtures.js";

export type ConnectorMode = "mock" | "composio";

/**
 * Sources wired through Composio today (gmail/slack/googlecalendar). doc and
 * meeting_transcript stay on mocks even though DEFAULT_APP_BY_SOURCE maps them.
 */
export const COMPOSIO_SOURCES: SignalSource[] = ["email", "slack", "calendar"];

export interface CreateConnectorsOptions {
  mode?: ConnectorMode;
  dataset?: ConnectorDataset;
  /** Which sources to provision (defaults to the dataset's keys). */
  sources?: SignalSource[];
}

/**
 * Build the connector registry. Defaults to fixture-backed mocks so the system
 * runs locally. `mode: "composio"` swaps in `ComposioConnector` (via the
 * mcporter bridge) for sources that have credentials configured, falling back
 * to the mock for the rest — so a partially-configured environment still works.
 */
export function createConnectors(opts: CreateConnectorsOptions = {}): MockConnectorRegistry {
  const mode = opts.mode ?? (process.env.CONSTELLATION_CONNECTOR_MODE as ConnectorMode) ?? "mock";
  const dataset = opts.dataset ?? DEMO_FIXTURES;
  const registry = new MockConnectorRegistry(dataset);

  if (mode === "composio") {
    const config = composioConfigFromEnv();
    if (config.apiKey) {
      // Assemble the Composio server definition (the consumer-key header lives
      // here, keeping the mcporter bridge vendor-neutral).
      const serverName = config.serverName ?? DEFAULT_COMPOSIO_SERVER;
      const serverDefs = {
        [serverName]: {
          url: config.endpoint ?? DEFAULT_COMPOSIO_ENDPOINT,
          headers: {
            "x-consumer-api-key": config.apiKey,
            ...(config.projectId ? { "x-project-id": config.projectId } : {}),
          },
        },
      };
      const bridge = new McporterClient({
        serverDefs,
        servers: [serverName],
        endpoint: config.endpoint,
      });
      // Only the supported set; doc/meeting_transcript stay on their mocks.
      const requested = opts.sources ?? (Object.keys(dataset) as SignalSource[]);
      const sources = requested.filter((s) => COMPOSIO_SOURCES.includes(s));
      for (const source of sources) {
        if (config.appBySource?.[source]) {
          registry.set(source, new ComposioConnector(source, bridge, config));
        }
      }
    }
    // No API key → keep mocks (scaffold-safe default).
  }

  return registry;
}
