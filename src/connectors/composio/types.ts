import type { SignalSource } from "../../artifacts/Signal.js";

/**
 * Composio connector config. Composio will eventually connect the five external
 * sources (Slack, Email, Calendar, Meeting transcripts, Docs/files) through
 * mcporter. Config comes from env; no credentials are committed.
 */
export interface ComposioConfig {
  apiKey?: string;
  /** Composio "entity"/connected-account id for the user. */
  entityId?: string;
  /** Map of our SignalSource -> Composio app slug (e.g. slack -> "slack"). */
  appBySource?: Partial<Record<SignalSource, string>>;
}

export const DEFAULT_APP_BY_SOURCE: Partial<Record<SignalSource, string>> = {
  slack: "slack",
  email: "gmail",
  calendar: "googlecalendar",
  doc: "googledrive",
  meeting_transcript: "googledrive",
};

export function composioConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComposioConfig {
  return {
    apiKey: env.COMPOSIO_API_KEY,
    entityId: env.COMPOSIO_ENTITY_ID,
    appBySource: DEFAULT_APP_BY_SOURCE,
  };
}
