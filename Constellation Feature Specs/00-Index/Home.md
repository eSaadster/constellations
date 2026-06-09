# Constellation Feature Specification Vault

A structured Obsidian vault for designing **Constellation**: a production-shaped autonomous agent that connects scattered work signals into provenance-backed context graph constellations.

## Core requirement checklist

- [[Five Properties]]
- [[Constellation Domain Model]]
- [[Tool Namespace Registry]]
- [[Subagent Orchestration]]
- [[Long-Horizon Execution Strategy]]
- [[Production Scaffolding]]
- [[Composable Tool Chains]]

## Spec workflow

1. Start from [[Feature Spec Template]].
2. Fill all seven dimensions:
   - User flow & states
   - Information architecture
   - Data model
   - Permissions & access control
   - API/integration surface
   - Embedding in current codebase
   - UX/design states
3. Link to architecture notes, tool contracts, eval cases, and decisions.
4. Record unresolved questions explicitly.

## Seed feature specs

- [[Context Card Generation]]
- [[Signal Ingestion Pipeline]]
- [[DotLink Scoring and Review]]
- [[Meeting Prep Context]]
- [[Daily Dot Digest]]

## pi-core-ai implementation scaffolding

- [[pi-core-ai Runtime Architecture]]
- [[Pi AI Implementation Scaffold]]
- [[Seven Dimension Implementation Map]]
- [[Agent Ready Build Prompt]]
- Optional Pi host adapter templates:
  - [[constellation-extension.ts]]
  - [[constellation-tool.ts]]
- [[pi-core-ai-runtime.ts]]
- [[orchestrator.ts]]
- [[context-strategy.ts]]

## Tags

Use these tags consistently: `#feature-spec`, `#architecture`, `#tool`, `#subagent`, `#eval`, `#decision`, `#production`, `#safety`.
