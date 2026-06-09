import type { SignalSource } from "../../artifacts/Signal.js";
import {
  SignalParseError,
  SourceAuthError,
  SourceUnavailableError,
} from "../../resilience/errors.js";
import type { ConnectorQuery, RawSourceItem, SourceConnector } from "../types.js";
import type { McporterClientLike } from "../mcporter/types.js";
import {
  COMPOSIO_MULTI_EXECUTE_TOOL,
  DEFAULT_CALENDAR_ID,
  DEFAULT_COMPOSIO_SERVER,
  SOURCE_SLUGS,
  composioConfigFromEnv,
  type ComposioConfig,
  type SourceSlugs,
} from "./types.js";

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Read a dotted path (e.g. "start.dateTime") off a nested object. */
function dotGet(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Composio-backed source connector.
 *
 * Reads route through the mcporter bridge to the Composio hosted META-TOOL
 * router. There are no direct app tools — every read calls
 * COMPOSIO_MULTI_EXECUTE_TOOL with a per-source tool slug + arguments, then
 * unwraps the envelope and maps each item to `RawSourceItem`. Depends only on
 * the `McporterClientLike` interface, so no vendor SDK at build time.
 */
export class ComposioConnector implements SourceConnector {
  readonly kind = "composio" as const;

  constructor(
    readonly source: SignalSource,
    private readonly bridge: McporterClientLike,
    private readonly config: ComposioConfig = composioConfigFromEnv(),
  ) {}

  private get serverName(): string {
    return this.config.serverName ?? DEFAULT_COMPOSIO_SERVER;
  }

  /** Validate creds + slug availability for this source. */
  private slugs(): SourceSlugs {
    if (!this.config.apiKey) {
      throw new SourceAuthError("Composio API key missing (set COMPOSIO_API_KEY)", {
        source: this.source,
      });
    }
    const slugs = SOURCE_SLUGS[this.source];
    if (!slugs) {
      throw new SourceUnavailableError(`no Composio slug mapped for source ${this.source}`, {
        source: this.source,
      });
    }
    return slugs;
  }

  /** Execute one real tool slug via the meta-router and return its app payload. */
  private async exec(toolSlug: string, args: JsonObject): Promise<unknown> {
    const raw = await this.bridge.callTool({
      server: this.serverName,
      tool: COMPOSIO_MULTI_EXECUTE_TOOL,
      args: { tools: [{ tool_slug: toolSlug, arguments: args }], sync_response_to_workbench: false },
    });
    return this.unwrapExec(raw, toolSlug);
  }

  /**
   * Two-layer unwrap of the MULTI_EXECUTE envelope:
   *   parsed.data.results[i].response.data
   * Primary path is known from live discovery; defensive fallbacks degrade to
   * an empty payload rather than crashing. Throws on an explicit tool failure
   * (`response.successful === false`).
   */
  private unwrapExec(raw: unknown, toolSlug: string): unknown {
    const envelope = isObject(raw) ? raw : undefined;
    // results may live at .data.results or .results.
    const results =
      (isObject(envelope?.data) ? envelope!.data.results : undefined) ?? envelope?.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new SignalParseError("Composio exec returned no results", { toolSlug });
    }
    // One tool per call -> results[0]; still match by tool_slug if present.
    const entry =
      results.find((r) => isObject(r) && r.tool_slug === toolSlug) ?? results[0];
    if (!isObject(entry)) {
      throw new SignalParseError("Composio exec result entry malformed", { toolSlug });
    }
    const response = isObject(entry.response) ? entry.response : entry;
    if (isObject(response) && response.successful === false) {
      throw new SourceUnavailableError(
        `Composio tool ${toolSlug} failed: ${asString(response.error) ?? "unknown error"}`,
        { toolSlug },
      );
    }
    // The app payload is usually response.data. Some hydrate tools (e.g.
    // GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID) put it under response.data_preview
    // instead. Fall back through both, then to the response itself.
    if (isObject(response)) {
      if (response.data != null) return response.data;
      if (response.data_preview != null) return response.data_preview;
    }
    return response;
  }

  /** Pull the list container array out of a per-source app payload. */
  private container(payload: unknown): JsonObject[] {
    if (!isObject(payload)) return [];
    const candidates =
      this.source === "calendar"
        ? ["items"]
        : ["messages"]; // gmail + slack both use "messages"
    for (const key of candidates) {
      const arr = payload[key];
      if (Array.isArray(arr)) return arr.filter(isObject);
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async list(query: ConnectorQuery = {}): Promise<RawSourceItem[]> {
    const slugs = this.slugs();
    switch (this.source) {
      case "email": {
        const payload = await this.exec(slugs.list, this.gmailArgs(query));
        return this.container(payload).map((m) => this.mapGmail(m));
      }
      case "slack": {
        const channel = await this.resolveSlackChannel(query);
        // No channel configured (no containerId, no COMPOSIO_SLACK_CHANNEL, no
        // query to discover one) -> nothing to read. Skip gracefully rather than
        // throw, so a composio ingest of the other sources still succeeds.
        if (!channel) return [];
        // Over-fetch a single page then filter: Slack's `limit` applies BEFORE
        // we drop channel_join/system events, so a small limit can otherwise
        // yield zero real messages. Cap the fetch to stay well under rate
        // limits (no pagination).
        const want = query.limit ?? 10;
        const fetchN = Math.min(Math.max(want * 4, 20), 50);
        const payload = await this.exec(slugs.list, this.slackArgs(query, channel, fetchN));
        const items = this.container(payload)
          .filter((m) => m.subtype !== "channel_join")
          .map((m) => this.mapSlack(m, channel));
        return items.slice(0, want);
      }
      case "calendar": {
        const calendarId = query.containerId ?? this.config.calendarId ?? DEFAULT_CALENDAR_ID;
        const payload = await this.exec(slugs.list, this.calendarArgs(query, calendarId));
        return this.container(payload).map((e) => this.mapCalendar(e, calendarId));
      }
      default:
        throw new SourceUnavailableError(`Composio list unsupported for ${this.source}`, {
          source: this.source,
        });
    }
  }

  /**
   * Search. Gmail has native search syntax; slack/calendar reuse list (text
   * filter applied client-side over the returned window).
   */
  async search(query: ConnectorQuery): Promise<RawSourceItem[]> {
    if (this.source === "email") {
      // gmailArgs already folds query.query + since/until into Gmail search.
      return this.list(query);
    }
    const items = await this.list(query);
    const terms = (query.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return items;
    return items.filter((i) => {
      const hay = `${i.title ?? ""} ${i.text}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }

  async fetchById(externalId: string): Promise<RawSourceItem | undefined> {
    const slugs = this.slugs();
    switch (this.source) {
      case "email": {
        const payload = await this.exec(slugs.fetchById, { message_id: externalId });
        return isObject(payload) ? this.mapGmail(payload) : undefined;
      }
      case "calendar": {
        // externalId is the event id; calendarId is not encoded in it, so use
        // the connected primary calendar.
        const calendarId = this.config.calendarId ?? DEFAULT_CALENDAR_ID;
        const payload = await this.exec(slugs.fetchById, {
          event_id: externalId,
          calendarId,
        });
        return isObject(payload) ? this.mapCalendar(payload, calendarId) : undefined;
      }
      case "slack": {
        // No clean single-message fetch. externalId is "channel:ts"; re-list the
        // channel window and find the matching ts.
        const [channel, ts] = externalId.split(":");
        if (!channel || !ts) return undefined;
        const items = await this.list({ containerId: channel, limit: 100 });
        return items.find((i) => i.externalId === externalId);
      }
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-source argument builders
  // ---------------------------------------------------------------------------

  /** Gmail uses snake_case args; folds query + since/until into search syntax. */
  private gmailArgs(query: ConnectorQuery): JsonObject {
    const parts: string[] = [];
    if (query.query) parts.push(query.query);
    if (query.since) parts.push(`after:${this.gmailDate(query.since)}`);
    if (query.until) parts.push(`before:${this.gmailDate(query.until)}`);
    const args: JsonObject = { max_results: query.limit ?? 10 };
    if (parts.length > 0) args.query = parts.join(" ");
    return args;
  }

  /** Gmail search dates are YYYY/MM/DD. */
  private gmailDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  }

  /** Slack uses channel/limit/oldest/latest; channel is the conversation id. */
  private slackArgs(query: ConnectorQuery, channel: string, limit: number): JsonObject {
    const args: JsonObject = { channel, limit };
    if (query.since) args.oldest = this.slackTs(query.since);
    if (query.until) args.latest = this.slackTs(query.until);
    return args;
  }

  /** ISO -> Slack ts (epoch seconds as string). */
  private slackTs(iso: string): string {
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? iso : String(ms / 1000);
  }

  /** Calendar uses camelCase args. */
  private calendarArgs(query: ConnectorQuery, calendarId: string): JsonObject {
    return {
      calendarId,
      timeMin: query.since ?? new Date(Date.now() - 30 * 86400_000).toISOString(),
      timeMax: query.until ?? new Date(Date.now() + 45 * 86400_000).toISOString(),
      maxResults: query.limit ?? 10,
      singleEvents: true,
      orderBy: "startTime",
    };
  }

  /**
   * Resolve a Slack channel id: explicit containerId, else discover by query,
   * else the configured COMPOSIO_SLACK_CHANNEL. Returns undefined when none is
   * available (caller skips Slack) — there is no safe hardcoded default.
   */
  private async resolveSlackChannel(query: ConnectorQuery): Promise<string | undefined> {
    if (query.containerId) return query.containerId;
    const slugs = SOURCE_SLUGS.slack;
    if (slugs?.findChannels && query.query) {
      try {
        const payload = await this.exec(slugs.findChannels, { query: query.query, limit: 5 });
        const channels = isObject(payload) && Array.isArray(payload.channels) ? payload.channels : [];
        const first = channels.find(isObject);
        const id = first ? asString(first.id) : undefined;
        if (id) return id;
      } catch {
        // fall through to the configured channel
      }
    }
    return this.config.slackChannel;
  }

  // ---------------------------------------------------------------------------
  // Per-source field mapping -> RawSourceItem
  // ---------------------------------------------------------------------------

  private mapGmail(m: JsonObject): RawSourceItem {
    const externalId = asString(m.messageId) ?? asString(m.id) ?? "";
    const timestamp = asString(m.messageTimestamp) ?? new Date().toISOString();
    const sender = asString(m.sender);
    const to = asString(m.to);
    const actorIds = [sender, to].filter((s): s is string => Boolean(s));
    const text =
      asString(m.messageText) ??
      (isObject(m.preview) ? asString(m.preview.body) : undefined) ??
      "";
    return {
      source: this.source,
      externalId,
      url: asString(m.display_url),
      actorIds,
      timestamp,
      title: asString(m.subject),
      text,
      raw: m,
    };
  }

  private mapSlack(m: JsonObject, channel: string): RawSourceItem {
    const ts = asString(m.ts) ?? "";
    const externalId = `${channel}:${ts}`;
    const ms = ts ? parseFloat(ts) * 1000 : NaN;
    const timestamp = Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
    const user = asString(m.user);
    return {
      source: this.source,
      externalId,
      actorIds: user ? [user] : [],
      timestamp,
      title: undefined,
      text: asString(m.text) ?? "",
      raw: { ...m, containerId: channel },
    };
  }

  private mapCalendar(e: JsonObject, calendarId: string): RawSourceItem {
    const externalId = asString(e.id) ?? "";
    // Timed events: start.dateTime (RFC3339 w/ offset). All-day: start.date.
    const start =
      asString(dotGet(e, "start.dateTime")) ??
      asString(dotGet(e, "start.date")) ??
      new Date().toISOString();
    const organizer = asString(dotGet(e, "organizer.email"));
    const creator = asString(dotGet(e, "creator.email"));
    const actorIds = [organizer, creator].filter(
      (s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i,
    );
    const summary = asString(e.summary);
    const description = asString(e.description);
    return {
      source: this.source,
      externalId,
      url: asString(e.htmlLink) ?? asString(e.display_url) ?? asString(e.hangoutLink),
      actorIds,
      timestamp: start,
      title: summary,
      text: description ?? summary ?? "",
      raw: { ...e, containerId: calendarId },
    };
  }
}
