import type { Signal, SignalSource, ExtractedFacts } from "../../artifacts/Signal.js";
import { sourceHash } from "../../graph/provenance.js";

/** Build a fully-formed Signal fixture with sensible defaults. */
export function makeSignal(input: {
  id: string;
  source: SignalSource;
  timestamp: string;
  title?: string;
  excerpt: string;
  url?: string;
  actorIds?: string[];
  extracted?: Partial<ExtractedFacts>;
}): Signal {
  return {
    id: input.id,
    source: input.source,
    externalId: `ext_${input.id}`,
    url: input.url,
    actorIds: input.actorIds ?? [],
    timestamp: input.timestamp,
    title: input.title,
    excerpt: input.excerpt,
    fullTextRef: `ref://${input.source}/${input.id}`,
    extracted: {
      entities: [],
      people: [],
      projects: [],
      dates: [],
      artifacts: [],
      asks: [],
      decisions: [],
      ...input.extracted,
    },
    provenance: {
      ingestedBy: `${input.source}.fixture`,
      ingestedAt: input.timestamp,
      sourceHash: sourceHash([input.id, input.excerpt]),
    },
  };
}
