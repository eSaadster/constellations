import type { Signal } from "../artifacts/Signal.js";
import {
  cleanArtifact,
  cleanSlackText,
  extractFacts,
  resolveActorIds,
  type SlackUserMap,
} from "./heuristics.js";

/**
 * Re-extraction backfill for ALREADY-STORED signals.
 *
 * New ingests get heuristic extraction in the signal.* pipeline, but a graph
 * ingested before that change carries empty `extracted` fields, raw Slack
 * markup in excerpts, and unresolved `U…` actor ids forever — the incremental
 * externalId guard means those signals are never re-built. This module
 * re-derives everything derivable from the STORED fields (title + excerpt +
 * actorIds); it cannot recover data that was never persisted (e.g. calendar
 * attendees, which need a connector refetch).
 *
 * Merging is additive: existing extracted values (fixture hints, earlier
 * passes) are kept, heuristic results union in. Deterministic and idempotent —
 * a second run is a no-op.
 */

function uniq(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

/** Re-extract one signal. Returns the updated signal and whether it changed. */
export function reextractSignal(
  signal: Signal,
  slackUsers?: SlackUserMap,
): { signal: Signal; changed: boolean } {
  const isSlack = signal.source === "slack";
  // extractFacts cleans Slack markup itself and folds resolved <@U…> mentions
  // into people when a user map is supplied.
  const facts = extractFacts({
    source: signal.source,
    title: signal.title,
    text: signal.excerpt,
    slackUsers: isSlack ? slackUsers : undefined,
  });

  const updated: Signal = {
    ...signal,
    actorIds: isSlack ? resolveActorIds(signal.actorIds, slackUsers) : signal.actorIds,
    excerpt: isSlack ? cleanSlackText(signal.excerpt, slackUsers) : signal.excerpt,
    extracted: {
      entities: uniq([...signal.extracted.entities, ...facts.entities]),
      people: uniq([...signal.extracted.people, ...facts.people]),
      projects: signal.extracted.projects,
      dates: uniq([...signal.extracted.dates, ...facts.dates]),
      // Existing entries go through cleanArtifact too: the pre-overhaul
      // extractor stored Slack-markup-mangled URLs ("http://x.com|x.com>").
      artifacts: uniq([...signal.extracted.artifacts.map(cleanArtifact), ...facts.artifacts]),
      asks: uniq([...signal.extracted.asks, ...facts.asks]),
      decisions: uniq([...signal.extracted.decisions, ...facts.decisions]),
    },
  };
  return { signal: updated, changed: JSON.stringify(updated) !== JSON.stringify(signal) };
}

export interface BackfillStats {
  total: number;
  changed: number;
  /** Signals with at least one non-empty extracted field, before -> after. */
  withFactsBefore: number;
  withFactsAfter: number;
  /** Slack actor ids rewritten to resolved identities. */
  actorsResolved: number;
}

function hasFacts(s: Signal): boolean {
  return Object.values(s.extracted).some((arr) => arr.length > 0);
}

/** Re-extract a whole signal list. Returns updated signals + coverage stats. */
export function reextractAll(
  signals: Signal[],
  slackUsers?: SlackUserMap,
): { signals: Signal[]; stats: BackfillStats } {
  const stats: BackfillStats = {
    total: signals.length,
    changed: 0,
    withFactsBefore: signals.filter(hasFacts).length,
    withFactsAfter: 0,
    actorsResolved: 0,
  };
  const out = signals.map((original) => {
    const { signal, changed } = reextractSignal(original, slackUsers);
    if (changed) stats.changed++;
    stats.actorsResolved += signal.actorIds.filter(
      (a, i) => original.actorIds[i] !== undefined && original.actorIds[i] !== a,
    ).length;
    return signal;
  });
  stats.withFactsAfter = out.filter(hasFacts).length;
  return { signals: out, stats };
}
