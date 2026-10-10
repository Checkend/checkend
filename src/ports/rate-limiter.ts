/** A fast, approximate rate limit per key (for example per DSN key). */
export interface RateLimiter {
	/** Counts one request for `key`. Returns false when the key is over its limit. */
	allow(key: string): Promise<boolean>;
}

/** Allows every request. Used when no rate limiter is configured. */
export const noRateLimit: RateLimiter = { allow: async () => true };
