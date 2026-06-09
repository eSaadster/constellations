import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

/**
 * false_friend_topic: the thesis test. Two signals share the loose word
 * "launch" but concern unrelated matters (a product launch vs a hobby rocket
 * launch) — different people, different project, far apart in time. The system
 * must NOT confirm a link between them (it should quarantine/exclude), while
 * still confirming a genuinely related signal.
 *
 * "A connection is not a vibe. It is an evidence-backed claim."
 */
export const false_friend_topic: EvalCase = {
  id: "false_friend_topic",
  description: "Same words, unrelated matter — must be quarantined",
  prompt: "What is this connected to?",
  anchorId: "ff_anchor",
  fixtures: [
    makeSignal({
      id: "ff_anchor",
      source: "slack",
      timestamp: "2026-04-01T10:00:00.000Z",
      title: "Apollo product launch next week",
      excerpt: "The Apollo product launch is next week — syncing with @alice on the review.",
      actorIds: ["alice"],
      extracted: {
        people: ["alice"],
        projects: ["apollo"],
        entities: ["product launch"],
      },
    }),
    // False friend: only the token "launch" overlaps; different people/project/time.
    makeSignal({
      id: "ff_friend",
      source: "slack",
      timestamp: "2026-06-15T09:00:00.000Z",
      title: "Model rocket launch this weekend",
      excerpt: "Anyone want to watch the model rocket launch this weekend? @carol is driving.",
      actorIds: ["carol"],
      extracted: {
        people: ["carol"],
        projects: ["rocketry-club"],
        entities: ["rocket launch"],
      },
    }),
    // A genuine relation the system SHOULD still find.
    makeSignal({
      id: "ff_real",
      source: "calendar",
      timestamp: "2026-04-03T17:00:00.000Z",
      title: "Apollo product launch review",
      excerpt: "Apollo product launch review with alice.",
      actorIds: ["alice"],
      extracted: {
        people: ["alice"],
        projects: ["apollo"],
        entities: ["product launch"],
      },
    }),
  ],
  expectedLinks: [
    { a: "ff_anchor", b: "ff_real", relation: "mentions_meeting", status: "confirmed" },
  ],
  forbiddenLinks: [{ a: "ff_anchor", b: "ff_friend" }],
  expectedQuarantined: [{ a: "ff_anchor", b: "ff_friend" }],
};
