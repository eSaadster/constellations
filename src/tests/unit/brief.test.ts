import { describe, expect, it } from "vitest";
import { MemoryGraphStore } from "../../graph/memoryStore.js";
import { makeSignal } from "../../evals/cases/_helpers.js";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { SourceUnavailableError } from "../../resilience/errors.js";
import type { DotLink } from "../../artifacts/DotLink.js";
import type { Constellation } from "../../artifacts/Constellation.js";
import {
  buildBriefTask,
  buildGraphDump,
  computeBriefAnalytics,
  extractJsonCandidate,
  generateBrief,
  parseBriefResponse,
} from "../../agent/brief.js";

setLogger(createLogger({ level: "silent" }));

const NOW = "2026-06-09T00:00:00.000Z";

function link(
  id: string,
  a: string,
  b: string,
  status: DotLink["status"],
  confidence: number,
  evidence: Partial<DotLink["evidence"]> = {},
): DotLink {
  return {
    id,
    sourceSignalId: a,
    targetSignalId: b,
    relation: "same_topic",
    confidence,
    evidence: { sharedEntities: [], sharedPeople: [], temporalDistanceHours: 1, rationale: "r", ...evidence },
    status,
  };
}

function constellation(overrides: Partial<Constellation> & Pick<Constellation, "id" | "name">): Constellation {
  return {
    summary: "s",
    signalIds: [],
    linkIds: [],
    people: [],
    topics: [],
    artifacts: [],
    openQuestions: [],
    decisions: [],
    asks: [],
    lastActivityAt: NOW,
    confidence: 0.5,
    provenance: { createdFromLinkIds: [], userCorrections: [] },
    ...overrides,
  };
}

/**
 * Fixture graph (now = 2026-06-09T00:00Z, tz +5):
 *   s1 slack  Jun 5  — Maya/Tariq mentioned, open-loop language
 *   s2 email  Jun 6  — Apollo kickoff (cross-source confirmed link to s1)
 *   s3 cal    Jun 6 21:00Z = 02:00 local — off-hours, recurring "cerebrum"
 *   s4 cal    Jun 7 21:00Z = 02:00 local — off-hours, recurring "cerebrum"
 *   s5/s6 cal Jun 8 07:00Z — same start instant (collision), duplicate-invite
 *             pair via shared Teams URL on proposed link l2
 *   s7 doc    May 1 — fixture-looking (docs.example.com); only link is REJECTED -> orphan
 *   s8 slack  Jan 1 — confirmation-code noise, raw Slack actor id, orphan
 */
function buildFixtureStore(): MemoryGraphStore {
  const store = new MemoryGraphStore();
  store.addSignal(
    makeSignal({
      id: "s1",
      source: "slack",
      timestamp: "2026-06-05T10:00:00.000Z",
      excerpt: "please review the Apollo deck",
      actorIds: ["maya@phi.dev"],
      extracted: { people: ["Maya", "Tariq"] },
    }),
  );
  store.addSignal(
    makeSignal({
      id: "s2",
      source: "email",
      timestamp: "2026-06-06T12:00:00.000Z",
      title: "Apollo kickoff",
      excerpt: "kickoff agenda attached",
      actorIds: ["maya@phi.dev", "tariq@phi.dev"],
    }),
  );
  store.addSignal({
    ...makeSignal({
      id: "s3",
      source: "calendar",
      timestamp: "2026-06-06T21:00:00.000Z",
      title: "Cerebrum sprint",
      excerpt: "booked for 3 AM again",
    }),
    externalId: "cerebrum_20260606T210000Z",
  });
  store.addSignal({
    ...makeSignal({
      id: "s4",
      source: "calendar",
      timestamp: "2026-06-07T21:00:00.000Z",
      title: "Cerebrum sprint",
      excerpt: "sprint block",
    }),
    externalId: "cerebrum_20260607T210000Z",
  });
  store.addSignal(
    makeSignal({
      id: "s5",
      source: "calendar",
      timestamp: "2026-06-08T07:00:00.000Z",
      title: "Huddle A",
      excerpt: "standup",
    }),
  );
  store.addSignal(
    makeSignal({
      id: "s6",
      source: "calendar",
      timestamp: "2026-06-08T07:00:00.000Z",
      title: "Huddle B",
      excerpt: "standup duplicate",
    }),
  );
  store.addSignal(
    makeSignal({
      id: "s7",
      source: "doc",
      timestamp: "2026-05-01T08:00:00.000Z",
      title: "Apollo Launch Plan",
      excerpt: "launch plan doc",
      url: "https://docs.example.com/apollo",
    }),
  );
  store.addSignal(
    makeSignal({
      id: "s8",
      source: "slack",
      timestamp: "2026-01-01T07:00:00.000Z", // 12:00 local — keeps it out of offHours
      excerpt: "Your Slack confirmation code is 123456",
      actorIds: ["U0AAAAAAAA"],
    }),
  );

  store.addLink(link("l1", "s1", "s2", "confirmed", 0.8, { sharedPeople: ["Maya"] }));
  store.addLink(link("l2", "s5", "s6", "proposed", 0.5, { artifactOverlap: ["https://teams.example/j/1"], temporalDistanceHours: 0 }));
  store.addLink(link("l3", "s7", "s2", "rejected", 0.1));
  store.addLink(link("l4", "s3", "s4", "confirmed", 0.6, { temporalDistanceHours: 24 }));

  store.upsertConstellation(
    constellation({
      id: "con_t",
      name: "Apollo",
      signalIds: ["s1", "s2"],
      linkIds: ["l1"],
      lastActivityAt: "2026-05-20T00:00:00.000Z",
      openQuestions: ["who owns the deck?"],
    }),
  );
  return store;
}

describe("computeBriefAnalytics", () => {
  const store = buildFixtureStore();
  const analytics = computeBriefAnalytics(store, { nowIso: NOW, tzOffsetHours: 5 });

  it("counts signals/links/constellations and the source histogram", () => {
    expect(analytics.counts).toEqual({ signals: 8, links: 4, constellations: 1 });
    expect(analytics.bySource).toEqual({ slack: 2, email: 1, calendar: 4, doc: 1 });
  });

  it("treats rejected links as non-evidence: s7 and s8 are orphans", () => {
    expect(analytics.orphans.map((o) => o.id)).toEqual(["s7", "s8"]);
  });

  it("counts actors across actorIds and extracted.people, once per signal", () => {
    const byActor = new Map(analytics.actors.map((a) => [a.actor, a]));
    expect(byActor.get("maya@phi.dev")?.signalCount).toBe(2);
    expect(byActor.get("maya@phi.dev")?.sources).toEqual(["email", "slack"]);
    expect(byActor.get("Maya")?.signalCount).toBe(1);
    expect(byActor.get("Tariq")?.signalCount).toBe(1);
    const phiDev = analytics.actorDomains.find((d) => d.domain === "phi.dev");
    expect(phiDev?.signalCount).toBe(2);
  });

  it("computes link stats: histograms, mean confidence, corroboration, cross-source", () => {
    expect(analytics.linkStats.byStatus).toEqual({ confirmed: 2, proposed: 1, rejected: 1 });
    expect(analytics.linkStats.meanConfidence).toBe(0.5); // (0.8+0.5+0.1+0.6)/4
    expect(analytics.linkStats.corroboratedRatio).toBe(0.5); // l1 (people) + l2 (artifact)
    expect(analytics.linkStats.crossSourceCount).toBe(1); // only l1 (l3 is rejected)
  });

  it("ranks top links by confidence with endpoint titles and rationale", () => {
    expect(analytics.topLinks[0]?.id).toBe("l1");
    expect(analytics.topLinks[0]?.targetTitle).toBe("Apollo kickoff");
    expect(analytics.topLinks[0]?.rationale).toBe("r");
  });

  it("flags off-hours events and late-hour text mentions in local time", () => {
    const ids = analytics.offHours.map((o) => o.id);
    expect(ids).toEqual(["s3", "s4"]);
    const s3 = analytics.offHours.find((o) => o.id === "s3");
    expect(s3?.localHour).toBe(2);
    expect(s3?.flags.some((f) => f.includes("3 AM"))).toBe(true);
  });

  it("detects same-instant calendar collisions and shared-artifact duplicate pairs", () => {
    expect(analytics.calendarCollisions).toHaveLength(1);
    expect(analytics.calendarCollisions[0]?.signalIds).toEqual(["s5", "s6"]);
    expect(analytics.sharedArtifactPairs).toHaveLength(1);
    expect(analytics.sharedArtifactPairs[0]?.linkId).toBe("l2");
    expect(analytics.sharedArtifactPairs[0]?.signalIds).toEqual(["s5", "s6"]);
  });

  it("detects recurring calendar series and days since the last occurrence", () => {
    expect(analytics.recurringSeries).toHaveLength(1);
    const series = analytics.recurringSeries[0];
    expect(series?.stem).toBe("cerebrum");
    expect(series?.occurrences).toBe(2);
    expect(series?.signalIds).toEqual(["s3", "s4"]);
    expect(series?.daysSinceLast).toBe(1);
  });

  it("computes recency, the largest timeline gaps, and cluster staleness/cohesion", () => {
    expect(analytics.recency.newest).toBe("2026-06-08T07:00:00.000Z");
    expect(analytics.recency.oldest).toBe("2026-01-01T07:00:00.000Z");
    expect(analytics.recency.last7Days).toBe(6); // s1..s6
    expect(analytics.recency.largestGaps[0]).toMatchObject({ fromSignalId: "s8", toSignalId: "s7" });
    const cluster = analytics.clusters[0];
    expect(cluster?.id).toBe("con_t");
    expect(cluster?.staleDays).toBe(20);
    expect(cluster?.cohesion).toBe(1); // l1 confirmed
    expect(cluster?.sources).toEqual(["email", "slack"]);
  });

  it("flags hygiene: fixtures, noise, unresolved raw actor ids, empty extraction", () => {
    expect(analytics.hygiene.suspectedFixtures.map((f) => f.id)).toContain("s7");
    expect(analytics.hygiene.noiseCandidates.map((n) => n.id)).toContain("s8");
    expect(analytics.hygiene.unresolvedActorIds).toEqual(["U0AAAAAAAA"]);
    expect(analytics.hygiene.emptyExtractionCount).toBe(7); // all but s1
    expect(analytics.hygiene.emptyExtractionRatio).toBeCloseTo(7 / 8, 3);
  });

  it("handles an empty store without NaN or crashes", () => {
    const empty = computeBriefAnalytics(new MemoryGraphStore(), { nowIso: NOW });
    expect(empty.counts).toEqual({ signals: 0, links: 0, constellations: 0 });
    expect(empty.linkStats.meanConfidence).toBe(0);
    expect(empty.linkStats.corroboratedRatio).toBe(0);
    expect(empty.hygiene.emptyExtractionRatio).toBe(0);
    expect(empty.recency.newest).toBeUndefined();
    expect(empty.orphans).toEqual([]);
  });
});

describe("buildBriefTask", () => {
  it("inlines every signal id, verbatim excerpts, analytics, and the json output contract", () => {
    const store = buildFixtureStore();
    const analytics = computeBriefAnalytics(store, { nowIso: NOW });
    const task = buildBriefTask(analytics, buildGraphDump(store));
    for (const s of store.listSignals()) expect(task).toContain(`"${s.id}"`);
    expect(task).toContain("please review the Apollo deck");
    expect(task).toContain("```json");
    expect(task).toContain('"crossSourceCount": 1');
    expect(task).toContain("a vibe");
    expect(task).toContain("Do NOT call any tools");
  });
});

const VALID_BRIEF = {
  headline: "Two Huddles share one Teams link on Jun 8",
  insights: [
    {
      title: "Duplicate huddle invite on Jun 8",
      category: "schedule_hygiene",
      urgency: "today",
      observation: "s5 and s6 start at the same instant and share a Teams URL.",
      interpretation: "Likely a duplicate invite (inference).",
      suggestedAction: "Ask Maya which huddle is real and cancel the other.",
      signalIds: ["s5", "s6"],
      confidence: "high",
    },
  ],
  radar: ["Maya appearing in 2 of 8 signals (s1, s2)"],
  omitted: "Skipped the confirmation-code noise.",
};

describe("parseBriefResponse", () => {
  it("parses a valid ```json fence after prose", () => {
    const text = `Let me analyze.\n\n\`\`\`json\n${JSON.stringify(VALID_BRIEF)}\n\`\`\``;
    const parsed = parseBriefResponse(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.brief.headline).toBe(VALID_BRIEF.headline);
      expect(parsed.brief.insights[0]?.signalIds).toEqual(["s5", "s6"]);
    }
  });

  it("takes the LAST json fence when there are several", () => {
    const first = { ...VALID_BRIEF, headline: "draft" };
    const text = `\`\`\`json\n${JSON.stringify(first)}\n\`\`\`\nrevised:\n\`\`\`json\n${JSON.stringify(VALID_BRIEF)}\n\`\`\``;
    const parsed = parseBriefResponse(text);
    expect(parsed.ok && parsed.brief.headline).toBe(VALID_BRIEF.headline);
  });

  it("accepts an untagged fence and bare JSON", () => {
    expect(parseBriefResponse(`\`\`\`\n${JSON.stringify(VALID_BRIEF)}\n\`\`\``).ok).toBe(true);
    expect(parseBriefResponse(JSON.stringify(VALID_BRIEF)).ok).toBe(true);
  });

  it("falls back to markdown on malformed JSON", () => {
    const text = "```json\n{ not valid json\n```";
    const parsed = parseBriefResponse(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.fallback.markdown).toBe(text.trim());
  });

  it("falls back to markdown when the JSON violates the schema", () => {
    const bad = { headline: "h", insights: [] }; // insights min(1)
    expect(parseBriefResponse(`\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``).ok).toBe(false);
    const uncited = { headline: "h", insights: [{ title: "t", observation: "o", signalIds: [] }] };
    expect(parseBriefResponse(`\`\`\`json\n${JSON.stringify(uncited)}\n\`\`\``).ok).toBe(false);
  });

  it("applies lenient defaults for category/urgency/radar/omitted", () => {
    const minimal = {
      headline: "h",
      insights: [{ title: "t", category: "made_up", observation: "o", signalIds: ["s1"] }],
    };
    const parsed = parseBriefResponse(`\`\`\`json\n${JSON.stringify(minimal)}\n\`\`\``);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.brief.insights[0]?.category).toBe("anomaly");
      expect(parsed.brief.insights[0]?.urgency).toBe("monitor");
      expect(parsed.brief.radar).toEqual([]);
    }
  });

  it("extractJsonCandidate returns undefined when no JSON is present", () => {
    expect(extractJsonCandidate("no json here at all")).toBeUndefined();
  });
});

describe("generateBrief (stubbed driver — never the live LLM)", () => {
  function makeRuntime() {
    const store = buildFixtureStore();
    return createConstellationRuntime({ store });
  }

  it("returns a structured brief and hands the full task + runtime to the driver", async () => {
    const runtime = makeRuntime();
    let seenTask = "";
    let seenRuntime: unknown;
    const brief = await generateBrief(runtime, {
      nowIso: NOW,
      driver: async ({ task, runtime: rt }) => {
        seenTask = task;
        seenRuntime = rt;
        return `analysis...\n\`\`\`json\n${JSON.stringify(VALID_BRIEF)}\n\`\`\``;
      },
    });
    expect(seenRuntime).toBe(runtime);
    expect(seenTask).toContain("please review the Apollo deck");
    expect(brief.headline).toBe(VALID_BRIEF.headline);
    expect(brief.generatedAt).toBe(NOW);
    expect(brief.insights).toHaveLength(1);
    expect(brief.insights[0]?.signalIds).toEqual(["s5", "s6"]);
    expect(brief.insights[0]?.body).toContain("same instant");
    expect(brief.stats).toMatchObject({ signals: 8, links: 4, orphans: 2, calendarCollisions: 1 });
    expect(brief.warnings).toEqual([]);
    expect(brief.fallbackMarkdown).toBeUndefined();
  });

  it("enforces citation integrity: unknown ids dropped, uncited insights discarded", async () => {
    const runtime = makeRuntime();
    const reply = {
      headline: "h",
      insights: [
        { title: "real", category: "anomaly", urgency: "now", observation: "o", signalIds: ["s1", "sig_999"] },
        { title: "vibe", category: "anomaly", urgency: "now", observation: "o", signalIds: ["sig_404"] },
      ],
    };
    const brief = await generateBrief(runtime, {
      nowIso: NOW,
      driver: async () => `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``,
    });
    expect(brief.insights).toHaveLength(1);
    expect(brief.insights[0]?.signalIds).toEqual(["s1"]);
    expect(brief.warnings.some((w) => w.includes("sig_999"))).toBe(true);
    expect(brief.warnings.some((w) => w.includes('"vibe"'))).toBe(true);
  });

  it("sorts insights by urgency rank regardless of model ordering", async () => {
    const runtime = makeRuntime();
    const reply = {
      headline: "h",
      insights: [
        { title: "later", category: "trend", urgency: "monitor", observation: "o", signalIds: ["s1"] },
        { title: "first", category: "act_now", urgency: "now", observation: "o", signalIds: ["s2"] },
      ],
    };
    const brief = await generateBrief(runtime, {
      nowIso: NOW,
      driver: async () => `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``,
    });
    expect(brief.insights.map((i) => i.title)).toEqual(["first", "later"]);
  });

  it("degrades to a markdown fallback when the model returns garbage", async () => {
    const runtime = makeRuntime();
    const brief = await generateBrief(runtime, {
      nowIso: NOW,
      driver: async () => "I could not produce JSON, sorry.",
    });
    expect(brief.insights).toEqual([]);
    expect(brief.fallbackMarkdown).toBe("I could not produce JSON, sorry.");
    expect(brief.warnings.length).toBeGreaterThan(0);
  });

  it("propagates typed driver errors untouched (CLI fail-path contract)", async () => {
    const runtime = makeRuntime();
    await expect(
      generateBrief(runtime, {
        nowIso: NOW,
        driver: async () => {
          throw new SourceUnavailableError("no gateway configured", {});
        },
      }),
    ).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});
