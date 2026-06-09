import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

/**
 * owner_ubiquity: the graph-owner disease. The owner appears on 7 of 8 signals
 * (df 7 > discriminativeCeiling(8) = 5 → ubiquitous), so owner-overlap is how
 * EVERY pair in this world co-occurs — it is not evidence. A pair sharing ONLY
 * the owner must never reach proposed/confirmed, while a pair corroborated by
 * a discriminative person (zara, df 2) must still confirm.
 */

const OWNER = "owner@corp.com";

/** Filler signals that put the owner over the ubiquity ceiling; far in the
 * past and topically disjoint so they can never legitimately connect. */
const filler = (id: string, n: number, topic: string) =>
  makeSignal({
    id,
    source: "email",
    timestamp: `2026-01-0${n}T09:00:00.000Z`,
    title: `${topic} note`,
    excerpt: `${topic} housekeeping note number ${n}.`,
    actorIds: [OWNER],
    extracted: { people: [OWNER], entities: [topic] },
  });

export const owner_ubiquity: EvalCase = {
  id: "owner_ubiquity",
  description: "A pair sharing ONLY the ubiquitous owner is not evidence-linked",
  prompt: "What is this roadmap thread connected to?",
  anchorId: "ub_anchor",
  fixtures: [
    makeSignal({
      id: "ub_anchor",
      source: "slack",
      timestamp: "2026-03-10T10:00:00.000Z",
      title: "Roadmap planning kickoff",
      excerpt: "Roadmap planning kickoff with @zara — agenda below.",
      actorIds: [OWNER],
      extracted: { people: [OWNER, "zara@corp.com"], entities: ["roadmap planning"] },
    }),
    // Shares ONLY the owner with the anchor; within 24h so the temporal
    // blocking window admits it as a candidate — the scoring fix, not
    // blocking, must keep it out.
    makeSignal({
      id: "ub_owner_only",
      source: "email",
      timestamp: "2026-03-10T18:00:00.000Z",
      title: "Lunch reservation",
      excerpt: "Your lunch reservation for Tuesday is confirmed.",
      actorIds: [OWNER],
      extracted: { people: [OWNER], entities: ["lunch reservation"] },
    }),
    // Genuinely related: corroborated by zara (discriminative) + shared topic.
    makeSignal({
      id: "ub_real",
      source: "calendar",
      timestamp: "2026-03-12T10:00:00.000Z",
      title: "Roadmap planning review",
      excerpt: "Roadmap planning review meeting with zara.",
      actorIds: [OWNER, "zara@corp.com"],
      extracted: { people: [OWNER, "zara@corp.com"], entities: ["roadmap planning"] },
    }),
    filler("ub_f1", 1, "parking"),
    filler("ub_f2", 2, "cafeteria"),
    filler("ub_f3", 3, "badge renewal"),
    filler("ub_f4", 4, "payroll"),
    // One signal WITHOUT the owner keeps the world honest: owner df 7 of 8.
    makeSignal({
      id: "ub_f5",
      source: "email",
      timestamp: "2026-01-05T09:00:00.000Z",
      title: "benefits note",
      excerpt: "benefits housekeeping note number 5.",
      actorIds: ["yusuf@corp.com"],
      extracted: { people: ["yusuf@corp.com"], entities: ["benefits"] },
    }),
  ],
  expectedLinks: [
    { a: "ub_anchor", b: "ub_real", relation: "mentions_meeting", status: "confirmed" },
  ],
  forbiddenLinks: [{ a: "ub_anchor", b: "ub_owner_only" }],
  // Owner-only overlap must end excluded/quarantined, never reviewable.
  expectedQuarantined: [{ a: "ub_anchor", b: "ub_owner_only" }],
};
