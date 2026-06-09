/**
 * Token-bucket rate limiter for wrapping external (connector / provider) calls.
 *
 * One limiter instance is created per `rateLimitKey` (e.g. per connector or per
 * embedding/search provider). `RateLimiterRegistry` lazily provisions limiters
 * by key so the resilience layer can rate-limit any boundary uniformly.
 */

export interface RateLimiterOptions {
  /** Sustained rate: tokens added per second. */
  ratePerSec: number;
  /** Maximum burst capacity. */
  burst: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly ratePerSec: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions) {
    this.ratePerSec = opts.ratePerSec;
    this.burst = opts.burst;
    this.tokens = opts.burst;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = t;
  }

  /** Non-blocking attempt to consume a token. */
  tryAcquire(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Block until `cost` tokens are available, then consume them. */
  async acquire(cost = 1): Promise<void> {
    // Guard against impossible requests.
    if (cost > this.burst) {
      throw new Error(`rate limiter cost ${cost} exceeds burst capacity ${this.burst}`);
    }
    for (;;) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil((deficit / this.ratePerSec) * 1000);
      await this.sleep(Math.max(1, waitMs));
    }
  }

  /** Run `fn` after acquiring a token. */
  async run<T>(fn: () => Promise<T>, cost = 1): Promise<T> {
    await this.acquire(cost);
    return fn();
  }
}

export class RateLimiterRegistry {
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(
    private readonly defaults: RateLimiterOptions = { ratePerSec: 10, burst: 20 },
    private readonly perKey: Record<string, RateLimiterOptions> = {},
  ) {}

  for(key: string): RateLimiter {
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter(this.perKey[key] ?? this.defaults);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  async run<T>(key: string, fn: () => Promise<T>, cost = 1): Promise<T> {
    return this.for(key).run(fn, cost);
  }
}
