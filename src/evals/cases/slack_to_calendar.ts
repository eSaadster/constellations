import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

const DOC = "https://docs.example.com/apollo-plan";

/**
 * slack_to_calendar: a Slack thread references a later calendar invite for the
 * same review, with the same attendees. Expected: a confirmed `mentions_meeting`
 * link. A noise doc about an unrelated topic must not connect.
 */
export const slack_to_calendar: EvalCase = {
  id: "slack_to_calendar",
  description: "Slack thread references a later calendar invite",
  prompt: "What is this Slack thread connected to?",
  anchorId: "s2c_slack",
  fixtures: [
    makeSignal({
      id: "s2c_slack",
      source: "slack",
      timestamp: "2026-02-02T16:00:00.000Z",
      title: "Apollo launch review timing",
      excerpt: "Can we set up the Apollo launch review? I'll send a calendar invite to @bob.",
      actorIds: ["alice"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch review"],
        artifacts: [DOC],
        asks: ["set up the apollo launch review"],
      },
    }),
    makeSignal({
      id: "s2c_cal",
      source: "calendar",
      timestamp: "2026-02-04T17:00:00.000Z",
      title: "Apollo Launch Review",
      excerpt: "Apollo launch review meeting. Attendees alice and bob. Plan: " + DOC,
      actorIds: ["alice", "bob"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch review"],
        artifacts: [DOC],
      },
    }),
    makeSignal({
      id: "s2c_noise",
      source: "doc",
      timestamp: "2026-02-03T10:00:00.000Z",
      title: "Q3 office snacks budget",
      excerpt: "Spreadsheet of snack budget for the office kitchen. Owner: dave.",
      actorIds: ["dave"],
      extracted: { people: ["dave"], projects: ["facilities"], entities: ["snack budget"] },
    }),
  ],
  expectedLinks: [
    { a: "s2c_slack", b: "s2c_cal", relation: "mentions_meeting", status: "confirmed" },
  ],
  forbiddenLinks: [{ a: "s2c_slack", b: "s2c_noise" }],
};
