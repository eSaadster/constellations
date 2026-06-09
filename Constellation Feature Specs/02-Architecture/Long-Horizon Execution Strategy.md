# Long-Horizon Execution Strategy
#architecture #production

Constellation must complete tasks spanning 20+ tool calls while preserving plan coherence.

## Strategy encoded in code

`contextStrategy.ts` maintains:

- **Plan ledger**: ordered goals, active step, completed steps, blocked steps.
- **Call ledger**: tool call ID, input hash, output summary, full output ref, trace ID.
- **Evidence ledger**: claims, supporting signal IDs, DotLink IDs, confidence.
- **Context compaction**: compress older tool outputs into typed summaries while retaining full refs.
- **Decision checkpoints**: when graph mutation or confidence threshold crossing occurs.

## Example 24-call run

Task: “Connect this Slack thread to relevant prior context and prepare me for the meeting.”

1. `slack.read_message`
2. `slack.fetch_thread`
3. `signal.normalize_signal`
4. `signal.extract_people`
5. `signal.extract_entities`
6. `signal.extract_artifacts`
7. `email.search_email`
8. `email.read_thread`
9. `calendar.find_nearby_events`
10. `calendar.read_event`
11. `doc.search_docs`
12. `doc.read_doc`
13. `meeting.ingest_transcript`
14. `meeting.extract_decisions`
15. `link.find_candidate_links`
16. `subagent.spawn_link_lab`
17. `subagent.collect_result`
18. `link.create_dot_link`
19. `graph.add_edge`
20. `constellation.update_constellation`
21. `constellation.extract_open_questions`
22. `constellation.extract_decisions`
23. `constellation.get_timeline`
24. `brief.generate_meeting_prep_context`
25. `consent.audit_access`

## Coherence invariant

Every generated brief must be traceable backward to signals and DotLinks via the evidence ledger.
