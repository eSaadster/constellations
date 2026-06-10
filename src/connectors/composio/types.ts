import type { SignalSource } from "../../artifacts/Signal.js";

/**
 * Composio connector config. Composio connects external sources (Slack, Email,
 * Calendar, ...) through mcporter to a hosted META-TOOL router. Config comes
 * from env; no credentials are committed.
 *
 * AUTH: a single consumer key carried as the `x-consumer-api-key` header (NOT a
 * bearer token). `projectId` is optional (probing confirmed it is not required).
 */
export interface ComposioConfig {
  /** Consumer key -> `x-consumer-api-key` header. Gates activation. */
  apiKey?: string;
  /** Composio "entity"/connected-account id (unused by the meta-router; kept harmless). */
  entityId?: string;
  /** Optional project id -> `x-project-id` header when present. */
  projectId?: string;
  /** Hosted MCP endpoint url. */
  endpoint?: string;
  /** mcporter server name to route through (must match the serverDefs key). */
  serverName?: string;
  /** Map of our SignalSource -> Composio toolkit slug (e.g. slack -> "slack"). */
  appBySource?: Partial<Record<SignalSource, string>>;
  /** Google Calendar id to read; defaults to "primary" (the authed user's own). */
  calendarId?: string;
  /** Slack channel/conversation id to read history from. No safe default — a
   * channel is account-specific, so it must be supplied (env or query.containerId)
   * or Slack reads are skipped. */
  slackChannel?: string;
}

/** Default hosted Composio MCP endpoint (meta-tool router). */
export const DEFAULT_COMPOSIO_ENDPOINT = "https://connect.composio.dev/mcp";

/** mcporter server name the Composio meta-router is registered under. */
export const DEFAULT_COMPOSIO_SERVER = "composio";

/** The Composio meta-tool that executes one or more real tool slugs. */
export const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";

export const DEFAULT_APP_BY_SOURCE: Partial<Record<SignalSource, string>> = {
  slack: "slack",
  email: "gmail",
  calendar: "googlecalendar",
  doc: "googledrive",
  meeting_transcript: "googledrive",
};

/**
 * Per-source real tool slugs + auxiliary slugs, discovered live against the
 * connected accounts. These execute directly through COMPOSIO_MULTI_EXECUTE_TOOL
 * with only `arguments` (no session_id, no prior SEARCH_TOOLS call).
 */
export interface SourceSlugs {
  /** List/history slug. */
  list: string;
  /** Single-item hydrate slug (empty string if none). */
  fetchById: string;
  /** Slack-only: channel discovery slug (search by query). */
  findChannels?: string;
  /** Slack-only: enumerate workspace conversations (confirmed live: returns
   * data.channels[] with id + name). */
  listConversations?: string;
  /** Slack-only: enumerate workspace members (confirmed live: returns
   * data.members[] with id, real_name, profile.email; cursor-paginated). */
  listUsers?: string;
}

export const SOURCE_SLUGS: Partial<Record<SignalSource, SourceSlugs>> = {
  email: {
    list: "GMAIL_FETCH_EMAILS",
    fetchById: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  },
  slack: {
    list: "SLACK_FETCH_CONVERSATION_HISTORY",
    fetchById: "",
    findChannels: "SLACK_FIND_CHANNELS",
    listConversations: "SLACK_LIST_CONVERSATIONS",
    listUsers: "SLACK_LIST_ALL_USERS",
  },
  calendar: {
    list: "GOOGLECALENDAR_EVENTS_LIST",
    fetchById: "GOOGLECALENDAR_EVENTS_GET",
  },
};

/** Google's neutral alias for the authenticated user's primary calendar. Works
 * for any connected account; override per-account via COMPOSIO_CALENDAR_ID. */
export const DEFAULT_CALENDAR_ID = "primary";

export function composioConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComposioConfig {
  return {
    apiKey: env.COMPOSIO_API_KEY,
    entityId: env.COMPOSIO_ENTITY_ID,
    projectId: env.COMPOSIO_PROJECT_ID,
    endpoint: env.COMPOSIO_ENDPOINT ?? DEFAULT_COMPOSIO_ENDPOINT,
    serverName: DEFAULT_COMPOSIO_SERVER,
    appBySource: DEFAULT_APP_BY_SOURCE,
    calendarId: env.COMPOSIO_CALENDAR_ID ?? DEFAULT_CALENDAR_ID,
    slackChannel: env.COMPOSIO_SLACK_CHANNEL,
  };
}
