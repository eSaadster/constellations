# Five Properties

These properties must hold across the Constellation build.

## 1. Fifty or more tools across at least four namespaces

Requirement: model-driven tool selection over a coherent registry, not a hand-routed chain of conditionals.

Evidence notes:
- [[Tool Namespace Registry]] defines 70+ tools across Slack, Email, Calendar, Meeting, Doc, Signal, Link, Graph, Constellation, Brief, Consent, and Subagent namespaces.
- [[Tool Selection Architecture]] defines registry metadata, schemas, capabilities, and planner selection.

## 2. Subagent orchestration

Requirement: at least one tool spawns an isolated subagent with scoped context/tools and structured return value.

Evidence notes:
- [[LinkLabAgent]] receives anchor/candidate signals only.
- It cannot read sources or mutate graph state.
- Parent decides whether to persist links.

## 3. Long-horizon execution

Requirement: complete a 20+ tool-call task in one session without losing plan coherence; context strategy must be encoded.

Evidence notes:
- [[Long-Horizon Execution Strategy]] describes plan ledger, evidence ledger, context compaction, and call trace.
- [[Meeting Prep Context]] includes a 24-step example run.

## 4. Production scaffolding

Requirement: observability, retries/backoff, rate limiting, typed errors, eval harness, unit and integration tests, deployment-shaped repo.

Evidence notes:
- [[Production Scaffolding]]
- [[Evaluation Harness]]
- [[Typed Error Taxonomy]]

## 5. Composable tool inputs and outputs

Requirement: at least one tool consumes structured output of another.

Evidence notes:
- [[Composable Tool Chains]] documents `slack.fetch_thread -> signal.normalize_signal -> link.find_candidate_links -> subagent.spawn_link_lab -> constellation.update_cluster -> brief.generate_context_card`.
