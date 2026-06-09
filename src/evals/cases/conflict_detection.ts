import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

/**
 * conflict_detection: a meeting note contradicts a Slack plan. Expected: a
 * `conflicts_with` link (corroborated by shared people + contradiction language).
 */
export const conflict_detection: EvalCase = {
  id: "conflict_detection",
  description: "Meeting note conflicts with a Slack plan",
  prompt: "Does anything conflict with this plan?",
  anchorId: "cd_slack",
  fixtures: [
    makeSignal({
      id: "cd_slack",
      source: "slack",
      timestamp: "2026-03-01T10:00:00.000Z",
      title: "Apollo launch plan: Friday",
      excerpt: "Plan: we will launch Apollo this Friday. @alice @bob aligned.",
      actorIds: ["alice"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch date"],
        decisions: ["launch apollo friday"],
      },
    }),
    makeSignal({
      id: "cd_meeting",
      source: "meeting_transcript",
      timestamp: "2026-03-02T15:00:00.000Z",
      title: "Apollo standup transcript",
      excerpt:
        "alice: actually we are NOT launching Apollo on Friday — instead we push the launch to next sprint.",
      actorIds: ["alice", "bob"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch date"],
        decisions: ["push apollo launch to next sprint"],
      },
    }),
  ],
  expectedLinks: [
    { a: "cd_slack", b: "cd_meeting", relation: "conflicts_with", status: "confirmed" },
  ],
  forbiddenLinks: [],
};
