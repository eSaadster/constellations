# Composable Tool Chains
#architecture #tool

Constellation tools must produce structured outputs that downstream tools consume.

## Primary chain

```txt
slack.fetch_thread
  -> signal.normalize_signal
  -> signal.extract_entities
  -> email.search_email
  -> link.find_candidate_links
  -> subagent.spawn_link_lab
  -> graph.add_edge
  -> constellation.update_constellation
  -> brief.generate_meeting_prep_context
```

## Example typed composition

```ts
const thread = await tools.slack.fetch_thread({ channelId, threadTs });
const signal = await tools.signal.normalize_signal({ raw: thread });
const entities = await tools.signal.extract_entities({ signalId: signal.id });
const emailHits = await tools.email.search_email({ query: entities.entities.join(" ") });
const candidates = await tools.link.find_candidate_links({ anchorSignalId: signal.id, candidateRefs: emailHits.threadIds });
const lab = await tools.subagent.spawn_link_lab({ anchorSignal: signal, candidateSignals: candidates.signals });
const edges = await Promise.all(lab.proposedLinks.map(link => tools.graph.add_edge({ link })));
const constellation = await tools.constellation.update_constellation({ edges });
const card = await tools.brief.generate_meeting_prep_context({ constellationId: constellation.id });
```

## Invariant

A brief claim must cite `Signal.id` and `DotLink.id`; otherwise it is excluded or marked unverified.
