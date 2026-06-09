import type { ConstellationRuntime } from "../../agent/runtime.js";
import type { ContextCard } from "../../artifacts/ContextCard.js";

/**
 * Slack handler logic — pure and testable, independent of pi-mom.
 *
 * The bot's job: a user @mentions it with a Slack message link and asks
 * "what is this connected to?"; it replies with a Context Card. All of that
 * resolves to these functions, which a thin pi-mom adapter wires to Slack events.
 */

export interface ParsedSlackLink {
  channel: string;
  ts: string;
  externalId: string;
  url: string;
}

const SLACK_LINK_RE = /https?:\/\/[a-z0-9.-]*slack\.com\/archives\/([A-Z0-9_]+)\/(p\d+)/i;

/** Parse the first Slack message permalink in a message. */
export function parseSlackLink(text: string): ParsedSlackLink | undefined {
  const m = SLACK_LINK_RE.exec(text);
  if (!m) return undefined;
  const [url, channel, ts] = m;
  return { channel: channel!, ts: ts!, externalId: `${channel}/${ts}`, url: url! };
}

/** Render a Context Card as Slack-flavored markdown. */
export function formatContextCardForSlack(card: ContextCard): string {
  const lines: string[] = [];
  lines.push(`*${card.title}*`);
  lines.push(card.summary);
  if (card.connections.length === 0) {
    lines.push("\n_No evidence-backed connections found yet._");
  } else {
    lines.push("\n*Connections*");
    for (const c of card.connections) {
      const emoji = c.status === "confirmed" ? "✅" : c.status === "quarantined" ? "🚧" : "🔎";
      lines.push(
        `${emoji} *${c.relation.replace(/_/g, " ")}* (${c.status}, ${(c.confidence * 100).toFixed(
          0,
        )}%)\n   ↳ ${c.rationale}`,
      );
    }
  }
  if (card.openQuestions.length) lines.push(`\n*Open questions:* ${card.openQuestions.join("; ")}`);
  lines.push(`\n_Every claim above cites its source signals + links (trace ${card.provenanceTraceId ?? "n/a"})._`);
  lines.push(`_A connection is not a vibe. It is an evidence-backed claim._`);
  return lines.join("\n");
}

export interface MentionReply {
  text: string;
  anchorSignalId?: string;
  matched: boolean;
}

/**
 * Handle a "what is this connected to?" mention. Ensures fixtures are ingested,
 * resolves the anchor signal from the Slack link (or falls back), generates the
 * Context Card, and returns formatted text. Never mutates external systems.
 */
export async function handleWhatIsThisConnectedTo(
  text: string,
  runtime: ConstellationRuntime,
  opts: { autoIngest?: boolean } = {},
): Promise<MentionReply> {
  if ((opts.autoIngest ?? true) && runtime.store.listSignals().length === 0) {
    await runtime.ingestFixtures();
  }

  const link = parseSlackLink(text);
  let anchor =
    link && runtime.store.findSignalByExternalId("slack", link.externalId);

  if (!anchor && link) {
    anchor = runtime.store.listSignals().find((s) => s.url === link.url);
  }
  if (!anchor) {
    // Fall back to the most recent Slack signal.
    anchor = runtime.store
      .listSignals()
      .filter((s) => s.source === "slack")
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  }

  if (!anchor) {
    return {
      matched: false,
      text:
        "I couldn't find a Slack message to anchor on. Share a Slack message link and ask: *what is this connected to?*",
    };
  }

  const { contextCard } = await runtime.generateContextCard(anchor.id);
  return {
    matched: true,
    anchorSignalId: anchor.id,
    text: formatContextCardForSlack(contextCard),
  };
}

/** Heuristic: does this mention ask the "connected to" question? */
export function isConnectionQuestion(text: string): boolean {
  return /connect|connected|related|context|what.*this/i.test(text);
}
