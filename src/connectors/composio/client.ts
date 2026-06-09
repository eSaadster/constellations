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
   * Execute a batch of tool calls in ONE meta-router round trip (it runs up to
   * 50 in parallel). Returns index-aligned per-call outcomes; an individual
   * failure (e.g. Slack not_in_channel) becomes { ok: false } instead of
   * throwing, so callers can skip and continue.
   */
  private async execMany(
    tools: Array<{ tool_slug: string; arguments: JsonObject }>,
  ): Promise<Array<{ ok: boolean; data?: unknown; error?: string }>> {
    if (tools.length === 0) return [];
    const raw = await this.bridge.callTool({
      server: this.serverName,
      tool: COMPOSIO_MULTI_EXECUTE_TOOL,
      args: { tools, sync_response_to_workbench: false },
    });
    const envelope = isObject(raw) ? raw : undefined;
    const results =
      (isObject(envelope?.data) ? envelope!.data.results : undefined) ?? envelope?.results;
    const out: Array<{ ok: boolean; data?: unknown; error?: string }> = tools.map(() => ({
      ok: false,
      error: "missing result",
    }));
    if (!Array.isArray(results)) return out;
    results.forEach((entry, position) => {
      if (!isObject(entry)) return;
      const index = typeof entry.index === "number" ? entry.index : position;
      // The router's index has been observed 0-based and positional; clamp into range.
      const slot = index >= 0 && index < out.length ? index : position;
      if (slot < 0 || slot >= out.length) return;
      const response = isObject(entry.response) ? entry.response : entry;
      if (isObject(response) && response.successful === false) {
        out[slot] = { ok: false, error: asString(response.error) ?? "tool failed" };
        return;
      }
      const data = isObject(response)
        ? response.data ?? response.data_preview ?? response
        : response;
      out[slot] = { ok: true, data };
    });
    return out;
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

  /**
   * Page size that reliably stays INLINE in the meta-router response. Larger
   * payloads get silently truncated to a ~3-item `data_preview` (observed
   * live), so big windows must paginate at this size rather than ask for one
   * big page.
   */
  private static readonly PAGE_SIZE = 10;

  /** Pull the continuation token out of an app payload (gmail/calendar use
   * nextPageToken; slack uses response_metadata.next_cursor). */
  private nextToken(payload: unknown): string | undefined {
    if (!isObject(payload)) return undefined;
    const direct = asString(payload.nextPageToken);
    if (direct) return direct;
    const meta = payload.response_metadata;
    return isObject(meta) ? asString(meta.next_cursor) : undefined;
  }

  /** Paginate a list slug until `want` items, the token runs dry, or pageCap. */
  private async pagedExec(
    toolSlug: string,
    baseArgs: JsonObject,
    opts: { tokenArg: string; want: number; pageCap?: number },
  ): Promise<JsonObject[]> {
    const items: JsonObject[] = [];
    const cap = opts.pageCap ?? 12;
    let token: string | undefined;
    for (let page = 0; page < cap && items.length < opts.want; page++) {
      const args: JsonObject = token ? { ...baseArgs, [opts.tokenArg]: token } : { ...baseArgs };
      const payload = await this.exec(toolSlug, args);
      const rows = this.container(payload);
      items.push(...rows);
      token = this.nextToken(payload);
      if (!token || rows.length === 0) break;
    }
    return items.slice(0, opts.want);
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
        const rows = await this.pagedExec(slugs.list, this.gmailArgs(query), {
          tokenArg: "page_token",
          want: query.limit ?? 100,
        });
        return rows.map((m) => this.mapGmail(m));
      }
      case "slack": {
        const channels = await this.resolveSlackChannels(query);
        // No channels reachable (and none configured) -> nothing to read. Skip
        // gracefully rather than throw, so a composio ingest of the other
        // sources still succeeds.
        if (channels.length === 0) return [];
        // Window: everything since `query.since`, defaulting to the last 24h.
        const since =
          query.since ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
        const windowed = { ...query, since };
        // One batched meta-router call covers every channel's FIRST page;
        // per-channel failures (not_in_channel, archived) are skipped, which
        // effectively restricts the sweep to channels this account can read.
        // Pages are kept small (PAGE_SIZE) so responses stay inline rather
        // than truncating to a preview; busy channels paginate via cursor.
        const results = await this.execMany(
          channels.map((channel) => ({
            tool_slug: slugs.list,
            arguments: this.slackArgs(windowed, channel, ComposioConnector.PAGE_SIZE),
          })),
        );
        const items: RawSourceItem[] = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i]!;
          if (!result.ok) continue;
          const channel = channels[i]!;
          const push = (rows: JsonObject[]) => {
            for (const m of rows) {
              if (m.subtype === "channel_join") continue;
              items.push(this.mapSlack(m, channel));
            }
          };
          push(this.container(result.data));
          // Follow the cursor for busy channels (bounded).
          let token = this.nextToken(result.data);
          for (let extra = 0; token && extra < 3; extra++) {
            const payload = await this.exec(slugs.list, {
              ...this.slackArgs(windowed, channel, ComposioConnector.PAGE_SIZE),
              cursor: token,
            });
            push(this.container(payload));
            token = this.nextToken(payload);
          }
        }
        items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return query.limit ? items.slice(0, query.limit) : items;
      }
      case "calendar": {
        const calendarId = query.containerId ?? this.config.calendarId ?? DEFAULT_CALENDAR_ID;
        const rows = await this.pagedExec(slugs.list, this.calendarArgs(query, calendarId), {
          tokenArg: "pageToken",
          want: query.limit ?? 100,
        });
        return rows.map((e) => this.mapCalendar(e, calendarId));
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
        // No clean single-message fetch. externalId is "channel:ts"; re-list a
        // window AROUND the message's own timestamp (the default list window is
        // the last 24h, which would miss older messages).
        const [channel, ts] = externalId.split(":");
        if (!channel || !ts) return undefined;
        const ms = parseFloat(ts) * 1000;
        if (Number.isNaN(ms)) return undefined;
        const items = await this.list({
          containerId: channel,
          since: new Date(ms - 3_600_000).toISOString(),
          until: new Date(ms + 3_600_000).toISOString(),
          limit: 100,
        });
        return items.find((i) => i.externalId === externalId);
      }
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-source argument builders
  // ---------------------------------------------------------------------------

  /**
   * Gmail uses snake_case args; folds query + since/until into search syntax.
   * `verbose: false` keeps each message compact enough that a full PAGE_SIZE
   * page survives inline (it still carries messageText/preview/sender/subject/
   * messageTimestamp — everything the mapper reads).
   */
  private gmailArgs(query: ConnectorQuery): JsonObject {
    const parts: string[] = [];
    if (query.query) parts.push(query.query);
    if (query.since) parts.push(`after:${this.gmailTime(query.since)}`);
    if (query.until) parts.push(`before:${this.gmailTime(query.until)}`);
    const args: JsonObject = { max_results: ComposioConnector.PAGE_SIZE, verbose: false };
    if (parts.length > 0) args.query = parts.join(" ");
    return args;
  }

  /**
   * Gmail search accepts epoch seconds in after:/before:, which keeps the
   * since-cursor precise to the second (YYYY/MM/DD would re-fetch whole days).
   */
  private gmailTime(iso: string): string {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? iso : String(Math.floor(ms / 1000));
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

  /**
   * Calendar uses camelCase args. The rolling window (30d back, 45d forward)
   * plus the ingest-side externalId dedupe is what makes repeated runs pick up
   * only NEW events: known instances are skipped upstream, new ones flow in.
   */
  private calendarArgs(query: ConnectorQuery, calendarId: string): JsonObject {
    return {
      calendarId,
      timeMin: query.since ?? new Date(Date.now() - 30 * 86400_000).toISOString(),
      timeMax: query.until ?? new Date(Date.now() + 45 * 86400_000).toISOString(),
      // Per-page size; the window total is collected via pageToken pagination.
      maxResults: ComposioConnector.PAGE_SIZE,
      singleEvents: true,
      orderBy: "startTime",
    };
  }

  /**
   * Resolve the Slack channels to read: an explicit containerId wins, then a
   * text query (channel discovery), then ALL workspace conversations
   * (SLACK_LIST_CONVERSATIONS), then the configured COMPOSIO_SLACK_CHANNEL.
   * Returns [] when nothing is reachable (caller skips Slack).
   */
  private async resolveSlackChannels(query: ConnectorQuery): Promise<string[]> {
    if (query.containerId) return [query.containerId];
    const slugs = SOURCE_SLUGS.slack;
    if (slugs?.findChannels && query.query) {
      try {
        const payload = await this.exec(slugs.findChannels, { query: query.query, limit: 5 });
        const channels = isObject(payload) && Array.isArray(payload.channels) ? payload.channels : [];
        const first = channels.find(isObject);
        const id = first ? asString(first.id) : undefined;
        if (id) return [id];
      } catch {
        // fall through to the full sweep
      }
    }
    if (slugs?.listConversations) {
      try {
        const payload = await this.exec(slugs.listConversations, {
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 100,
        });
        const channels = isObject(payload) && Array.isArray(payload.channels) ? payload.channels : [];
        const ids = channels
          .filter(isObject)
          .map((c) => asString(c.id))
          .filter((id): id is string => Boolean(id));
        // One meta-router batch executes up to 50 tools; cap the sweep there.
        if (ids.length > 0) return ids.slice(0, 50);
      } catch {
        // fall through to the configured channel
      }
    }
    return this.config.slackChannel ? [this.config.slackChannel] : [];
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
