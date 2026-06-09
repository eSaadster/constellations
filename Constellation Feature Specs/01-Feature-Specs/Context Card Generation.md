# Context Card Generation
#feature-spec

## Summary

Generate a provenance-backed card for any Slack message, email, event, document, or meeting segment showing related signals, why they connect, unresolved asks, and recent decisions.

## 1. User flow & states

- Entry: user opens a message/event/doc and asks “what is this connected to?”
- Trigger: selected source item, scheduled pre-meeting run, or API request.
- States: source selected → signal normalized → candidates found → links scored → constellation updated → card generated.
- Exit: card displayed with citations and confidence.
- Failure states: missing source access, weak evidence, source rate limit, graph conflict.

## 2. Information architecture

- Surface: context side panel, command palette result, meeting prep page.
- Navigation: source object → context card → constellation detail → signal detail.
- Discovery: “connected items,” “why,” “open asks,” “decisions,” “timeline.”

## 3. Data model

- Reads: Signal, DotLink, Constellation.
- Writes: ContextCard artifact with `claimIds`, `signalIds`, `linkIds`, `generatedAt`.
- Constraints: every card claim requires provenance.
- Privacy: no cross-scope source leakage.

## 4. Permissions & access control

- Actor: authenticated user.
- Read: only consented sources/timeframes/projects.
- Write: graph mutation only after confidence policy passes.
- Execute: brief generation allowed if source access is valid.

## 5. API/integration surface

- `brief.generate_meeting_prep_context`
- `constellation.generate_context_card`
- `graph.explain_path`
- Response includes related items, confidence, evidence, asks, decisions.

## 6. Embedding in current codebase

- `src/artifacts/ContextCard.ts`
- `src/tools/brief/generateContextCard.ts`
- `src/tools/constellation/generateContextCard.ts`
- `src/observability/traces.ts`
- Tests: unit claim provenance; integration Slack→email→card.

## 7. UX/design states

- Default: ranked related items with “Why” evidence.
- Loading: staged progress by source and link scoring.
- Empty: “No strong connections found”; show quarantined possible links only if requested.
- Error: source/auth/rate-limit specific recovery.
- Responsive: card collapses evidence into expandable sections on narrow screens.

## Acceptance criteria

- [ ] Every claim cites at least one Signal or DotLink.
- [ ] Low-confidence links are quarantined, not presented as fact.
- [ ] Integration eval passes `slack_to_calendar` and `email_to_meeting`.
