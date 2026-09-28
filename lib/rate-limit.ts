/**
 * Simple in-memory rate limiter using a sliding window.
 *
 * For production at scale, swap this for @upstash/ratelimit + Redis.
 * This works well for single-instance deployments (Docker, `npm run dev`).
 */

type RateLimitEntry = {
  timestamps: number[];
};

type RateLimiterConfig = {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
};

const store = new Map<string, RateLimitEntry>();

// Clean up old entries every 60 seconds to prevent memory leaks.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 60_000);

export function createRateLimiter(config: RateLimiterConfig) {
  return {
    /**
     * Check if a request from the given identifier should be allowed.
     * Returns { allowed: true } or { allowed: false, retryAfterMs }.
     */
    check(identifier: string): { allowed: boolean; retryAfterMs?: number } {
      const now = Date.now();
      const windowStart = now - config.windowMs;

      let entry = store.get(identifier);
      if (!entry) {
        entry = { timestamps: [] };
        store.set(identifier, entry);
      }

      // Remove timestamps outside the current window.
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

      if (entry.timestamps.length >= config.maxRequests) {
        const oldestInWindow = entry.timestamps[0];
        const retryAfterMs = oldestInWindow + config.windowMs - now;
        return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
      }

      entry.timestamps.push(now);
      return { allowed: true };
    }
  };
}

/**
 * Pre-configured limiters for the two API routes.
 * Crawl is expensive (makes 10+ HTTP requests + multiple Gemini API calls).
 * Chat is cheaper but still involves an embedding + LLM call.
 */
export const crawlLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60_000, // 5 crawls per minute per IP
});

export const chatLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60_000, // 20 chats per minute per IP
});

/**
 * Extract the client IP from a Next.js request.
 * Falls back to "anonymous" if no IP header is found.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "anonymous"
  );
}
