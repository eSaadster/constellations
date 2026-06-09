# ADR-002: Provenance-First Safety
#decision #safety

## Status

Proposed

## Context

A personal context graph can feel creepy if it overstates hidden meaning or makes unsupported inferences.

## Decision

All links, brief claims, and context card claims must cite evidence. Confidence thresholds separate confirmed, possible, and quarantined links. User corrections are stored and used by scoring.

## Consequences

- The product explains “why” before asserting connections.
- Low-confidence relationships remain inspectable but not user-facing by default.
- Evaluation can measure evidence coverage, not just summary quality.
