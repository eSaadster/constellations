import { isRetryable, SourceRateLimitError } from "./errors.js";

export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. */
  maxDelayMs?: number;
  /** Jitter factor in [0,1]; 0.5 means +/-50% randomization. */
  jitter?: number;
  /** Predicate deciding whether a given error is retryable. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry sleep (useful for tracing/metrics). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable sleep + random for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const DEFAULT_RETRY: Required<
  Pick<RetryOptions, "maxAttempts" | "baseDelayMs" | "maxDelayMs" | "jitter">
> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
  jitter: 0.5,
};

/**
 * Compute the backoff delay for a given (zero-based) retry index with
 * exponential growth + jitter. Exposed for unit testing.
 */
export function computeBackoffDelay(
  retryIndex: number,
  opts: { baseDelayMs: number; maxDelayMs: number; jitter: number },
  random: () => number = Math.random,
): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** retryIndex);
  const jitterRange = exp * opts.jitter;
  // Symmetric jitter around the exponential value, clamped to >= 0.
  const delta = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exp + delta));
}

/**
 * Retry an async operation with exponential backoff + jitter. By default only
 * retries `ConstellationError`s flagged `retryable` (rate-limit / unavailable).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY, ...options };
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const shouldRetry = options.shouldRetry ?? ((err: unknown) => isRetryable(err));

  let lastError: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt >= cfg.maxAttempts;
      if (isLast || !shouldRetry(err, attempt)) throw err;

      // Honor server-provided Retry-After when available.
      const explicit =
        err instanceof SourceRateLimitError && typeof err.retryAfterMs === "number"
          ? err.retryAfterMs
          : undefined;
      const delayMs = explicit ?? computeBackoffDelay(attempt - 1, cfg, random);

      options.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
