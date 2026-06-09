import { z } from "zod";
import type { ConstellationRuntime } from "./runtime.js";
import type { GraphStore } from "../graph/store.js";
import type { Signal } from "../artifacts/Signal.js";
import type { DotLink } from "../artifacts/DotLink.js";
import { evidenceIsCorroborated } from "../artifacts/DotLink.js";
import { runModelDriven } from "./piModelDriver.js";
import { systemClock } from "../util/ids.js";

/**
 * Daily brief — the "what should I know right now" surface over the graph.
 *
 * Design: everything an LLM is bad at (date arithmetic, degree counting,
 * collision grouping, recurrence detection) is computed deterministically here
 * and injected into the prompt as ground truth. The model's only degree of
 * freedom is judgment: which precomputed anomalies matter, and why. The product
 * law — "a connection is not a vibe; it is an evidence-backed claim" — is
 * enforced mechanically: the output schema requires signal-id citations and
 * `generateBrief` drops any citation that does not exist in the store.
 *
 * Pure, unit-testable pieces: `computeBriefAnalytics`, `buildGraphDump`,
 * `buildBriefTask`, `extractJsonCandidate`, `parseBriefResponse`. The only
 * effectful piece is `generateBrief`, whose model driver is injectable so tests
 * never touch the live LLM.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The owner's working timezone offset (Asia/Karachi). Overridable per call. */
export const DEFAULT_TZ_OFFSET_HOURS = 5;

const ACTIVE_STATUSES: ReadonlySet<DotLink["status"]> = new Set(["confirmed", "proposed"]);

function epochOf(iso: string): number | undefined {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function histogram(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/**
 * Matches explicit late-night time mentions (12 AM–5:59 AM) in free text. The
 * lookbehind stops the minutes of a daytime time from matching ("10:01 AM"
 * must not be read as "01 AM").
 */
const LATE_HOUR_RE = /(?<![\d:.])\b(12|0?[1-5])(?::[0-5]\d)?\s*a\.?m\.?\b/gi;

/** Strip a calendar recurrence suffix (e.g. `_20260512T150000Z`) to a series stem. */
const RECURRENCE_SUFFIX_RE = /_\d{8}(?:T\d{4,6}Z?)?$/i;

/** Raw, unresolved Slack-style actor ids — an identity-resolution gap. */
const RAW_ACTOR_ID_RE = /^U[A-Z0-9]{8,}$/;

export interface BriefAnalytics {
  generatedAt: string;
  tzOffsetHours: number;
  counts: { signals: number; links: number; constellations: number };
  bySource: Record<string, number>;
  recency: {
    newest?: string;
    oldest?: string;
    last7Days: number;
    largestGaps: Array<{ fromSignalId: string; toSignalId: string; gapDays: number }>;
  };
  orphans: Array<{ id: string; source: string; title?: string; timestamp: string }>;
  hubs: Array<{ id: string; title?: string; degree: number }>;
  actors: Array<{
    actor: string;
    signalCount: number;
    sources: string[];
    firstSeen: string;
    lastSeen: string;
    daysSinceLastSeen: number;
  }>;
  actorDomains: Array<{ domain: string; signalCount: number; lastSeen: string; daysSinceLastSeen: number }>;
  linkStats: {
    byStatus: Record<string, number>;
    byRelation: Record<string, number>;
    meanConfidence: number;
    corroboratedRatio: number;
    crossSourceCount: number;
  };
  topLinks: Array<{
    id: string;
    relation: string;
    status: string;
    confidence: number;
    sourceSignalId: string;
    targetSignalId: string;
    sourceTitle?: string;
    targetTitle?: string;
    rationale: string;
  }>;
  reviewQueue: {
    proposed: number;
    quarantined: number;
    topProposed: Array<{
      id: string;
      sourceSignalId: string;
      targetSignalId: string;
      confidence: number;
      rationale: string;
    }>;
  };
  offHours: Array<{ id: string; localHour: number; localTime: string; flags: string[] }>;
  calendarCollisions: Array<{ timestamp: string; signalIds: string[]; titles: string[] }>;
  sharedArtifactPairs: Array<{ linkId: string; signalIds: [string, string]; titles: string[]; artifacts: string[] }>;
  recurringSeries: Array<{
    stem: string;
    title?: string;
    occurrences: number;
    lastSeen: string;
    daysSinceLast: number;
    signalIds: string[];
  }>;
  clusters: Array<{
    id: string;
    name: string;
    signalCount: number;
    linkCount: number;
    confidence: number;
    lastActivityAt: string;
    staleDays: number;
    cohesion: number;
    quarantinedShare: number;
    sources: string[];
    openQuestions: number;
    asks: number;
    decisions: number;
  }>;
  hygiene: {
    emptyExtractionCount: number;
    emptyExtractionRatio: number;
    suspectedFixtures: Array<{ id: string; reason: string }>;
    noiseCandidates: Array<{ id: string; reason: string }>;
    unresolvedActorIds: string[];
  };
}

export interface BriefAnalyticsOptions {
  nowIso?: string;
  tzOffsetHours?: number;
}

/**
 * Deterministic analytics over the graph. Pure reads — no LLM, no store
 * mutation. `nowIso` is injectable so tests are reproducible.
 */
export function computeBriefAnalytics(store: GraphStore, opts: BriefAnalyticsOptions = {}): BriefAnalytics {
  const nowIso = opts.nowIso ?? systemClock();
  const tz = opts.tzOffsetHours ?? DEFAULT_TZ_OFFSET_HOURS;
  const nowMs = epochOf(nowIso) ?? Date.now();

  const signals = store.listSignals();
  const links = store.listLinks();
  const constellations = store.listConstellations();

  const signalById = new Map(signals.map((s) => [s.id, s]));
  const daysAgo = (iso: string): number => {
    const t = epochOf(iso);
    return t === undefined ? 0 : Math.max(0, Math.floor((nowMs - t) / DAY_MS));
  };

  // --- degree over confirmed+proposed links (rejected/quarantined never rescue a signal) ---
  const degree = new Map<string, number>();
  for (const l of links) {
    if (!ACTIVE_STATUSES.has(l.status)) continue;
    degree.set(l.sourceSignalId, (degree.get(l.sourceSignalId) ?? 0) + 1);
    degree.set(l.targetSignalId, (degree.get(l.targetSignalId) ?? 0) + 1);
  }

  const orphans = signals
    .filter((s) => (degree.get(s.id) ?? 0) === 0)
    .map((s) => ({ id: s.id, source: s.source, title: s.title, timestamp: s.timestamp }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const hubs = signals
    .map((s) => ({ id: s.id, title: s.title, degree: degree.get(s.id) ?? 0 }))
    .filter((h) => h.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, 5);

  // --- actors: actorIds ∪ extracted.people, counted once per signal ---
  interface ActorAcc {
    signalCount: number;
    sources: Set<string>;
    firstSeen: string;
    lastSeen: string;
  }
  const actorAcc = new Map<string, ActorAcc>();
  for (const s of signals) {
    const names = new Set<string>([...s.actorIds, ...s.extracted.people]);
    for (const name of names) {
      const prev = actorAcc.get(name);
      if (!prev) {
        actorAcc.set(name, { signalCount: 1, sources: new Set([s.source]), firstSeen: s.timestamp, lastSeen: s.timestamp });
      } else {
        prev.signalCount += 1;
        prev.sources.add(s.source);
        if ((epochOf(s.timestamp) ?? 0) < (epochOf(prev.firstSeen) ?? 0)) prev.firstSeen = s.timestamp;
        if ((epochOf(s.timestamp) ?? 0) > (epochOf(prev.lastSeen) ?? 0)) prev.lastSeen = s.timestamp;
      }
    }
  }
  const actors = [...actorAcc.entries()]
    .map(([actor, a]) => ({
      actor,
      signalCount: a.signalCount,
      sources: [...a.sources].sort(),
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      daysSinceLastSeen: daysAgo(a.lastSeen),
    }))
    .sort((a, b) => b.signalCount - a.signalCount || a.actor.localeCompare(b.actor))
    .slice(0, 12);

  const domainAcc = new Map<string, { signalIds: Set<string>; lastSeen: string }>();
  for (const s of signals) {
    for (const actor of new Set([...s.actorIds, ...s.extracted.people])) {
      const at = actor.lastIndexOf("@");
      if (at <= 0 || at === actor.length - 1) continue;
      // Strip mailto-wrapper debris ("<...|x@y.com>" -> "y.com").
      const domain = actor
        .slice(at + 1)
        .toLowerCase()
        .replace(/[^a-z0-9.-]+$/g, "");
      if (domain.length === 0) continue;
      const prev = domainAcc.get(domain);
      if (!prev) {
        domainAcc.set(domain, { signalIds: new Set([s.id]), lastSeen: s.timestamp });
      } else {
        prev.signalIds.add(s.id);
        if ((epochOf(s.timestamp) ?? 0) > (epochOf(prev.lastSeen) ?? 0)) prev.lastSeen = s.timestamp;
      }
    }
  }
  const actorDomains = [...domainAcc.entries()]
    .map(([domain, d]) => ({
      domain,
      signalCount: d.signalIds.size,
      lastSeen: d.lastSeen,
      daysSinceLastSeen: daysAgo(d.lastSeen),
    }))
    .sort((a, b) => b.signalCount - a.signalCount || a.domain.localeCompare(b.domain));

  // --- link stats ---
  const crossSourceCount = links.filter((l) => {
    if (!ACTIVE_STATUSES.has(l.status)) return false;
    const a = signalById.get(l.sourceSignalId);
    const b = signalById.get(l.targetSignalId);
    return a !== undefined && b !== undefined && a.source !== b.source;
  }).length;

  const linkStats = {
    byStatus: histogram(links.map((l) => l.status)),
    byRelation: histogram(links.map((l) => l.relation)),
    meanConfidence: links.length === 0 ? 0 : round3(links.reduce((acc, l) => acc + l.confidence, 0) / links.length),
    corroboratedRatio:
      links.length === 0 ? 0 : round3(links.filter((l) => evidenceIsCorroborated(l.evidence)).length / links.length),
    crossSourceCount,
  };

  const topLinks = [...links]
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      relation: l.relation,
      status: l.status,
      confidence: l.confidence,
      sourceSignalId: l.sourceSignalId,
      targetSignalId: l.targetSignalId,
      sourceTitle: signalById.get(l.sourceSignalId)?.title,
      targetTitle: signalById.get(l.targetSignalId)?.title,
      rationale: l.evidence.rationale,
    }));

  const proposed = links.filter((l) => l.status === "proposed");
  const reviewQueue = {
    proposed: proposed.length,
    quarantined: links.filter((l) => l.status === "quarantined").length,
    topProposed: [...proposed]
      .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        sourceSignalId: l.sourceSignalId,
        targetSignalId: l.targetSignalId,
        confidence: l.confidence,
        rationale: l.evidence.rationale,
      })),
  };

  // --- off-hours: event time 22:00–06:00 local, or explicit 12–5 AM mentions in text ---
  const offHours: BriefAnalytics["offHours"] = [];
  for (const s of signals) {
    const t = epochOf(s.timestamp);
    if (t === undefined) continue;
    const local = new Date(t + tz * HOUR_MS);
    const localHour = local.getUTCHours();
    const localTime = local.toISOString().slice(0, 16).replace("T", " ");
    const flags: string[] = [];
    if (localHour >= 22 || localHour < 6) flags.push(`event/message at ${localTime} local`);
    const text = `${s.title ?? ""} ${s.excerpt}`;
    const mentions = [...text.matchAll(LATE_HOUR_RE)].map((m) => m[0]);
    if (mentions.length > 0) flags.push(`text mentions late hours: ${[...new Set(mentions)].join(", ")}`);
    if (flags.length > 0) offHours.push({ id: s.id, localHour, localTime, flags });
  }
  offHours.sort((a, b) => a.id.localeCompare(b.id));

  // --- calendar collisions: same start instant ---
  const byInstant = new Map<number, Signal[]>();
  for (const s of signals) {
    if (s.source !== "calendar") continue;
    const t = epochOf(s.timestamp);
    if (t === undefined) continue;
    const group = byInstant.get(t);
    if (group) group.push(s);
    else byInstant.set(t, [s]);
  }
  const calendarCollisions = [...byInstant.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => {
      const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
      const first = sorted[0];
      return {
        timestamp: first?.timestamp ?? "",
        signalIds: sorted.map((s) => s.id),
        titles: sorted.map((s) => s.title ?? s.excerpt.slice(0, 60)),
      };
    });

  // --- duplicate-event fingerprint: links carrying a shared artifact (e.g. one meeting URL on two invites) ---
  const sharedArtifactPairs = links
    .filter((l) => ACTIVE_STATUSES.has(l.status) && (l.evidence.artifactOverlap?.length ?? 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) => ({
      linkId: l.id,
      signalIds: [l.sourceSignalId, l.targetSignalId] as [string, string],
      titles: [l.sourceSignalId, l.targetSignalId]
        .map((id) => signalById.get(id))
        .filter((s): s is Signal => s !== undefined)
        .map((s) => s.title ?? s.excerpt.slice(0, 60)),
      artifacts: l.evidence.artifactOverlap ?? [],
    }));

  // --- recurring calendar series and how long since they last fired ---
  const seriesAcc = new Map<string, Signal[]>();
  for (const s of signals) {
    if (s.source !== "calendar") continue;
    const stem = s.externalId.replace(RECURRENCE_SUFFIX_RE, "");
    const group = seriesAcc.get(stem);
    if (group) group.push(s);
    else seriesAcc.set(stem, [s]);
  }
  const recurringSeries = [...seriesAcc.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([stem, group]) => {
      const sorted = [...group].sort((a, b) => (epochOf(a.timestamp) ?? 0) - (epochOf(b.timestamp) ?? 0));
      const last = sorted[sorted.length - 1];
      return {
        stem,
        title: last?.title,
        occurrences: sorted.length,
        lastSeen: last?.timestamp ?? "",
        daysSinceLast: last ? daysAgo(last.timestamp) : 0,
        signalIds: sorted.map((s) => s.id),
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.stem.localeCompare(b.stem));

  // --- recency + the largest silences in the timeline ---
  const timeline = signals
    .map((s) => ({ s, t: epochOf(s.timestamp) }))
    .filter((x): x is { s: Signal; t: number } => x.t !== undefined)
    .sort((a, b) => a.t - b.t);
  const newest = timeline[timeline.length - 1];
  const oldest = timeline[0];
  const gaps: Array<{ fromSignalId: string; toSignalId: string; gapDays: number }> = [];
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const cur = timeline[i];
    if (!prev || !cur) continue;
    const gapDays = round3((cur.t - prev.t) / DAY_MS);
    if (gapDays > 3) gaps.push({ fromSignalId: prev.s.id, toSignalId: cur.s.id, gapDays });
  }
  const recency = {
    newest: newest?.s.timestamp,
    oldest: oldest?.s.timestamp,
    last7Days: timeline.filter((x) => x.t >= nowMs - 7 * DAY_MS).length,
    largestGaps: gaps.sort((a, b) => b.gapDays - a.gapDays).slice(0, 3),
  };

  // --- cluster health: cohesion = confirmed share of member links ---
  const clusters = constellations
    .map((c) => {
      const memberLinks = c.linkIds
        .map((id) => store.getLink(id))
        .filter((l): l is DotLink => l !== undefined);
      const confirmed = memberLinks.filter((l) => l.status === "confirmed").length;
      const quarantined = memberLinks.filter((l) => l.status === "quarantined").length;
      const sources = [
        ...new Set(
          c.signalIds
            .map((id) => signalById.get(id))
            .filter((s): s is Signal => s !== undefined)
            .map((s) => s.source),
        ),
      ].sort();
      return {
        id: c.id,
        name: c.name,
        signalCount: c.signalIds.length,
        linkCount: c.linkIds.length,
        confidence: c.confidence,
        lastActivityAt: c.lastActivityAt,
        staleDays: daysAgo(c.lastActivityAt),
        cohesion: memberLinks.length === 0 ? 0 : round3(confirmed / memberLinks.length),
        quarantinedShare: memberLinks.length === 0 ? 0 : round3(quarantined / memberLinks.length),
        sources,
        openQuestions: c.openQuestions.length,
        asks: c.asks.length,
        decisions: c.decisions.length,
      };
    })
    .sort((a, b) => b.signalCount - a.signalCount || a.id.localeCompare(b.id));

  // --- hygiene: does the memory itself deserve trust? ---
  const emptyExtraction = signals.filter((s) =>
    Object.values(s.extracted).every((arr) => Array.isArray(arr) && arr.length === 0),
  );
  const suspectedFixtures: Array<{ id: string; reason: string }> = [];
  const noiseCandidates: Array<{ id: string; reason: string }> = [];
  for (const s of signals) {
    const haystack = `${s.url ?? ""} ${s.externalId}`;
    if (haystack.includes("example.")) {
      suspectedFixtures.push({ id: s.id, reason: "url/externalId points at an example.* domain (test fixture?)" });
    }
    const text = `${s.title ?? ""} ${s.excerpt}`;
    if (/\b(confirmation|verification) code\b/i.test(text) || /\bno-?reply\b/i.test(text)) {
      noiseCandidates.push({ id: s.id, reason: "transactional/automated content (codes, no-reply)" });
    } else if (/^\s*<?!?@?(channel|here)>?\s*$/i.test(s.excerpt)) {
      noiseCandidates.push({ id: s.id, reason: "bare @channel/@here ping with no content" });
    }
  }
  const unresolvedActorIds = [
    ...new Set(signals.flatMap((s) => s.actorIds).filter((a) => RAW_ACTOR_ID_RE.test(a))),
  ].sort();

  return {
    generatedAt: nowIso,
    tzOffsetHours: tz,
    counts: { signals: signals.length, links: links.length, constellations: constellations.length },
    bySource: histogram(signals.map((s) => s.source)),
    recency,
    orphans,
    hubs,
    actors,
    actorDomains,
    linkStats,
    topLinks,
    reviewQueue,
    offHours,
    calendarCollisions,
    sharedArtifactPairs,
    recurringSeries,
    clusters,
    hygiene: {
      emptyExtractionCount: emptyExtraction.length,
      emptyExtractionRatio: signals.length === 0 ? 0 : round3(emptyExtraction.length / signals.length),
      suspectedFixtures,
      noiseCandidates,
      unresolvedActorIds,
    },
  };
}

// ---------------------------------------------------------------------------
// Graph dump — the citation substrate inlined into the prompt.
// ---------------------------------------------------------------------------

export interface GraphDump {
  signals: Array<{
    id: string;
    source: string;
    timestamp: string;
    title?: string;
    actorIds: string[];
    excerpt: string;
    people?: string[];
    projects?: string[];
    asks?: string[];
    decisions?: string[];
  }>;
  links: Array<{
    id: string;
    pair: string;
    relation: string;
    status: string;
    confidence: number;
    rationale: string;
    sharedPeople?: string[];
    artifacts?: string[];
  }>;
  constellations: Array<{
    id: string;
    name: string;
    summary: string;
    signalIds: string[];
    openQuestions?: string[];
    asks?: string[];
    decisions?: string[];
    lastActivityAt: string;
    confidence: number;
  }>;
  /** Links beyond the prompt budget that were left out (0 = full coverage).
   * Stated explicitly so the model never assumes it saw every edge. */
  linksOmitted: number;
}

const EXCERPT_LIMIT = 200;
const RATIONALE_LIMIT = 140;

/**
 * Hard cap on inlined links. A dense graph (hundreds of signals) can carry
 * thousands of edges whose rationales alone exceed the model's context window
 * — observed live: 2.6k links produced a ~250k-token prompt and an empty
 * model reply. Links are prioritized by status (confirmed first) then
 * confidence, and the omitted count is surfaced in the dump.
 */
const LINK_LIMIT = 300;

const STATUS_RANK: Record<string, number> = { confirmed: 0, proposed: 1, quarantined: 2, rejected: 3 };

function truncate(text: string, limit = EXCERPT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Compact dump of the graph for prompt inlining, bounded for context. Pure read. */
export function buildGraphDump(store: GraphStore): GraphDump {
  const signals = [...store.listSignals()]
    .sort((a, b) => (epochOf(a.timestamp) ?? 0) - (epochOf(b.timestamp) ?? 0) || a.id.localeCompare(b.id))
    .map((s) => ({
      id: s.id,
      source: s.source,
      timestamp: s.timestamp,
      ...(s.title !== undefined ? { title: s.title } : {}),
      actorIds: s.actorIds,
      excerpt: truncate(s.excerpt),
      ...(s.extracted.people.length > 0 ? { people: s.extracted.people } : {}),
      ...(s.extracted.projects.length > 0 ? { projects: s.extracted.projects } : {}),
      ...(s.extracted.asks.length > 0 ? { asks: s.extracted.asks } : {}),
      ...(s.extracted.decisions.length > 0 ? { decisions: s.extracted.decisions } : {}),
    }));

  const allLinks = [...store.listLinks()].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id),
  );
  const linksOmitted = Math.max(0, allLinks.length - LINK_LIMIT);
  const links = allLinks.slice(0, LINK_LIMIT).map((l) => ({
    id: l.id,
    pair: `${l.sourceSignalId} -> ${l.targetSignalId}`,
    relation: l.relation,
    status: l.status,
    confidence: l.confidence,
    rationale: truncate(l.evidence.rationale, RATIONALE_LIMIT),
    ...(l.evidence.sharedPeople.length > 0 ? { sharedPeople: l.evidence.sharedPeople } : {}),
    ...((l.evidence.artifactOverlap?.length ?? 0) > 0 ? { artifacts: l.evidence.artifactOverlap } : {}),
  }));

  const constellations = [...store.listConstellations()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      summary: truncate(c.summary, 300),
      signalIds: c.signalIds,
      ...(c.openQuestions.length > 0 ? { openQuestions: c.openQuestions } : {}),
      ...(c.asks.length > 0 ? { asks: c.asks } : {}),
      ...(c.decisions.length > 0 ? { decisions: c.decisions } : {}),
      lastActivityAt: c.lastActivityAt,
      confidence: c.confidence,
    }));

  return { signals, links, constellations, linksOmitted };
}

// ---------------------------------------------------------------------------
// Model output schema — citations are the contract, not a nicety.
// ---------------------------------------------------------------------------

export const INSIGHT_CATEGORIES = [
  "act_now",
  "open_loop",
  "people_radar",
  "schedule_hygiene",
  "anomaly",
  "trend",
  "cross_source_gap",
  "coordination_friction",
  "hygiene",
  "second_order",
] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export const INSIGHT_URGENCIES = ["now", "today", "this_week", "monitor"] as const;
export type InsightUrgency = (typeof INSIGHT_URGENCIES)[number];

const ModelInsightSchema = z.object({
  title: z.string().min(1),
  category: z.enum(INSIGHT_CATEGORIES).catch("anomaly"),
  urgency: z.enum(INSIGHT_URGENCIES).catch("monitor"),
  observation: z.string().min(1),
  interpretation: z.string().catch(""),
  suggestedAction: z.string().catch(""),
  signalIds: z.array(z.string()).min(1),
  linkIds: z.array(z.string()).catch([]),
  constellationIds: z.array(z.string()).catch([]),
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
});
export type ModelInsight = z.infer<typeof ModelInsightSchema>;

export const ModelBriefSchema = z.object({
  headline: z.string().min(1),
  insights: z.array(ModelInsightSchema).min(1),
  radar: z.array(z.string()).catch([]),
  omitted: z.string().catch(""),
});
export type ModelBrief = z.infer<typeof ModelBriefSchema>;

// ---------------------------------------------------------------------------
// Prompt builder.
// ---------------------------------------------------------------------------

const FENCE = "```";

/** Build the single task string handed to the model. Pure. */
export function buildBriefTask(analytics: BriefAnalytics, dump: GraphDump): string {
  return `You are the daily-brief analyst for Constellation — part chief of staff, part pattern analyst — writing for the graph owner.

Current time: ${analytics.generatedAt} (owner's local timezone is UTC+${analytics.tzOffsetHours}; every localHour/localTime below is already converted — trust them).

PRODUCT LAW — non-negotiable: "A connection is not a vibe; it is an evidence-backed claim." Every insight and radar entry MUST cite at least one signal id that appears in FULL GRAPH below. Uncited claims and invented ids are discarded by a validator.

The ENTIRE graph is inlined below — every signal, link, and constellation. Do NOT call any tools to read the graph; everything you need is here. Produce your final answer directly.

==== GROUND TRUTH ANALYTICS (computed deterministically in code — trust these numbers; do NOT recount, re-date, or contradict them) ====
${FENCE}json
${JSON.stringify(analytics, null, 2)}
${FENCE}

Reading guide for the analytics:
- orphans: signals with zero confirmed/proposed links — they arrived and connected to nothing. For each one worth mentioning, force a decision: strategic signal or dead noise — pick one.
- offHours: events/messages between 22:00 and 06:00 local, or text mentioning 12–5 AM times. Repeated off-hours involving the same person or series is a pattern, not an incident.
- calendarCollisions: events sharing the same start instant. A collision repeating across days is standing structural friction — say how many times and on which dates.
- sharedArtifactPairs: two events carrying the same artifact (e.g. one meeting link on two invites) — the signature of a duplicate invite, which usually means someone lacked permission to edit the original. Label that read as inference.
- recurringSeries: recurring meetings and daysSinceLast — a ritual that silently stopped is a classic dropped ball.
- clusters[].cohesion: share of confirmed links. A cluster glued together by quarantined/proposed links is NOT a coherent workstream; never narrate it as one — the low cohesion is itself the finding.
- recency.largestGaps: the longest silences in the timeline. A gap can mean dormancy OR an ingestion blind spot — say which reading the evidence favors.
- actors/actorDomains: who keeps appearing, who went quiet (daysSinceLastSeen), which external domains are cooling off.
- hygiene: fixture/noise contamination and unresolved raw actor ids. These weaken the memory itself.

==== FULL GRAPH ====
All signals are inlined. Links are inlined up to a prompt budget, highest-evidence first (confirmed before proposed before quarantined, then by confidence); \`linksOmitted\` says how many lower-evidence links were left out — treat link coverage as partial when it is > 0.
${FENCE}json
${JSON.stringify(dump, null, 2)}
${FENCE}

==== YOUR JOB ====
Write the brief a great chief of staff would slide across the desk: short, specific, slightly opinionated, zero filler. Work through these lenses and report only where the data actually supports a finding:
1. ACT NOW — time-sensitive or already overdue.
2. DROPPED BALLS & OPEN LOOPS — requests nobody answered, decisions nobody made, recurring rituals that silently stopped.
3. PEOPLE DYNAMICS — who keeps showing up, who went quiet, external counterparties cooling off, coordination friction between named people.
4. SCHEDULE HYGIENE — collisions, duplicate invites, off-hours patterns worth a quiet check-in.
5. STRUCTURE & ANOMALIES — orphans, hubs, low-cohesion clusters, cross-source gaps (a meeting with no follow-up thread; an email that never became a calendar slot).
6. SECOND-ORDER READS — what the data implies but does not say. Always label these as inference and ground them in cited signals.
7. GRAPH HYGIENE — contamination flagged under hygiene; at most ONE brief insight, never crowding out real work.

HARD RULES — violating any gets the output rejected:
R1. Every insight cites >= 1 signal id present in FULL GRAPH via signalIds. Cite link/constellation ids too when they carry the evidence. NEVER invent ids, people, meetings, or dates.
R2. observation and interpretation are DIFFERENT claims: observation = what the data shows (verifiable; with dates, names, counts); interpretation = what it means (your analytical read, labeled as inference when it is one).
R3. Name names and quantify. "Haris booked the duplicate huddle" beats "a colleague scheduled a meeting"; "27 days since the last Daily Huddle" beats "the huddle hasn't met recently". If an actor is an unresolved raw id, say so explicitly — that is itself information.
R4. suggestedAction is ONE concrete imperative doable in <= 15 minutes or delegable in one message, with a named target where possible ("Ask Haris which of the two 8 PM slots is real and kill the other").
R5. ACTIONABILITY TEST: would the owner do something differently in the next 7 days because of this? If no, cut it or demote it to radar.
R6. Urgency budget: at most 2 insights at urgency "now". "now" means today-or-it-costs-something; if everything is urgent, nothing is.
R7. 3 to 8 insights total, sorted now -> today -> this_week -> monitor. Fewer sharp insights beat many soft ones; padding is a failure mode. Park sub-threshold patterns in radar; use omitted to state what you deliberately left out and why.
R8. Signals flagged under hygiene (fixtures, noise) must NOT be presented as work insights — they may appear only inside a single hygiene-category insight.
R9. If most signals have empty extracted fields (see hygiene.emptyExtractionRatio), caveat the conclusions that weakens — clustering then ran on actors and time alone.
R10. BANNED, instant failure: "you have several meetings", "busy schedule", "stay on top of", "it might be worth", "consider reaching out", "no major issues", "overall things look good", "keep an eye on", "don't forget to", "synergy", "leverage" as a verb — and any sentence a generic assistant could write without reading this data. Self-test each insight: delete the citations; if the sentence survives as plausible filler, sharpen it or cut it.

==== OUTPUT CONTRACT ====
End your reply with EXACTLY ONE fenced code block tagged json — it must be the FINAL thing in your reply, with nothing after it — matching this shape exactly:

${FENCE}json
{
  "headline": "one sentence: the single most decision-relevant thing right now, with a name or title in it",
  "insights": [
    {
      "title": "<= 90 chars, specific, names names",
      "category": "act_now | open_loop | people_radar | schedule_hygiene | anomaly | trend | cross_source_gap | coordination_friction | hygiene | second_order",
      "urgency": "now | today | this_week | monitor",
      "observation": "what the data shows — dates, names, counts",
      "interpretation": "what it implies — labeled as inference where it is one",
      "suggestedAction": "one concrete imperative, <= 15 minutes, named target where possible",
      "signalIds": ["..."],
      "linkIds": [],
      "constellationIds": [],
      "confidence": "high | medium | low"
    }
  ],
  "radar": ["2-6 one-line people/watchlist entries, each ending with its citation ids in parentheses"],
  "omitted": "one or two sentences: what you deliberately excluded and why"
}
${FENCE}

Field notes: signalIds is required and non-empty for every insight; confidence is "high" only for claims read directly off the analytics, "low" for second-order inference.`;
}

// ---------------------------------------------------------------------------
// Defensive extraction + parsing of the model's reply.
// ---------------------------------------------------------------------------

/**
 * Pull the most likely JSON payload out of free-form model text. Preference
 * order: last \`\`\`json fence, then last plain fence that opens with `{`, then
 * a bare first-`{` .. last-`}` slice.
 */
export function extractJsonCandidate(text: string): string | undefined {
  const jsonFences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const lastJson = jsonFences[jsonFences.length - 1]?.[1]?.trim();
  if (lastJson) return lastJson;

  const anyFences = [...text.matchAll(/```[\w-]*\s*([\s\S]*?)```/g)];
  for (let i = anyFences.length - 1; i >= 0; i--) {
    const body = anyFences[i]?.[1]?.trim();
    if (body !== undefined && body.startsWith("{")) return body;
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return undefined;
}

export type ParsedBriefResponse =
  | { ok: true; brief: ModelBrief }
  | { ok: false; fallback: { markdown: string } };

/**
 * Parse the model's reply into a validated ModelBrief. Never throws on bad
 * model output — any extraction/JSON/schema failure degrades to a markdown
 * fallback that preserves the raw text.
 */
export function parseBriefResponse(text: string): ParsedBriefResponse {
  const candidate = extractJsonCandidate(text);
  if (candidate !== undefined) {
    try {
      const parsed = ModelBriefSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return { ok: true, brief: parsed.data };
    } catch {
      // malformed JSON — fall through to markdown fallback
    }
  }
  return { ok: false, fallback: { markdown: text.trim() } };
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export interface BriefInsight {
  title: string;
  body: string;
  category: InsightCategory;
  urgency: InsightUrgency;
  signalIds: string[];
  suggestedAction?: string;
}

export interface GeneratedBrief {
  generatedAt: string;
  model: string;
  headline: string;
  insights: BriefInsight[];
  radar: string[];
  stats: {
    signals: number;
    links: number;
    constellations: number;
    orphans: number;
    crossSourceLinks: number;
    proposedAwaitingReview: number;
    offHoursSignals: number;
    calendarCollisions: number;
  };
  omitted?: string;
  /** Citation-integrity and degradation notes produced by the validator. */
  warnings: string[];
  /** Set only when the model's reply failed JSON/schema validation. */
  fallbackMarkdown?: string;
}

export type BriefDriver = (opts: { task: string; runtime: ConstellationRuntime }) => Promise<string>;

export interface GenerateBriefOptions {
  nowIso?: string;
  tzOffsetHours?: number;
  /** Injectable model driver; defaults to the live runModelDriven. Tests stub this. */
  driver?: BriefDriver;
}

const URGENCY_RANK: Record<InsightUrgency, number> = { now: 0, today: 1, this_week: 2, monitor: 3 };

/**
 * Generate the daily brief: deterministic analytics -> prompt -> model ->
 * validated, citation-checked brief. Driver errors (e.g. the typed
 * SourceUnavailableError when no gateway is configured) propagate untouched.
 */
export async function generateBrief(
  runtime: ConstellationRuntime,
  opts: GenerateBriefOptions = {},
): Promise<GeneratedBrief> {
  const nowIso = opts.nowIso ?? systemClock();
  const analyticsOpts: BriefAnalyticsOptions = { nowIso };
  if (opts.tzOffsetHours !== undefined) analyticsOpts.tzOffsetHours = opts.tzOffsetHours;
  const analytics = computeBriefAnalytics(runtime.store, analyticsOpts);
  const dump = buildGraphDump(runtime.store);
  const task = buildBriefTask(analytics, dump);

  const driver = opts.driver ?? runModelDriven;
  const text = await driver({ task, runtime });
  const parsed = parseBriefResponse(text);

  const stats: GeneratedBrief["stats"] = {
    signals: analytics.counts.signals,
    links: analytics.counts.links,
    constellations: analytics.counts.constellations,
    orphans: analytics.orphans.length,
    crossSourceLinks: analytics.linkStats.crossSourceCount,
    proposedAwaitingReview: analytics.reviewQueue.proposed,
    offHoursSignals: analytics.offHours.length,
    calendarCollisions: analytics.calendarCollisions.length,
  };
  const model = process.env.CONSTELLATION_MODEL ?? "glm-5.1";

  if (!parsed.ok) {
    return {
      generatedAt: nowIso,
      model,
      headline: "Brief generation produced unstructured output — see fallbackMarkdown",
      insights: [],
      radar: [],
      stats,
      warnings: ["model reply failed JSON/schema validation; raw text preserved in fallbackMarkdown"],
      fallbackMarkdown: parsed.fallback.markdown,
    };
  }

  // Citation integrity: an insight may only cite ids that exist in the store.
  const knownSignals = new Set(runtime.store.listSignals().map((s) => s.id));
  const warnings: string[] = [];
  const insights: BriefInsight[] = [];
  for (const raw of parsed.brief.insights) {
    const cited = [...new Set(raw.signalIds)];
    const valid = cited.filter((id) => knownSignals.has(id));
    const unknown = cited.filter((id) => !knownSignals.has(id));
    if (unknown.length > 0) {
      warnings.push(`insight "${raw.title}": dropped unknown signal id(s) ${unknown.join(", ")}`);
    }
    if (valid.length === 0) {
      warnings.push(`insight "${raw.title}": discarded — no valid signal citations (a connection is not a vibe)`);
      continue;
    }
    const body = [raw.observation.trim(), raw.interpretation.trim()].filter((p) => p.length > 0).join(" ");
    const insight: BriefInsight = {
      title: raw.title,
      body,
      category: raw.category,
      urgency: raw.urgency,
      signalIds: valid,
    };
    const action = raw.suggestedAction.trim();
    if (action.length > 0) insight.suggestedAction = action;
    insights.push(insight);
  }
  insights.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);

  const result: GeneratedBrief = {
    generatedAt: nowIso,
    model,
    headline: parsed.brief.headline,
    insights,
    radar: parsed.brief.radar,
    stats,
    warnings,
  };
  const omitted = parsed.brief.omitted.trim();
  if (omitted.length > 0) result.omitted = omitted;
  return result;
}
