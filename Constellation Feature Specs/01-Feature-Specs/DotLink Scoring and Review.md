# DotLink Scoring and Review
#feature-spec

## Summary

Find, score, explain, confirm, reject, or quarantine proposed relationships between signals.

## 1. User flow & states

- Entry: new Signal stored or user asks for related context.
- States: candidates found → LinkLabAgent spawned → scores computed → relation classified → policy applied → user may correct.
- Exit: DotLinks persisted as confirmed/proposed/quarantined/rejected.

## 2. Information architecture

- Surfaces: link review queue, constellation detail, context card “Why” panel.
- Discovery: by confidence, relation, source, people, artifact, status.

## 3. Data model

- DotLink with evidence object.
- User corrections stored in Constellation provenance.
- Constraints: confidence 0..1; no duplicate active link for same pair/relation.

## 4. Permissions & access control

- Scoring can use only signals visible to the user.
- Subagent cannot mutate graph.
- User corrections require write access to user graph.

## 5. API/integration surface

- `link.find_candidate_links`
- `subagent.spawn_link_lab`
- `link.create_dot_link`
- `link.confirm_dot_link`
- `link.reject_dot_link`
- `link.quarantine_weak_link`

## 6. Embedding in current codebase

- `src/graph/scoring.ts`
- `src/subagents/LinkLabAgent.ts`
- `src/safety/confidencePolicy.ts`
- Unit tests for score weighting; integration test for false friend quarantine.

## 7. UX/design states

- Proposed link: evidence visible, user can confirm/reject.
- Confirmed link: shown in graph and context cards.
- Quarantined link: hidden by default; inspectable for debugging.
- Conflict: explicit warning and evidence comparison.
