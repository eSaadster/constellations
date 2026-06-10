import type { ExtractedFacts, SignalSource } from "../artifacts/Signal.js";

/**
 * Deterministic heuristic extractors — the production replacement for the
 * hint-only mock extraction. No NLP/LLM: regex + casing heuristics tuned
 * against the live graph (real Gmail newsletters, Slack standups, Calendar
 * series). Everything here is conservative-safe for scoring: a junk phrase
 * unique to one signal only DILUTES that signal's jaccard overlaps; it can
 * never fabricate cross-signal agreement, because every downstream dimension
 * requires an EXACT normalized match on both sides.
 *
 * Slack user resolution (`U…` id -> "Real Name <email>") is threaded in as a
 * plain Map so this module stays connector-free: the ComposioConnector and the
 * reextract backfill both fetch the map and pass it down.
 */

/** Map of Slack user id ("U…") -> display string ("Real Name <email>"). */
export type SlackUserMap = ReadonlyMap<string, string>;

// ---------------------------------------------------------------------------
// Text cleanup
// ---------------------------------------------------------------------------

/** Basic HTML entities that leak into Gmail excerpts (&#39;, &amp;, …). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    // Invisible word-joiner/padding runs that newsletters use as preheader
    // filler — they defeat tokenization if left in.
    .replace(/[͏​-‍⁠﻿⠀⠀]+/g, " ");
}

/**
 * Rewrite Slack message markup into plain text:
 *   <@U123> / <@U123|alias>  -> @Name (resolved via `users`, else @U123)
 *   <#C123|general>          -> #general
 *   <https://url|label>      -> https://url
 *   <https://url>            -> https://url
 *   <!here> / <!channel>     -> @here / @channel
 */
export function cleanSlackText(text: string, users?: SlackUserMap): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id: string, alias?: string) => {
      const resolved = users?.get(id);
      // Prefer the bare name (not "Name <email>") for readable running text.
      const name = resolved?.replace(/\s*<[^>]*>\s*$/, "") ?? alias ?? id;
      return `@${name}`;
    })
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<((?:https?|mailto):[^|>]+)\|[^>]*>/gi, "$1")
    .replace(/<((?:https?|mailto):[^>]+)>/gi, "$1")
    .replace(/<!(here|channel|everyone)>/gi, "@$1");
}

/** Raw Slack user ids mentioned in a message body (`<@U…>`). */
export function slackMentionIds(text: string): string[] {
  return uniq([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map((m) => m[1]!));
}

/**
 * Resolve actor ids through the Slack user map: a raw "U…" id becomes
 * "Real Name <email>" when known (so `normalizePersonKey` collapses it to the
 * same email the person has on email/calendar signals — the cross-source
 * people join). Unknown ids pass through unchanged.
 */
export function resolveActorIds(actorIds: string[], users?: SlackUserMap): string[] {
  if (!users || users.size === 0) return actorIds;
  return uniq(actorIds.map((id) => users.get(id) ?? id));
}

function uniq(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** Strip leaked Slack "|label>" tails and trailing punctuation off a URL. The
 * pre-overhaul extractor stored URLs straight out of Slack markup, so this is
 * also applied to EXISTING artifact entries during backfill. */
export function cleanArtifact(url: string): string {
  // Slack HTML-escapes ampersands inside message text; a URL artifact must
  // carry the real query separators or exact-match overlap breaks.
  return url.replace(/&amp;/gi, "&").replace(/\|[^|]*$/, "").replace(/[.,;:!?>]+$/, "");
}

/** URLs referenced in text. Expects Slack markup already cleaned. */
export function extractArtifacts(text: string): string[] {
  const urls = [...text.matchAll(URL_RE)].map((m) => cleanArtifact(m[0]));
  return uniq(urls).slice(0, 10);
}

/**
 * People referenced in text:
 *   - @mentions ("@haris") — guarded so the domain half of an email address
 *     ("raza@phi.consulting") is NOT treated as a mention;
 *   - forwarded-email headers ("From: Raza Rehman <raza@phi.consulting>");
 *   - bare email addresses.
 */
export function extractPeople(text: string): string[] {
  const people: string[] = [];
  for (const m of text.matchAll(/(?<![\w.+-])@([a-z0-9][a-z0-9._-]{1,30})/gi)) {
    people.push(m[1]!);
  }
  for (const m of text.matchAll(/From:\s*([^<\n]{2,60}?)\s*<([^<>\s@]+@[^<>\s]+)>/gi)) {
    people.push(`${m[1]!.trim()} <${m[2]!}>`);
  }
  for (const m of text.matchAll(/(?<![<\w.])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    people.push(m[0]);
  }
  return uniq(people).slice(0, 10);
}

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

const DATE_RES: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO
  new RegExp(String.raw`\b(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b`, "g"),
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:${MONTHS})\b(?:,?\s+\d{4})?`, "g"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // 6/8/2026 (slashed dates need a year to beat fraction noise)
];

/** Explicit calendar dates mentioned in text (kept as written, not normalized). */
export function extractDates(text: string): string[] {
  const found: string[] = [];
  for (const re of DATE_RES) found.push(...[...text.matchAll(re)].map((m) => m[0]));
  return uniq(found).slice(0, 10);
}

/** Sentence splitter shared by asks/decisions: periods, newlines, bullets. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|\s*[•●▪-]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 300);
}

const ASK_RE =
  /\b(?:can|could|would|will)\s+(?:you|we|someone|anyone)\b|\bplease\b|\bneed(?:s)?\s+(?:you|someone|help|to\s+know)\b|\blet me know\b|\bany update\b|\breminder to\b|\baction item\b/i;

/** Requests/questions directed at someone. */
export function extractAsks(text: string): string[] {
  const out = sentences(text).filter((s) => ASK_RE.test(s) || /\?\s*$/.test(s));
  return uniq(out.map((s) => s.slice(0, 160))).slice(0, 5);
}

const DECISION_RE =
  /\b(?:decided|decision(?:\s+made)?|we(?:'|’)?(?:re|ll)?\s+go(?:ing)?\s+with|agreed(?:\s+(?:to|on))?|finali[sz]ed|approved|signed off|locked in|moving forward with|scrapp(?:ed|ing)|cancel(?:l)?ed|no longer (?:doing|using)|switch(?:ed|ing) to)\b/i;

/** Decisions stated in text. */
export function extractDecisions(text: string): string[] {
  const out = sentences(text).filter((s) => DECISION_RE.test(s));
  return uniq(out.map((s) => s.slice(0, 160))).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Entities (proper-noun phrases)
// ---------------------------------------------------------------------------

/** Common words that are capitalized for non-entity reasons. */
const ENTITY_STOP = new Set(
  (
    "the a an and or of for to in on at is are was were be this that with from by " +
    "hi hello hey thanks thank best regards cheers subject date sent forwarded fwd re " +
    "monday tuesday wednesday thursday friday saturday sunday " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec " +
    "today tomorrow yesterday week month year am pm please update updated new now available " +
    "view online email unsubscribe what's whats your our their starting focus work"
  ).split(/\s+/),
);

/** A single capitalized token: "Apollo", "TruckerZoom", "DPB", "Payroll". */
const CAP_TOKEN_RE = /^[A-Z][A-Za-z0-9'’&.-]*$/;
/** Tokens that are confident entities even standing alone at sentence start. */
const STRONG_SINGLE_RE = /^(?:[A-Z]{2,6}\d*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]*\d+[A-Za-z0-9]*)$/;

/**
 * Proper-noun phrase extraction over title + body.
 *
 * Consecutive capitalized tokens form a phrase (max 4 words). Single-word
 * phrases only count when they could not be plain sentence-initial
 * capitalization: either they sit mid-sentence, or their shape is unambiguous
 * (ALLCAPS acronym "DPB", CamelCase "TruckerZoom", letter+digit "Payroll2").
 */
export function extractEntities(title: string | undefined, text: string): string[] {
  const out: string[] = [];
  const source = [title ?? "", text].join("\n");
  for (const line of source.split(/\n+/)) {
    // `/` joins name runs in calendar titles ("Saad/AZ/Haris"); split it too.
    const tokens = line.split(/[\s/|,()[\]{}"“”]+/).filter(Boolean);
    let phrase: string[] = [];
    let phraseStartsSentence = false;
    let atSentenceStart = true;
    const flush = () => {
      if (phrase.length === 0) return;
      const joined = phrase.join(" ");
      const allStop = phrase.every((w) => ENTITY_STOP.has(w.toLowerCase()));
      const singleWeak =
        phrase.length === 1 &&
        (phraseStartsSentence || phrase[0]!.length < 3) &&
        !STRONG_SINGLE_RE.test(phrase[0]!);
      if (!allStop && !singleWeak && joined.length >= 3) out.push(joined);
      phrase = [];
    };
    for (const rawToken of tokens) {
      const token = rawToken.replace(/[.,;:!?]+$/, "");
      const endsSentence = /[.!?]$/.test(rawToken);
      const isCap = CAP_TOKEN_RE.test(token) && !ENTITY_STOP.has(token.toLowerCase());
      if (isCap && phrase.length < 4) {
        if (phrase.length === 0) phraseStartsSentence = atSentenceStart;
        phrase.push(token);
        // A capitalized token can still close a sentence ("…met Bob. Apollo…");
        // the phrase must not bridge the boundary.
        if (endsSentence) flush();
      } else {
        flush();
      }
      atSentenceStart = endsSentence;
    }
    flush();
  }
  return uniq(out).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Per-source orchestration
// ---------------------------------------------------------------------------

export interface ExtractInput {
  source: SignalSource;
  title?: string;
  text: string;
  /** Slack only: U-id -> "Real Name <email>" (mentions + actor resolution). */
  slackUsers?: SlackUserMap;
}

/**
 * Run every heuristic extractor for one signal. Source-aware preprocessing
 * (Slack markup, Gmail entities/preheader padding) happens first so the field
 * extractors all see plain text. `projects` stays empty — there is no reliable
 * project-name heuristic; it remains hint/LLM territory.
 */
export function extractFacts(input: ExtractInput): ExtractedFacts {
  const rawText = [input.title ?? "", input.text].join("\n");
  // Slack ALSO needs entity decoding: the API HTML-escapes &/</> in message
  // text (so does markup cleanup ordering: unwrap <…> first, then decode).
  const text = decodeEntities(
    input.source === "slack" ? cleanSlackText(rawText, input.slackUsers) : rawText,
  );

  const people = extractPeople(text);
  if (input.source === "slack" && input.slackUsers) {
    for (const id of slackMentionIds(rawText)) {
      const resolved = input.slackUsers.get(id);
      if (resolved) people.push(resolved);
    }
  }

  return {
    entities: extractEntities(input.title, text),
    people: uniq(people).slice(0, 10),
    projects: [],
    dates: extractDates(text),
    artifacts: extractArtifacts(text),
    asks: extractAsks(text),
    decisions: extractDecisions(text),
  };
}
