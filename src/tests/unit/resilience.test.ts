import { describe, expect, it, vi } from "vitest";
import {
  computeBackoffDelay,
  withRetry,
  RateLimiter,
  SourceUnavailableError,
  SignalParseError,
  SourceRateLimitError,
} from "../../resilience/index.js";

describe("computeBackoffDelay", () => {
  it("grows exponentially with no jitter", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 10_000, jitter: 0 };
    expect(computeBackoffDelay(0, opts)).toBe(100);
    expect(computeBackoffDelay(1, opts)).toBe(200);
    expect(computeBackoffDelay(2, opts)).toBe(400);
  });

  it("caps at maxDelayMs", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 1500, jitter: 0 };
    expect(computeBackoffDelay(5, opts)).toBe(1500);
  });

  it("applies symmetric jitter, never negative", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 10_000, jitter: 1 };
    // random()=0 → exp - jitterRange = 0
    expect(computeBackoffDelay(0, opts, () => 0)).toBe(0);
    // random()=1 → exp + jitterRange = 200
    expect(computeBackoffDelay(0, opts, () => 1)).toBe(200);
  });
});

describe("withRetry", () => {
  it("retries retryable errors and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new SourceUnavailableError("flaky");
        return "ok";
      },
      { maxAttempts: 5, sleep: async () => {} },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new SignalParseError("bad");
        },
        { maxAttempts: 5, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(SignalParseError);
    expect(attempts).toBe(1);
  });

  it("honors explicit retryAfterMs from a rate-limit error", async () => {
    const sleep = vi.fn(async () => {});
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new SourceRateLimitError("slow down", {}, 1234);
        return "ok";
      },
      { maxAttempts: 3, sleep },
    );
    expect(sleep).toHaveBeenCalledWith(1234);
  });
});

describe("RateLimiter", () => {
  it("allows up to burst then blocks until refill", async () => {
    let now = 0;
    const limiter = new RateLimiter({ ratePerSec: 10, burst: 2, now: () => now, sleep: async () => {} });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    now = 1000; // +1s → +10 tokens (capped at burst 2)
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("acquire() resolves once tokens refill", async () => {
    let now = 0;
    const limiter = new RateLimiter({
      ratePerSec: 100,
      burst: 1,
      now: () => now,
      sleep: async () => {
        now += 50; // simulate clock advancing during sleep
      },
    });
    await limiter.acquire(); // consumes the 1 token
    await limiter.acquire(); // must wait for refill; sleep advances clock
    expect(true).toBe(true);
  });
});
