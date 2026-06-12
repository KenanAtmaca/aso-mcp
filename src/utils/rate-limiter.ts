interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  queue: Promise<void>;
}

const buckets = new Map<string, RateLimitBucket>();

const RETRY_ERRORS = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(error: any): boolean {
  if (error?.status === 429 || error?.statusCode === 429) return true;
  if (error?.code && RETRY_ERRORS.has(error.code)) return true;
  if (error?.message?.includes("503")) return true;
  if (error?.message?.includes("429")) return true;
  if (error?.message?.includes("ECONNRESET")) return true;
  if (error?.message?.includes("ETIMEDOUT")) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire one token from the source's bucket. Acquisition is serialized per
 * source via a promise chain: without it, N concurrent callers all observe
 * "no tokens", all sleep the same deficit, and all fire at once, bursting
 * past the limit. Chained acquisition spaces them out correctly.
 */
function acquireToken(source: string, config: RateLimitConfig): Promise<void> {
  let bucket = buckets.get(source);
  if (!bucket) {
    bucket = {
      tokens: config.maxRequests,
      lastRefill: Date.now(),
      queue: Promise.resolve(),
    };
    buckets.set(source, bucket);
  }
  const b = bucket;

  const acquired = b.queue.then(async () => {
    const now = Date.now();
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(
      config.maxRequests,
      b.tokens + (elapsed / config.windowMs) * config.maxRequests
    );
    b.lastRefill = now;

    while (b.tokens < 1) {
      const waitMs = ((1 - b.tokens) / config.maxRequests) * config.windowMs;
      await sleep(waitMs);
      const after = Date.now();
      b.tokens = Math.min(
        config.maxRequests,
        b.tokens + ((after - b.lastRefill) / config.windowMs) * config.maxRequests
      );
      b.lastRefill = after;
    }

    b.tokens -= 1;
  });

  b.queue = acquired.catch(() => {});
  return acquired;
}

export async function withRateLimit<T>(
  source: string,
  config: RateLimitConfig,
  fn: () => Promise<T>
): Promise<T> {
  await acquireToken(source, config);

  // Execute with retry
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
