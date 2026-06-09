import type { Signal } from "../artifacts/Signal.js";

/**
 * Redaction — strips obvious sensitive tokens from text before it is logged or
 * sent to an external surface. This is a conservative regex pass, not a
 * guarantee; the point is to keep raw secrets/PII out of traces and out of any
 * message Constellation might post back to a user-facing channel.
 */

const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "[EMAIL]", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { label: "[PHONE]", re: /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b/g },
  // Common secret/token shapes (Slack, generic bearer, AWS-ish).
  { label: "[TOKEN]", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "[TOKEN]", re: /\b(?:sk|pk|ghp|gho|AKIA)[-_][A-Za-z0-9]{16,}\b/g },
  { label: "[TOKEN]", re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g },
];

export function redactText(input: string): string {
  let out = input;
  for (const { label, re } of PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

/**
 * Returns a redacted copy of a Signal. The full text reference is preserved
 * (it points to storage, not inline content) but the excerpt and extracted
 * people are masked. The original is never mutated.
 */
export function redactSignal(signal: Signal): Signal {
  return {
    ...signal,
    title: signal.title ? redactText(signal.title) : signal.title,
    excerpt: redactText(signal.excerpt),
    extracted: {
      ...signal.extracted,
      people: signal.extracted.people.map(redactText),
    },
  };
}

export function containsSensitive(input: string): boolean {
  return PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(input);
  });
}
