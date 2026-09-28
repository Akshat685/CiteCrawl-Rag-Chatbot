/**
 * Retry a function with exponential backoff.
 *
 * Designed for transient API errors (429, 503) from Gemini.
 * Waits 1s → 2s → 4s between retries by default.
 */

type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  /** Called on each retry — useful for logging. */
  onRetry?: (error: unknown, attempt: number) => void;
};

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("503") ||
      message.includes("rate") ||
      message.includes("overloaded") ||
      message.includes("temporarily unavailable") ||
      message.includes("econnreset") ||
      message.includes("socket hang up")
    );
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, onRetry } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      onRetry?.(error, attempt + 1);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // TypeScript requires this — the loop always throws or returns.
  throw lastError;
}
