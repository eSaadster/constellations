import type { DotLink } from "../artifacts/DotLink.js";
import type { Signal } from "../artifacts/Signal.js";
import { dedupeNodeKey } from "./series.js";

/**
 * Link dedupe at SERIES granularity (pure — runtime applies the removals):
 *
 *   1. Both endpoints inside the SAME recurring series → remove outright,
 *      never keep: sibling links are scheduling structure, not insight. New
 *      discovery never emits them; this purges legacy graphs (747 sibling
 *      links on the live baseline, 165 of them "confirmed").
 *   2. Otherwise keep the highest-confidence link per unordered logical-node
 *      pair (`series:<stem>` | `sig:<id>`) + relation. This collapses both the
 *      reverse duplicates from anchoring A and B against each other AND the
 *      cross-series fan-out (one email linked to 28 instances of a huddle is
 *      ONE claim, kept at its best instance).
 */
export function planLinkDedupe(links: DotLink[], signals: Signal[]): string[] {
  const nodeKeyById = new Map<string, string>();
  for (const s of signals) nodeKeyById.set(s.id, dedupeNodeKey(s));
  // A link endpoint whose signal vanished still dedupes by raw id.
  const keyOf = (signalId: string): string => nodeKeyById.get(signalId) ?? `sig:${signalId}`;

  const best = new Map<string, DotLink>();
  const losers: string[] = [];
  for (const link of links) {
    const a = keyOf(link.sourceSignalId);
    const b = keyOf(link.targetSignalId);
    if (a === b && a.startsWith("series:")) {
      losers.push(link.id);
      continue;
    }
    const key = `${[a, b].sort().join("::")}|${link.relation}`;
    const incumbent = best.get(key);
    if (!incumbent) {
      best.set(key, link);
    } else if (link.confidence > incumbent.confidence) {
      best.set(key, link);
      losers.push(incumbent.id);
    } else {
      losers.push(link.id);
    }
  }
  return losers;
}
