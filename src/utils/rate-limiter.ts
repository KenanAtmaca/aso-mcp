interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, RateLimitBucket>();

export async function withRateLimit<T>(
  source: string,
  config: RateLimitConfig,
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  let bucket = buckets.get(source);

  if (!bucket) {
    bucket = { tokens: config.maxRequests, lastRefill: now };
    buckets.set(source, bucket);
  }

  // Refill tokens
  const elapsed = now - bucket.lastRefill;
  const refillAmount =
    (elapsed / config.windowMs) * config.maxRequests;
  bucket.tokens = Math.min(
    config.maxRequests,
    bucket.tokens + refillAmount
  );
  bucket.lastRefill = now;

  // Wait if no tokens available
  if (bucket.tokens < 1) {
    const waitMs = ((1 - bucket.tokens) / config.maxRequests) * config.windowMs;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    bucket.tokens = 1;
  }

  bucket.tokens -= 1;
  return fn();
}
