# Daily Dot Digest
#feature-spec

## Summary

Produce a daily digest of newly discovered context graph connections, unresolved asks, conflicts, and meaningful changes across approved sources.

## 1. User flow & states

- Entry: scheduled daily run or manual command.
- States: recent signals loaded → new DotLinks identified → constellations updated → changes summarized → digest generated.
- Exit: digest displayed or delivered to configured surface.

## 2. Information architecture

- Surface: daily digest page, email/slack draft, dashboard widget.
- Sections: new connections, unresolved asks, conflicts, changed matters, quarantined low-confidence trends.

## 3. Data model

- Reads Signals, DotLinks, Constellations, user corrections.
- Writes Digest artifact with claim provenance.
- Constraint: digest claims must reference source evidence.

## 4. Permissions & access control

- Only approved sources and timeframe.
- Delivery destinations are opt-in.
- No automatic sending unless user explicitly enables it.

## 5. API/integration surface

- `brief.generate_daily_dot_digest`
- `constellation.extract_open_questions`
- `graph.detect_conflict`
- `consent.audit_access`

## 6. Embedding in current codebase

- `src/tools/brief/generateDailyDotDigest.ts`
- `src/evals/cases/conflict_detection`
- Unit tests for digest claim filtering.

## 7. UX/design states

- Default: concise list with evidence expandable.
- Empty: “No new meaningful connections today.”
- Conflict: highlighted with both sides and provenance.
- Mobile/narrow: grouped accordions.
