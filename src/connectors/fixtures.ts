import type { ConnectorDataset } from "./mock.js";

/**
 * Default demo dataset used by `constellation ingest-fixtures` and the local
 * demo. It tells one coherent story (the "Apollo launch review") across four
 * sources with shared people + a shared artifact, plus one false-friend signal
 * that shares only the word "launch" and must NOT connect.
 */
const APOLLO_DOC_URL = "https://docs.example.com/apollo-launch-plan";

export const DEMO_FIXTURES: ConnectorDataset = {
  slack: [
    {
      source: "slack",
      externalId: "C_APOLLO/p1700000100",
      url: "https://acme.slack.com/archives/C_APOLLO/p1700000100",
      actorIds: ["alice"],
      timestamp: "2026-02-02T16:00:00.000Z",
      title: "Apollo launch review timing",
      text: "Hey @bob can we move the Apollo launch review to next week? Plan is in the doc: https://docs.example.com/apollo-launch-plan",
      raw: { containerId: "C_APOLLO" },
      extractedHints: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch review"],
        artifacts: [APOLLO_DOC_URL],
        asks: ["move the apollo launch review to next week"],
      },
    },
    {
      source: "slack",
      externalId: "C_HOBBY/p1700000200",
      url: "https://acme.slack.com/archives/C_HOBBY/p1700000200",
      actorIds: ["carol"],
      timestamp: "2026-01-05T09:00:00.000Z",
      title: "Model rocket launch this weekend",
      text: "Anyone want to watch the model rocket launch this weekend? Totally unrelated to work :)",
      raw: { containerId: "C_HOBBY" },
      extractedHints: {
        people: ["carol"],
        projects: ["rocketry-club"],
        entities: ["launch"],
      },
    },
  ],
  calendar: [
    {
      source: "calendar",
      externalId: "evt_apollo_review",
      url: "https://calendar.example.com/evt_apollo_review",
      actorIds: ["alice", "bob"],
      timestamp: "2026-02-09T17:00:00.000Z",
      title: "Apollo Launch Review",
      text: "Apollo launch review meeting. Attendees: alice, bob. Agenda: go/no-go for the apollo launch.",
      extractedHints: {
        people: ["alice", "bob"],
        projects: ["apollo"],
        entities: ["launch review"],
      },
    },
  ],
  email: [
    {
      source: "email",
      externalId: "mail_apollo_decision",
      actorIds: ["bob", "alice"],
      timestamp: "2026-02-01T12:00:00.000Z",
      title: "Decision: Apollo launch criteria",
      text: "Team, we decided the Apollo launch must pass the load test before go-live. See plan: https://docs.example.com/apollo-launch-plan",
      extractedHints: {
        people: ["bob", "alice"],
        projects: ["apollo"],
        entities: ["launch criteria"],
        artifacts: [APOLLO_DOC_URL],
        decisions: ["apollo launch must pass the load test before go-live"],
      },
    },
  ],
  doc: [
    {
      source: "doc",
      externalId: "doc_apollo_plan",
      url: APOLLO_DOC_URL,
      actorIds: ["alice"],
      timestamp: "2026-01-28T08:00:00.000Z",
      title: "Apollo Launch Plan",
      text: "Apollo launch plan: milestones, load testing, and the launch review checklist.",
      extractedHints: {
        people: ["alice"],
        projects: ["apollo"],
        entities: ["launch plan", "launch review"],
        artifacts: [APOLLO_DOC_URL],
      },
    },
  ],
};
