# Meeting Prep Context
#feature-spec

## Summary

Before a meeting, generate a context brief showing related prior discussions, decisions, open asks, artifacts, and people.

## 1. User flow & states

- Entry: calendar event selected or scheduled pre-meeting automation.
- States: event read → attendees/topics extracted → nearby source search → candidate signals scored → constellation updated → prep brief generated.
- Exit: user sees meeting prep card.

## 2. Information architecture

- Surface: calendar event detail, daily agenda, notification digest.
- Navigation: meeting → context card → constellation → source artifact.

## 3. Data model

- Reads Calendar Event Signal, DotLinks, Constellation.
- Writes ContextCard/Brief with `meetingEventId`.
- Constraints: only include artifacts available to attendee/user.

## 4. Permissions & access control

- Requires calendar read consent and source scopes for connected channels.
- No message sending or source mutation.

## 5. API/integration surface

- `calendar.read_event`
- `calendar.extract_attendees`
- `calendar.find_nearby_events`
- `email.search_email`
- `doc.search_docs`
- `subagent.spawn_link_lab`
- `brief.generate_meeting_prep_context`

## 6. Embedding in current codebase

- `src/tools/brief/generateMeetingPrepContext.ts`
- `src/evals/cases/slack_to_calendar`
- `src/tests/integration/meetingPrep.test.ts`

## 7. UX/design states

- Default: related prior discussions grouped by channel.
- Empty: “No prior context found in your approved sources.”
- Low confidence: “Possible connections” separated from confirmed context.
- Error: source-specific auth or rate-limit recovery.
