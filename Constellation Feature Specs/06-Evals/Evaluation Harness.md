# Evaluation Harness
#eval #production

## Purpose

Measure whether Constellation finds real cross-channel relationships without hallucinating weak connections.

## Fixture worlds

- `slack_to_calendar`: Slack thread references a later calendar invite.
- `email_to_meeting`: Email explains a decision later discussed in transcript.
- `doc_to_thread`: Doc artifact anchors Slack discussion.
- `conflict_detection`: Meeting note conflicts with a Slack plan.
- `false_friend_topic`: Same words but unrelated matter; should be quarantined.

## Metrics

- Link precision.
- Link recall.
- False positive quarantine rate.
- Evidence completeness.
- Context card provenance coverage.
- Tool-plan completion rate over 20+ calls.

## Harness contract

```ts
type EvalCase = {
  id: string;
  fixtures: Signal[];
  prompt: string;
  expectedLinks: Array<Pick<DotLink, "sourceSignalId" | "targetSignalId" | "relation">>;
  forbiddenLinks: Array<{ sourceSignalId: string; targetSignalId: string }>;
  expectedBriefClaims: string[];
};
```
