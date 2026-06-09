# LinkLabAgent
#subagent

A forensic comparison lab for DotLink proposals.

## Input

```ts
type LinkLabInput = {
  anchorSignal: Signal;
  candidateSignals: Signal[];
  allowedRelations: DotLink["relation"][];
  thresholdPolicy: {
    autoConfirmAbove: number;
    quarantineBelow: number;
  };
  allowedTools: [
    "link.score_semantic_overlap",
    "link.score_people_overlap",
    "link.score_temporal_proximity",
    "link.score_artifact_overlap",
    "link.classify_relation"
  ];
};
```

## Output

```ts
type LinkLabResult = {
  proposedLinks: DotLink[];
  exclusions: {
    candidateSignalId: string;
    reason: string;
  }[];
  inconclusive: {
    candidateSignalId: string;
    missingEvidence: string[];
  }[];
};
```

## Isolation policy

The LinkLabAgent can only see the anchor and candidate signals. It cannot:

- Read Slack, email, calendar, docs, or meeting transcripts.
- Mutate the graph.
- Confirm or reject a link globally.
- Access user profile memory outside the payload.

## Tool scope

Allowed:

- `link.score_semantic_overlap`
- `link.score_people_overlap`
- `link.score_temporal_proximity`
- `link.score_artifact_overlap`
- `link.classify_relation`

Forbidden:

- `graph.*`
- `slack.*`
- `email.*`
- `calendar.*`
- `doc.*`
- `meeting.*`
- `constellation.*`
