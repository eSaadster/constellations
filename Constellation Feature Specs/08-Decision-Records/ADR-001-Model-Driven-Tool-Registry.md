# ADR-001: Model-Driven Tool Registry
#decision

## Status

Proposed

## Context

Constellation needs 50+ tools across many namespaces. A conditional router would become brittle and would not demonstrate scalable tool selection.

## Decision

Use a typed registry with schemas, side effects, consent scopes, rate limits, retry policies, and produces/consumes metadata. The planner proposes tool calls from registry summaries. The executor validates schema and policy before execution.

## Consequences

- Tool count can grow without router collapse.
- Composition becomes explicit through output/input types.
- Bad model plans can be rejected deterministically.
