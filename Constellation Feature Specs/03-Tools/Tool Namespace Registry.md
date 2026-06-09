# Tool Namespace Registry
#tool #architecture

The registry exposes coherent namespaces with typed contracts and capability metadata. The planner selects tools by namespace, input schema, output schema, side effects, rate limits, and required consent scope.

## Namespaces and tools

### slack.*
- `slack.list_channels`
- `slack.fetch_recent_messages`
- `slack.fetch_thread`
- `slack.read_message`
- `slack.search_messages`
- `slack.extract_permalink`
- `slack.classify_message`
- `slack.extract_mentions`

### email.*
- `email.list_threads`
- `email.read_thread`
- `email.search_email`
- `email.extract_recipients`
- `email.extract_subject_line`
- `email.extract_quoted_history`
- `email.classify_thread`
- `email.extract_attachments`

### calendar.*
- `calendar.list_events`
- `calendar.read_event`
- `calendar.extract_attendees`
- `calendar.extract_agenda`
- `calendar.extract_meeting_link`
- `calendar.find_nearby_events`
- `calendar.map_event_to_transcript`

### meeting.*
- `meeting.ingest_transcript`
- `meeting.segment_transcript`
- `meeting.extract_decisions`
- `meeting.extract_action_items`
- `meeting.extract_topics`
- `meeting.map_speaker_to_contact`
- `meeting.summarize_segment`

### doc.*
- `doc.search_docs`
- `doc.read_doc`
- `doc.extract_title`
- `doc.extract_sections`
- `doc.extract_mentions`
- `doc.extract_links`
- `doc.map_doc_to_project`

### signal.*
- `signal.normalize_signal`
- `signal.extract_entities`
- `signal.extract_people`
- `signal.extract_projects`
- `signal.extract_artifacts`
- `signal.extract_dates`
- `signal.create_signal`
- `signal.dedupe_signal`

### link.*
- `link.find_candidate_links`
- `link.score_semantic_overlap`
- `link.score_people_overlap`
- `link.score_temporal_proximity`
- `link.score_artifact_overlap`
- `link.classify_relation`
- `link.create_dot_link`
- `link.reject_dot_link`
- `link.confirm_dot_link`
- `link.quarantine_weak_link`

### graph.*
- `graph.add_node`
- `graph.add_edge`
- `graph.get_neighbors`
- `graph.find_clusters`
- `graph.merge_clusters`
- `graph.split_cluster`
- `graph.explain_path`
- `graph.detect_conflict`
- `graph.detect_orphan_signal`

### constellation.*
- `constellation.create_constellation`
- `constellation.update_constellation`
- `constellation.rename_constellation`
- `constellation.summarize_constellation`
- `constellation.extract_open_questions`
- `constellation.extract_decisions`
- `constellation.extract_asks`
- `constellation.get_timeline`
- `constellation.generate_context_card`

### brief.*
- `brief.generate_daily_dot_digest`
- `brief.generate_meeting_prep_context`
- `brief.generate_reply_context`
- `brief.generate_project_timeline`
- `brief.generate_unresolved_asks_report`

### consent.*
- `consent.check_scope`
- `consent.request_source_access`
- `consent.redact_signal`
- `consent.audit_access`

### subagent.*
- `subagent.spawn_link_lab`
- `subagent.spawn_source_scout`
- `subagent.collect_result`

Total: 78 tools across 12 namespaces.

## Registry contract

Each tool entry should include:

```ts
type ToolDefinition<I, O> = {
  name: string;
  namespace: string;
  description: string;
  inputSchema: JsonSchema<I>;
  outputSchema: JsonSchema<O>;
  sideEffects: "none" | "source_read" | "graph_write" | "brief_write";
  requiredConsentScopes: string[];
  rateLimitKey?: string;
  retryPolicy?: "none" | "source_api" | "embedding";
  produces: string[];
  consumes: string[];
};
```
