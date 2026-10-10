import type { RateLimiter } from "../../ports/rate-limiter.ts";

/**
 * A token bucket per key, in memory: `limit` requests per `periodMs`, refilled smoothly. Like the
 * Cloudflare binding, it is approximate (one process; it resets on restart). At most `maxKeys`
 * keys are kept: the oldest key goes first.
 */
export function tokenBucketLimiter(options: {
	limit: number;
	periodMs: number;
	now?: () => number;
	maxKeys?: number;
}): RateLimiter {
	const now = options.now ?? Date.now;
	const maxKeys = options.maxKeys ?? 10_000;
	const rate = options.limit / options.periodMs;
	const buckets = new Map<string, { tokens: number; at: number }>();
	return {
		async allow(key) {
			const t = now();
			const bucket = buckets.get(key) ?? { tokens: options.limit, at: t };
			buckets.delete(key);
			bucket.tokens = Math.min(options.limit, bucket.tokens + (t - bucket.at) * rate);
			bucket.at = t;
			const allowed = bucket.tokens >= 1;
			if (allowed) bucket.tokens -= 1;
			buckets.set(key, bucket);
			if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value as string);
			return allowed;
		},
	};
}
