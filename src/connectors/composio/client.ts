import type { SignalSource } from "../../artifacts/Signal.js";
import { SourceAuthError, SourceUnavailableError } from "../../resilience/errors.js";
import type { ConnectorQuery, RawSourceItem, SourceConnector } from "../types.js";
import type { McporterClientLike } from "../mcporter/types.js";
import { composioConfigFromEnv, type ComposioConfig } from "./types.js";

/**
 * Composio-backed source connector (skeleton).
 *
 * Talks to Composio THROUGH mcporter (the bridge), so it depends only on the
 * `McporterClientLike` interface — not on any vendor SDK at build time. Mapping
 * Composio responses to `RawSourceItem` is left as a clearly-marked TODO; until
 * configured, reads raise typed errors instead of fabricating data.
 */
export class ComposioConnector implements SourceConnector {
  readonly kind = "composio" as const;

  constructor(
    readonly source: SignalSource,
    private readonly bridge: McporterClientLike,
    private readonly config: ComposioConfig = composioConfigFromEnv(),
  ) {}

  private app(): string {
    const app = this.config.appBySource?.[this.source];
    if (!app) {
      throw new SourceUnavailableError(`no Composio app mapped for source ${this.source}`, {
        source: this.source,
      });
    }
    if (!this.config.apiKey) {
      throw new SourceAuthError("Composio API key missing (set COMPOSIO_API_KEY)", {});
    }
    return app;
  }

  async fetchById(externalId: string): Promise<RawSourceItem | undefined> {
    this.app();
    // TODO: bridge.callTool({ server: "composio", tool: `${app}_GET_ITEM`, args: { id: externalId } })
    // then map the Composio payload to RawSourceItem.
    throw new SourceUnavailableError("ComposioConnector.fetchById not implemented in scaffold", {
      externalId,
    });
  }

  async list(_query: ConnectorQuery = {}): Promise<RawSourceItem[]> {
    this.app();
    // TODO: bridge.callTool(...) + map results.
    throw new SourceUnavailableError("ComposioConnector.list not implemented in scaffold", {});
  }

  async search(_query: ConnectorQuery): Promise<RawSourceItem[]> {
    this.app();
    // TODO: bridge.callTool(...) + map results.
    throw new SourceUnavailableError("ComposioConnector.search not implemented in scaffold", {});
  }
}
