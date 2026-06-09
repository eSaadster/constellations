# Subagent Orchestration
#subagent #architecture

Constellation uses pi-core-ai subagents for isolated forensic comparison and scoped source discovery. Subagent boundaries are runtime-owned by pi-core-ai, not by any host adapter.

## Required real boundary

A subagent must have:

- Isolated context window.
- Scoped input payload.
- Scoped tool registry.
- No arbitrary source access unless granted.
- No parent memory except provided input.
- Structured result returned to parent.

## Primary subagent

- [[LinkLabAgent]] compares an anchor signal to candidate signals and returns proposed links, exclusions, and inconclusive candidates.

## Parent responsibilities

- Select candidates.
- Ask pi-core-ai subagent runtime to spawn with narrow allowed tools.
- Validate returned links.
- Apply confidence policy.
- Persist graph changes.
- Log provenance and eval traces.
