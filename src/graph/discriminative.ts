import type { Signal } from "../artifacts/Signal.js";

/**
 * Discriminative-evidence rules — the SINGLE definition of "is this fact/person
 * specific enough to be evidence of relatedness?".
 *
 * Measured disease this module exists to cure: on the live 218-signal graph,
 * 828 links (31%) had the graph owner as their ONLY shared person. The owner
 * appears on nearly every signal, so owner-overlap is how every coworker pair
 * co-occurs — it is not evidence. The rule must be document-frequency based
 * (never a hardcoded email): any other graph has a different owner, and tiny
 * fixture graphs must keep treating everyone as evidence.
 *
 * This module is store-free on purpose: the sealed LinkLab can never read the
 * graph, so graph-wide stats (document frequency) are computed PARENT-side
 * (spawn_link_lab / find_candidate_links) over `listSignals()` and passed in
 * as plain arguments.
 */

/**
 * A person/fact is "discriminative" only if it appears in at most this many
 * signals — scale-aware so the graph owner (who touches nearly everything)
 * stops being false evidence of relatedness, while tiny fixture graphs are
 * unaffected (the floor of 5 exceeds any fixture document frequency).
 */
export function discriminativeCeiling(graphSize: number): number {
  return Math.max(5, Math.ceil(graphSize * 0.3));
}

/**
 * Canonical identity key for a person mention. "Name <a@b.com>" collapses to
 * the email so the owner's several spellings ("Saad Farooq <saad@x.ai>",
 * "saad@x.ai") count as ONE person — otherwise each spelling stays under the
 * ubiquity ceiling while the human behind them is on half the graph.
 */
export function normalizePersonKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const bracketed = trimmed.match(/<([^<>\s@]+@[^<>\s]+)>/);
  return (bracketed?.[1] ?? trimmed).trim();
}

/**
 * Automation senders are not people. Measured live: no-reply@/support@-style
 * senders corroborated 100+ junk pairs — a receipt bot appearing on two emails
 * says nothing about the emails being related.
 */
const AUTOMATION_SENDER_RE =
  /^(?:no-?reply|do-?not-?reply|notifications?|support|info|hello|team|news(?:letter)?|marketing|updates?|alerts?|billing|invoices?|receipts?)[@+.\-_]/i;

/** A bare domain ("data-grid.ai") sometimes leaks into extracted.people — it is an org, not a person. */
const BARE_DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * Is this normalized key a real person (vs an automation sender or a bare
 * domain)? Plain names ("alice") and unresolved Slack ids ("U0AAAAAAAA") pass.
 */
export function isPersonKey(key: string): boolean {
  if (key.length === 0) return false;
  if (AUTOMATION_SENDER_RE.test(key)) return false;
  if (BARE_DOMAIN_RE.test(key)) return false;
  return true;
}

/** Normalized person keys of one signal (actorIds ∪ extracted.people), bots/domains removed. */
export function peopleKeysOf(s: Pick<Signal, "actorIds" | "extracted">): Set<string> {
  const keys = new Set<string>();
  for (const raw of [...s.actorIds, ...s.extracted.people]) {
    const key = normalizePersonKey(raw);
    if (key && isPersonKey(key)) keys.add(key);
  }
  return keys;
}

/**
 * People too ubiquitous to be evidence: normalized-person document frequency
 * (counted once per signal) above `discriminativeCeiling`. On the live graph
 * this is exactly the owner. Deliberately people-only (NOT the all-feature
 * blocking set in link.find_candidate_links): the scoring people dimension and
 * evidence.sharedPeople are built from actorIds ∪ extracted.people, so the
 * ubiquity filter must use the same universe.
 */
export function computeUbiquitousPeople(
  signals: ReadonlyArray<Pick<Signal, "actorIds" | "extracted">>,
): string[] {
  const df = new Map<string, number>();
  for (const s of signals) {
    for (const key of peopleKeysOf(s)) df.set(key, (df.get(key) ?? 0) + 1);
  }
  const ceiling = discriminativeCeiling(signals.length);
  return [...df.entries()]
    .filter(([, count]) => count > ceiling)
    .map(([key]) => key)
    .sort();
}
