import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

/**
 * email_to_meeting: an email states a decision that is later discussed in a
 * meeting transcript. Expected: a confirmed `explains_decision` link.
 */
export const email_to_meeting: EvalCase = {
  id: "email_to_meeting",
  description: "Email explains a decision later discussed in a transcript",
  prompt: "What decision context surrounds this email?",
  anchorId: "e2m_email",
  fixtures: [
    makeSignal({
      id: "e2m_email",
      source: "email",
      timestamp: "2026-02-01T09:00:00.000Z",
      title: "Decision: Apollo go-live criteria",
      excerpt:
        "Team, we decided Apollo must pass the load test before go-live. Owners: alice and bob.",
      actorIds: ["bob", "alice"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["load test", "go-live criteria"],
        decisions: ["apollo must pass the load test before go-live"],
      },
    }),
    makeSignal({
      id: "e2m_meeting",
      source: "meeting_transcript",
      timestamp: "2026-02-02T15:00:00.000Z",
      title: "Apollo sync transcript",
      excerpt:
        "alice: as we decided over email, Apollo go-live depends on the load test passing. bob: agreed.",
      actorIds: ["alice", "bob"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["load test", "go-live criteria"],
        decisions: ["apollo go-live depends on load test"],
      },
    }),
  ],
  expectedLinks: [
    { a: "e2m_email", b: "e2m_meeting", relation: "explains_decision", status: "confirmed" },
  ],
  forbiddenLinks: [],
};
