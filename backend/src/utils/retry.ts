export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
  isRetryable?: (err: unknown) => boolean;
}

function defaultIsRetryable(err: unknown): boolean {
  const anyErr = err as any;
  const status = anyErr?.response?.status ?? anyErr?.status;
  if (status && status >= 400 && status < 500 && status !== 429) return false; // non-transient
  return true; // network errors, timeouts, 5xx, 429 -> retryable
}

/**
 * Runs fn with exponential backoff. Non-transient errors (4xx other than 429)
 * fail fast instead of burning retry budget.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { retries, baseDelayMs = 1000, onRetry, isRetryable = defaultIsRetryable } = opts;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      onRetry?.(attempt + 1, err);
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastErr;
}
