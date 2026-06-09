import type { Signal } from "../artifacts/Signal.js";

/**
 * Recurring-series derivation — the SINGLE definition of "these calendar
 * signals are instances of one recurring meeting".
 *
 * Why externalId, not raw.recurringEventId: Google (fetched with
 * `singleEvents: true`) expands recurrences as `<seriesId>_<instanceTs>`
 * (e.g. `huddle1_20260512T150000Z`). The connector's `raw.recurringEventId`
 * does NOT survive normalization into a Signal — only the externalId suffix
 * convention persists — so the suffix stem is the single source of truth
 * (brief.ts's recurring-series analytics already relied on it).
 *
 * Series membership is 100% derivable from the Signal itself, so it is NEVER
 * persisted as a link: materializing ~750 sibling edges was exactly how the
 * live graph's "most confident knowledge" became "Daily Huddle resembles
 * Daily Huddle".
 */

/** Strip a calendar recurrence suffix (e.g. `_20260512T150000Z`) to a series stem. */
export const RECURRENCE_SUFFIX_RE = /_\d{8}(?:T\d{4,6}Z?)?$/i;

/**
 * The recurring-series key of a signal, or undefined for non-calendar signals
 * and calendar events whose externalId carries no recurrence suffix (live data
 * has a handful of one-off events — they must stay individual nodes).
 */
export function seriesKeyOf(s: Pick<Signal, "source" | "externalId">): string | undefined {
  if (s.source !== "calendar") return undefined;
  if (!RECURRENCE_SUFFIX_RE.test(s.externalId)) return undefined;
  return s.externalId.replace(RECURRENCE_SUFFIX_RE, "");
}

/** True when both signals are instances of the same recurring series. */
export function sameSeries(
  a: Pick<Signal, "source" | "externalId">,
  b: Pick<Signal, "source" | "externalId">,
): boolean {
  const ka = seriesKeyOf(a);
  return ka !== undefined && ka === seriesKeyOf(b);
}

/**
 * Logical-node key for link dedupe/clustering: instances of one recurring
 * series collapse to a single `series:<stem>` node; everything else stands
 * alone as `sig:<id>`. An anchor linked to N instances of a series carries ONE
 * insight, not N.
 */
export function dedupeNodeKey(s: Pick<Signal, "id" | "source" | "externalId">): string {
  const key = seriesKeyOf(s);
  return key !== undefined ? `series:${key}` : `sig:${s.id}`;
}
