interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
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

  // Execute with retry
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
