import type { EvalCase } from "../harness.js";
import { makeSignal } from "./_helpers.js";

const DOC = "https://docs.example.com/apollo-launch-plan";

/**
 * doc_to_thread: a doc artifact anchors a Slack discussion that links to it.
 * Expected: a confirmed `same_topic` link backed by shared artifact + people.
 */
export const doc_to_thread: EvalCase = {
  id: "doc_to_thread",
  description: "Doc artifact anchors a Slack discussion",
  prompt: "What is this Slack thread connected to?",
  anchorId: "d2t_slack",
  fixtures: [
    makeSignal({
      id: "d2t_slack",
      source: "slack",
      timestamp: "2026-01-29T11:00:00.000Z",
      title: "Reviewing the launch plan",
      excerpt: "Reviewing the Apollo launch plan in this doc: " + DOC + " — thoughts @alice?",
      actorIds: ["bob"],
      extracted: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch plan"],
        artifacts: [DOC],
      },
    }),
    makeSignal({
      id: "d2t_doc",
      source: "doc",
      timestamp: "2026-01-28T08:00:00.000Z",
      title: "Apollo Launch Plan",
      excerpt: "Apollo launch plan: milestones, load testing, and the launch review checklist.",
      url: DOC,
      actorIds: ["alice"],
      extracted: {
        people: ["alice"],
        projects: ["apollo"],
        entities: ["launch plan"],
        artifacts: [DOC],
      },
    }),
  ],
  expectedLinks: [{ a: "d2t_slack", b: "d2t_doc", relation: "same_topic", status: "confirmed" }],
  forbiddenLinks: [],
};
