import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

/**
 * recurring_series_noise: the series-sibling disease. Three instances of one
 * recurring "Daily Huddle" share a title, attendees, and rhythm — on the live
 * graph such siblings were 89% of all confirmed links. They must produce NO
 * link of any status between instances (anchoring at instance 1, its siblings
 * must be excluded), while a genuinely related agenda email still connects.
 */

const instance = (id: string, day: string) => ({
  ...makeSignal({
    id,
    source: "calendar" as const,
    timestamp: `2026-05-${day}T15:00:00.000Z`,
    title: "Daily Huddle",
    excerpt: "Daily huddle standup with alice and bob.",
    actorIds: ["alice", "bob"],
    extracted: { people: ["alice", "bob"], entities: ["daily huddle"] },
  }),
  // Google-style expanded recurrence id: <seriesId>_<instanceTs>.
  externalId: `rsn_huddle_202605${day}T150000Z`,
});

export const recurring_series_noise: EvalCase = {
  id: "recurring_series_noise",
  description: "Recurring-series siblings are structure, not insight — never linked",
  prompt: "What is this huddle instance connected to?",
  anchorId: "rsn_hud1",
  fixtures: [
    instance("rsn_hud1", "11"),
    instance("rsn_hud2", "12"),
    instance("rsn_hud3", "13"),
    makeSignal({
      id: "rsn_email",
      source: "email",
      timestamp: "2026-05-11T09:00:00.000Z",
      title: "Daily Huddle agenda",
      excerpt: "Agenda for today's daily huddle: ship checklist. alice, bob attending.",
      actorIds: ["alice", "bob"],
      extracted: { people: ["alice", "bob"], entities: ["daily huddle"] },
    }),
    makeSignal({
      id: "rsn_unrelated",
      source: "calendar",
      timestamp: "2026-05-20T10:00:00.000Z",
      title: "Dentist appointment",
      excerpt: "Routine dental checkup downtown.",
      extracted: { entities: ["dentist"] },
    }),
  ],
  expectedLinks: [
    // The cross-source win the sibling noise used to drown out.
    { a: "rsn_hud1", b: "rsn_email", relation: "mentions_meeting", status: "confirmed" },
  ],
  forbiddenLinks: [
    { a: "rsn_hud1", b: "rsn_hud2" },
    { a: "rsn_hud1", b: "rsn_hud3" },
    { a: "rsn_hud1", b: "rsn_unrelated" },
  ],
  // Siblings must not exist as links AT ALL (excluded inside the LinkLab).
  expectedQuarantined: [
    { a: "rsn_hud1", b: "rsn_hud2" },
    { a: "rsn_hud1", b: "rsn_hud3" },
  ],
};
