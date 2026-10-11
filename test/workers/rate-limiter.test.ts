import { env } from "cloudflare:test";
import { rateLimiterContract } from "../contract/rate-limiter-contract.ts";

// The optional INGEST_RATE_LIMITER binding (vitest.workers.config.ts): 1000 per 60 s per key.
rateLimiterContract("Cloudflare Rate Limiting binding", 1000, () => ({
	allow: async (key) => (await env.INGEST_RATE_LIMITER.limit({ key })).success,
}));
