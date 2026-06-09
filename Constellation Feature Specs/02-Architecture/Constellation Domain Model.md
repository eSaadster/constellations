# Constellation Domain Model
#architecture

Constellation connects work signals into provenance-backed context graph clusters. It does not merely summarize; it explains relationships with evidence and confidence.

## Signal

A raw ingested item from Slack, email, calendar, meeting transcripts, docs, or notes.

```ts
type Signal = {
  id: string;
  source: "slack" | "email" | "calendar" | "meeting_transcript" | "doc" | "note";
  externalId: string;
  url?: string;
  actorIds: string[];
  timestamp: string;
  title?: string;
  excerpt: string;
  fullTextRef?: string;
  extracted: {
    entities: string[];
    people: string[];
    projects: string[];
    dates: string[];
    artifacts: string[];
    asks: string[];
    decisions: string[];
  };
  provenance: {
    ingestedBy: string;
    ingestedAt: string;
    sourceHash: string;
  };
};
```

## DotLink

A proposed or confirmed connection between two signals.

```ts
type DotLink = {
  id: string;
  sourceSignalId: string;
  targetSignalId: string;
  relation:
    | "same_topic"
    | "follow_up_to"
    | "mentions_meeting"
    | "explains_decision"
    | "duplicates_request"
    | "updates_prior_context"
    | "conflicts_with"
    | "blocks"
    | "resolves";
  confidence: number;
  evidence: {
    sharedEntities: string[];
    sharedPeople: string[];
    temporalDistanceHours: number;
    quotedTextOverlap?: string[];
    artifactOverlap?: string[];
    rationale: string;
  };
  status: "proposed" | "confirmed" | "rejected" | "quarantined";
};
```

## Constellation

A cluster of connected signals around one underlying matter.

```ts
type Constellation = {
  id: string;
  name: string;
  summary: string;
  signalIds: string[];
  linkIds: string[];
  people: string[];
  topics: string[];
  artifacts: string[];
  openQuestions: string[];
  decisions: string[];
  asks: string[];
  lastActivityAt: string;
  confidence: number;
  provenance: {
    createdFromLinkIds: string[];
    userCorrections: string[];
  };
};
```

## Safety posture

Constellation should say: “This may connect to these things, because…” It should not claim certainty without provenance.
